import path from 'path';
import dotenv from 'dotenv';

const isDev = process.env.NODE_ENV !== 'production';

if (isDev) {
    dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
}

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const LOCK_KEY = String(process.env.STREAM_MEMORY_WORKER_LOCK_KEY || 'worker:stream-memory:lock');
const LOCK_TTL_SECONDS = Math.max(120, Number(process.env.STREAM_MEMORY_WORKER_LOCK_TTL_SECONDS || 900));
const LOCK_RETRY_MS = Math.max(2000, Number(process.env.STREAM_MEMORY_WORKER_LOCK_RETRY_MS || 10000));
const CHANNEL_LOCK_PREFIX = String(process.env.STREAM_MEMORY_CHANNEL_LOCK_PREFIX || 'cron:stream-memory:running');
const CHANNEL_LOCK_SECONDS = Math.max(60, Number(process.env.STREAM_MEMORY_CHANNEL_LOCK_SECONDS || 1200));
const QUEUE_BLOCK_TIMEOUT_SECONDS = Math.max(1, Number(process.env.STREAM_MEMORY_QUEUE_BLOCK_TIMEOUT_SECONDS || 5));
const RUN_ON_START = process.env.STREAM_MEMORY_RUN_ON_START !== 'false';
const RUN_ONCE = process.argv.includes('--once');
const DRY_RUN = process.argv.includes('--dry-run');
const JOB_MAX_ATTEMPTS = Math.max(1, Number(process.env.STREAM_MEMORY_JOB_MAX_ATTEMPTS || 3));
const REQUEUE_DELAY_MS = Math.max(800, Number(process.env.STREAM_MEMORY_REQUEUE_DELAY_MS || 2500));
const WEEKLY_SCHEDULE_UTC_DAY = Math.max(0, Math.min(6, Number(process.env.STREAM_MEMORY_WEEKLY_SCHEDULE_DAY_UTC || 1)));
const WEEKLY_SCHEDULE_UTC_HOUR = Math.max(0, Math.min(23, Number(process.env.STREAM_MEMORY_WEEKLY_SCHEDULE_HOUR_UTC || 0)));
const WEEKLY_SCHEDULE_UTC_MINUTE = Math.max(0, Math.min(59, Number(process.env.STREAM_MEMORY_WEEKLY_SCHEDULE_MINUTE_UTC || 15)));
const MONTHLY_SCHEDULE_UTC_DAY = Math.max(1, Math.min(28, Number(process.env.STREAM_MEMORY_MONTHLY_SCHEDULE_DAY_UTC || 1)));
const MONTHLY_SCHEDULE_UTC_HOUR = Math.max(0, Math.min(23, Number(process.env.STREAM_MEMORY_MONTHLY_SCHEDULE_HOUR_UTC || 0)));
const MONTHLY_SCHEDULE_UTC_MINUTE = Math.max(0, Math.min(59, Number(process.env.STREAM_MEMORY_MONTHLY_SCHEDULE_MINUTE_UTC || 30)));

let shutdownRequested = false;
let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let lastWeeklyPeriodScheduled = '';
let lastMonthlyPeriodScheduled = '';

function normalizeValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getChannelLockKey(channelID: string): string {
    return `${CHANNEL_LOCK_PREFIX}:${normalizeValue(channelID)}`;
}

async function runDryRun(): Promise<void> {
    const {
        STREAM_MEMORY_QUEUE_KEY,
        STREAM_MEMORY_DEAD_LETTER_KEY,
        STREAM_MEMORY_SUMMARY_JOB,
        STREAM_MEMORY_WEEKLY_JOB,
        STREAM_MEMORY_MONTHLY_JOB,
        getWeeklyMaintenancePeriodToken,
        getMonthlyMaintenancePeriodToken
    } = await import('../utils/ai/memory/stream_memory_queue.js');

    const now = new Date();
    const weeklyToken = getWeeklyMaintenancePeriodToken(now);
    const monthlyToken = getMonthlyMaintenancePeriodToken(now);

    const config = {
        mode: RUN_ONCE ? 'once' : 'scheduler',
        dryRun: true,
        flags: {
            RUN_ONCE,
            RUN_ON_START,
            DRY_RUN
        },
        intervals: {
            LOCK_TTL_SECONDS,
            LOCK_RETRY_MS,
            CHANNEL_LOCK_SECONDS,
            QUEUE_BLOCK_TIMEOUT_SECONDS,
            JOB_MAX_ATTEMPTS,
            REQUEUE_DELAY_MS
        },
        schedule: {
            weekly: {
                utcDay: WEEKLY_SCHEDULE_UTC_DAY,
                utcHour: WEEKLY_SCHEDULE_UTC_HOUR,
                utcMinute: WEEKLY_SCHEDULE_UTC_MINUTE,
                currentPeriodToken: weeklyToken
            },
            monthly: {
                utcDay: MONTHLY_SCHEDULE_UTC_DAY,
                utcHour: MONTHLY_SCHEDULE_UTC_HOUR,
                utcMinute: MONTHLY_SCHEDULE_UTC_MINUTE,
                currentPeriodToken: monthlyToken
            }
        },
        keys: {
            LOCK_KEY,
            CHANNEL_LOCK_PREFIX,
            STREAM_MEMORY_QUEUE_KEY,
            STREAM_MEMORY_DEAD_LETTER_KEY
        },
        jobs: {
            STREAM_MEMORY_SUMMARY_JOB,
            STREAM_MEMORY_WEEKLY_JOB,
            STREAM_MEMORY_MONTHLY_JOB
        },
        environment: {
            NODE_ENV: process.env.NODE_ENV || 'undefined',
            STREAM_MEMORY_WORKER_LOCK_KEY: process.env.STREAM_MEMORY_WORKER_LOCK_KEY || 'worker:stream-memory:lock (default)',
            STREAM_MEMORY_WORKER_LOCK_TTL_SECONDS: process.env.STREAM_MEMORY_WORKER_LOCK_TTL_SECONDS || '900 (default)',
            STREAM_MEMORY_WORKER_LOCK_RETRY_MS: process.env.STREAM_MEMORY_WORKER_LOCK_RETRY_MS || '10000 (default)',
            STREAM_MEMORY_CHANNEL_LOCK_PREFIX: process.env.STREAM_MEMORY_CHANNEL_LOCK_PREFIX || 'cron:stream-memory:running (default)',
            STREAM_MEMORY_CHANNEL_LOCK_SECONDS: process.env.STREAM_MEMORY_CHANNEL_LOCK_SECONDS || '1200 (default)',
            STREAM_MEMORY_QUEUE_BLOCK_TIMEOUT_SECONDS: process.env.STREAM_MEMORY_QUEUE_BLOCK_TIMEOUT_SECONDS || '5 (default)',
            STREAM_MEMORY_RUN_ON_START: process.env.STREAM_MEMORY_RUN_ON_START || 'true (default)',
            STREAM_MEMORY_JOB_MAX_ATTEMPTS: process.env.STREAM_MEMORY_JOB_MAX_ATTEMPTS || '3 (default)',
            STREAM_MEMORY_REQUEUE_DELAY_MS: process.env.STREAM_MEMORY_REQUEUE_DELAY_MS || '2500 (default)',
            STREAM_MEMORY_WEEKLY_SCHEDULE_DAY_UTC: process.env.STREAM_MEMORY_WEEKLY_SCHEDULE_DAY_UTC || '1 (default)',
            STREAM_MEMORY_WEEKLY_SCHEDULE_HOUR_UTC: process.env.STREAM_MEMORY_WEEKLY_SCHEDULE_HOUR_UTC || '0 (default)',
            STREAM_MEMORY_WEEKLY_SCHEDULE_MINUTE_UTC: process.env.STREAM_MEMORY_WEEKLY_SCHEDULE_MINUTE_UTC || '15 (default)',
            STREAM_MEMORY_MONTHLY_SCHEDULE_DAY_UTC: process.env.STREAM_MEMORY_MONTHLY_SCHEDULE_DAY_UTC || '1 (default)',
            STREAM_MEMORY_MONTHLY_SCHEDULE_HOUR_UTC: process.env.STREAM_MEMORY_MONTHLY_SCHEDULE_HOUR_UTC || '0 (default)',
            STREAM_MEMORY_MONTHLY_SCHEDULE_MINUTE_UTC: process.env.STREAM_MEMORY_MONTHLY_SCHEDULE_MINUTE_UTC || '30 (default)'
        }
    };

    console.log(JSON.stringify(config, null, 2));
}

async function main(): Promise<void> {
    if (DRY_RUN) {
        await runDryRun();
        return;
    }

    const { getDragonflyClient } = await import('../utils/databases/dragonfly.database.js');
    const { getMongoDBConnection } = await import('../utils/databases/mongodb.database.js');
    const TwitchStreamers = (await import('../classes/twitch_streamers.class.js')).default;
    const { error: logError, info: logInfo, warn: logWarn } = await import('../utils/logger.js');
    const { clearCronJobDedupeByKey, parseCronQueueJob, serializeCronQueueJob } = await import('../utils/cron_jobs_queue.js');
    const {
        STREAM_MEMORY_DEAD_LETTER_KEY,
        STREAM_MEMORY_MONTHLY_JOB,
        STREAM_MEMORY_QUEUE_KEY,
        STREAM_MEMORY_SUMMARY_JOB,
        STREAM_MEMORY_WEEKLY_JOB,
        enqueueMemoryMaintenanceJob,
        getMonthlyMaintenancePeriodToken,
        getWeeklyMaintenancePeriodToken
    } = await import('../utils/ai/memory/stream_memory_queue.js');
    const { runStreamMemoryWorkflow } = await import('../utils/ai/memory/stream_memory_runner.js');
    const { recordStreamMemoryActionMetric, recordStreamMemoryJobMetric } = await import('../utils/observability/bot_runtime_metrics.js');

    async function acquireWorkerLock(lockOwnerId: string): Promise<boolean> {
        const cache = await getDragonflyClient('StreamMemoryWorker');
        const result = await cache.set(LOCK_KEY, lockOwnerId, {
            NX: true,
            EX: LOCK_TTL_SECONDS
        });
        return result === 'OK';
    }

    async function refreshWorkerLock(lockOwnerId: string): Promise<boolean> {
        const cache = await getDragonflyClient('StreamMemoryWorker');
        const owner = await cache.get(LOCK_KEY);
        if (owner !== lockOwnerId) {
            return false;
        }
        await cache.expire(LOCK_KEY, LOCK_TTL_SECONDS);
        return true;
    }

    async function releaseWorkerLock(lockOwnerId: string): Promise<void> {
        const cache = await getDragonflyClient('StreamMemoryWorker');
        const owner = await cache.get(LOCK_KEY);
        if (owner === lockOwnerId) {
            await cache.del(LOCK_KEY);
        }
    }

    async function acquireChannelLock(channelID: string): Promise<boolean> {
        const cache = await getDragonflyClient('StreamMemoryWorker');
        const lockKey = getChannelLockKey(channelID);
        const lockValue = JSON.stringify({ pid: process.pid, at: new Date().toISOString() });
        const result = await cache.set(lockKey, lockValue, {
            NX: true,
            EX: CHANNEL_LOCK_SECONDS
        });
        return result === 'OK';
    }

    async function releaseChannelLock(channelID: string): Promise<void> {
        const cache = await getDragonflyClient('StreamMemoryWorker');
        await cache.del(getChannelLockKey(channelID));
    }

    async function requeueJob(job: ReturnType<typeof parseCronQueueJob>): Promise<void> {
        if (!job) return;
        const cache = await getDragonflyClient('StreamMemoryWorker');
        await cache.rPush(STREAM_MEMORY_QUEUE_KEY, serializeCronQueueJob(job));
    }

    async function scheduleMaintenanceForCadence(cadence: 'weekly' | 'monthly', periodToken: string): Promise<void> {
        const streamerIDs = await TwitchStreamers.getTwitchStreamers();
        if (!streamerIDs.length) {
            return;
        }
        let enqueued = 0;
        for (const channelID of streamerIDs) {
            const result = await enqueueMemoryMaintenanceJob({
                channelID,
                cadence,
                requestedBy: 'stream_memory_worker_scheduler',
                reason: `${cadence}_scheduled`,
                periodToken
            });
            if (result.enqueued) {
                enqueued += 1;
            }
        }
        await logInfo({
            worker: 'stream_memory',
            message: 'Scheduled maintenance jobs for cadence',
            cadence,
            periodToken,
            channels: streamerIDs.length,
            enqueued
        }, { destination: 'console' });
    }

    async function runSchedulerTick(): Promise<void> {
        const now = new Date();
        const utcDay = now.getUTCDay();
        const utcHour = now.getUTCHours();
        const utcMinute = now.getUTCMinutes();
        const weeklyPeriodToken = getWeeklyMaintenancePeriodToken(now);
        if (utcDay === WEEKLY_SCHEDULE_UTC_DAY
            && utcHour === WEEKLY_SCHEDULE_UTC_HOUR
            && utcMinute >= WEEKLY_SCHEDULE_UTC_MINUTE
            && lastWeeklyPeriodScheduled !== weeklyPeriodToken) {
            lastWeeklyPeriodScheduled = weeklyPeriodToken;
            await scheduleMaintenanceForCadence('weekly', weeklyPeriodToken);
        }
        const monthlyPeriodToken = getMonthlyMaintenancePeriodToken(now);
        if (now.getUTCDate() === MONTHLY_SCHEDULE_UTC_DAY
            && utcHour === MONTHLY_SCHEDULE_UTC_HOUR
            && utcMinute >= MONTHLY_SCHEDULE_UTC_MINUTE
            && lastMonthlyPeriodScheduled !== monthlyPeriodToken) {
            lastMonthlyPeriodScheduled = monthlyPeriodToken;
            await scheduleMaintenanceForCadence('monthly', monthlyPeriodToken);
        }
    }

    function getJobAttempt(job: ReturnType<typeof parseCronQueueJob>): number {
        const attempt = Number(job?.data?.attempt || 1);
        if (!Number.isFinite(attempt) || attempt <= 0) {
            return 1;
        }
        return Math.floor(attempt);
    }

    function withNextAttempt(job: ReturnType<typeof parseCronQueueJob>): ReturnType<typeof parseCronQueueJob> {
        if (!job) return null;
        const current = getJobAttempt(job);
        return {
            ...job,
            data: {
                ...(job.data || {}),
                attempt: current + 1
            }
        };
    }

    async function processJob(job: NonNullable<ReturnType<typeof parseCronQueueJob>>): Promise<void> {
        const channelID = normalizeValue(job.channelID || job.accountID || job.data?.channelID);
        const nowUnix = Math.floor(Date.now() / 1000);
        const notBeforeUnix = Number(job.data?.notBeforeUnix || 0);
        if (!channelID) {
            await logWarn({
                worker: 'stream_memory',
                message: 'Discarding stream memory job without channel ID',
                job
            }, { destination: 'console' });
            return;
        }
        if (notBeforeUnix > nowUnix) {
            await requeueJob(job);
            await sleep(REQUEUE_DELAY_MS);
            return;
        }
        const lockAvailable = await acquireChannelLock(channelID);
        if (!lockAvailable) {
            await requeueJob(job);
            await sleep(REQUEUE_DELAY_MS);
            return;
        }
        const startedAt = Date.now();
        let failed = false;
        let source: 'stream_offline' | 'weekly_maintenance' | 'monthly_maintenance' = 'stream_offline';
        try {
            if (job.job === STREAM_MEMORY_SUMMARY_JOB) {
                source = 'stream_offline';
            } else if (job.job === STREAM_MEMORY_WEEKLY_JOB) {
                source = 'weekly_maintenance';
            } else {
                source = 'monthly_maintenance';
            }
            const result = await runStreamMemoryWorkflow({
                channelID,
                sessionID: normalizeValue(job.data?.sessionID),
                streamID: normalizeValue(job.data?.streamID),
                source
            });
            failed = result.error;
            await recordStreamMemoryJobMetric({
                channelID,
                jobType: job.job,
                source,
                status: result.status,
                failed: result.error,
                latencyMs: Date.now() - startedAt
            });
            if (!result.error) {
                await logInfo({
                    worker: 'stream_memory',
                    message: 'Processed stream memory job',
                    job,
                    result
                }, { channelId: channelID, destination: 'console' });
                return;
            }
            const attempt = getJobAttempt(job);
            if (attempt < JOB_MAX_ATTEMPTS) {
                const retryJob = withNextAttempt(job);
                await requeueJob(retryJob);
                await logWarn({
                    worker: 'stream_memory',
                    message: 'Requeued failed stream memory job for retry',
                    attempt,
                    maxAttempts: JOB_MAX_ATTEMPTS,
                    job,
                    result
                }, { channelId: channelID, destination: 'console' });
                await sleep(REQUEUE_DELAY_MS);
                return;
            }
            await logWarn({
                worker: 'stream_memory',
                message: 'Max retries reached for stream memory job; moving to dead letter',
                attempt,
                maxAttempts: JOB_MAX_ATTEMPTS,
                job,
                result
            }, { channelId: channelID, destination: 'console' });
            const cache = await getDragonflyClient('StreamMemoryWorker');
            await cache.rPush(STREAM_MEMORY_DEAD_LETTER_KEY, serializeCronQueueJob(job));
        } catch (error) {
            failed = true;
            await logError({
                worker: 'stream_memory',
                message: 'Unexpected error while processing stream memory job',
                job,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            }, { channelId: channelID, destination: 'console' });
        } finally {
            await releaseChannelLock(channelID);
            await clearCronJobDedupeByKey(job.dedupeKey);
            if (failed) {
                await recordStreamMemoryActionMetric({
                    channelID,
                    action: 'job_failed',
                    source,
                    count: 1
                });
            }
        }
    }

    async function startQueueConsumerLoop(lockOwnerId: string): Promise<void> {
        const cache = await getDragonflyClient('StreamMemoryWorker');
        while (!shutdownRequested) {
            const lockIsValid = await refreshWorkerLock(lockOwnerId);
            if (!lockIsValid) {
                await logWarn({
                    worker: 'stream_memory',
                    message: 'Worker lock is no longer valid. Exiting queue consumer.'
                }, { destination: 'console' });
                break;
            }
            try {
                const result = await cache.blPop(STREAM_MEMORY_QUEUE_KEY, QUEUE_BLOCK_TIMEOUT_SECONDS);
                if (!result) {
                    continue;
                }
                const payload = parseCronQueueJob(result.element);
                if (!payload) {
                    await logWarn({
                        worker: 'stream_memory',
                        message: 'Discarding invalid stream memory payload',
                        raw: result.element
                    }, { destination: 'console' });
                    continue;
                }
                if (![STREAM_MEMORY_SUMMARY_JOB, STREAM_MEMORY_WEEKLY_JOB, STREAM_MEMORY_MONTHLY_JOB].includes(payload.job)) {
                    await cache.rPush(STREAM_MEMORY_DEAD_LETTER_KEY, serializeCronQueueJob(payload));
                    await clearCronJobDedupeByKey(payload.dedupeKey);
                    await logWarn({
                        worker: 'stream_memory',
                        message: 'Unsupported stream memory job moved to dead-letter queue',
                        job: payload.job,
                        jobID: payload.id
                    }, { destination: 'console' });
                    continue;
                }
                await processJob(payload);
            } catch (error) {
                await logError({
                    worker: 'stream_memory',
                    message: 'Queue consumer loop error',
                    error: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined
                }, { destination: 'console' });
                await sleep(1000);
            }
        }
    }

    async function bootstrap(): Promise<void> {
        const lockOwnerId = `${process.pid}-${Date.now()}`;
        await getDragonflyClient('StreamMemoryWorker');
        await getMongoDBConnection('StreamMemoryWorker');
        await TwitchStreamers.getTwitchAccountsFromDB();
        let lockAcquired = await acquireWorkerLock(lockOwnerId);
        while (!lockAcquired) {
            await logWarn({
                worker: 'stream_memory',
                message: 'Another stream memory worker is active. Waiting for lock.',
                lockKey: LOCK_KEY,
                retryInMs: LOCK_RETRY_MS
            }, { destination: 'console' });
            await sleep(LOCK_RETRY_MS);
            if (shutdownRequested) {
                return;
            }
            lockAcquired = await acquireWorkerLock(lockOwnerId);
        }
        const shutdown = async (signal: string): Promise<void> => {
            if (shutdownRequested) {
                return;
            }
            shutdownRequested = true;
            if (schedulerTimer) {
                clearInterval(schedulerTimer);
                schedulerTimer = null;
            }
            await logInfo({
                worker: 'stream_memory',
                message: 'Shutting down stream memory worker',
                signal
            }, { destination: 'console' });
            await releaseWorkerLock(lockOwnerId);
            process.exit(0);
        };
        process.once('SIGINT', () => {
            void shutdown('SIGINT');
        });
        process.once('SIGTERM', () => {
            void shutdown('SIGTERM');
        });
        await logInfo({
            worker: 'stream_memory',
            message: 'Stream memory worker initialized',
            runOnStart: RUN_ON_START,
            runOnce: RUN_ONCE,
            queueKey: STREAM_MEMORY_QUEUE_KEY,
            deadLetterKey: STREAM_MEMORY_DEAD_LETTER_KEY,
            lockKey: LOCK_KEY
        }, { destination: 'console' });
        if (RUN_ONCE) {
            await runSchedulerTick();
            await releaseWorkerLock(lockOwnerId);
            return;
        }
        if (RUN_ON_START) {
            await runSchedulerTick();
        }
        schedulerTimer = setInterval(() => {
            void runSchedulerTick().catch(async (error) => {
                await logError({
                    worker: 'stream_memory',
                    message: 'Scheduler tick failed',
                    error: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined
                }, { destination: 'console' });
            });
        }, 60_000);
        await startQueueConsumerLoop(lockOwnerId);
        await releaseWorkerLock(lockOwnerId);
    }

    await bootstrap();
}

main().catch(async (error) => {
    console.error({
        worker: 'stream_memory',
        message: 'Failed to bootstrap stream memory worker',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
});
