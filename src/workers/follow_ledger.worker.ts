import path from 'path';
import dotenv from 'dotenv';

const isDev = process.env.NODE_ENV !== 'production';

if (isDev) {
    dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
}

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const LOCK_KEY = 'worker:follow-ledger:daily:lock';
const LOCK_TTL_SECONDS = Number(process.env.FOLLOW_LEDGER_LOCK_TTL_SECONDS || 86400);
const REQUEST_DELAY_MS = Math.max(1000, Number(process.env.FOLLOW_LEDGER_REQUEST_DELAY_MS || 1000));
const WRITE_BATCH_SIZE = Math.max(1, Number(process.env.FOLLOW_LEDGER_WRITE_BATCH_SIZE || 250));
const CHANNEL_LOCK_SECONDS = Math.max(300, Number(process.env.FOLLOW_LEDGER_CHANNEL_LOCK_SECONDS || 3600));
const QUEUE_BLOCK_TIMEOUT_SECONDS = Math.max(1, Number(process.env.FOLLOW_LEDGER_QUEUE_BLOCK_TIMEOUT_SECONDS || 5));
const RUN_ON_START = process.env.FOLLOW_LEDGER_RUN_ON_START === 'true';
const RUN_ONCE = process.argv.includes('--once');
const DRY_RUN = process.argv.includes('--dry-run');
const CHANNEL_LOCK_PREFIX = 'cron:follow-ledger:running';

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDelayToNextUtcMidnight(now: Date = new Date()): number {
    const next = new Date(now);
    next.setUTCHours(24, 0, 0, 0);
    return Math.max(0, next.getTime() - now.getTime());
}

class RequestLimiter {
    lastRequestAt = 0;
    intervalMs: number;

    constructor(intervalMs: number) {
        this.intervalMs = intervalMs;
    }

    async waitTurn(): Promise<void> {
        const now = Date.now();
        const target = this.lastRequestAt + this.intervalMs;
        if (target > now) {
            await sleep(target - now);
        }
        this.lastRequestAt = Date.now();
    }
}

const followersLimiter = new RequestLimiter(REQUEST_DELAY_MS);
const followingLimiter = new RequestLimiter(REQUEST_DELAY_MS);

interface ChannelLockValue {
    reason: string;
    at: string;
}

function normalizeValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function getChannelLockKey(channelID: string): string {
    return `${CHANNEL_LOCK_PREFIX}:${normalizeValue(channelID)}`;
}

async function runDryRun(): Promise<void> {
    const CRON_JOBS_QUEUE_KEY = 'cron:jobs:queue';
    const CRON_JOBS_DEAD_LETTER_KEY = 'cron:jobs:dead-letter';
    const FOLLOW_LEDGER_JOB_NAME = 'follow-ledger-sync';

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
            REQUEST_DELAY_MS,
            WRITE_BATCH_SIZE,
            CHANNEL_LOCK_SECONDS,
            QUEUE_BLOCK_TIMEOUT_SECONDS
        },
        keys: {
            LOCK_KEY,
            CHANNEL_LOCK_PREFIX,
            CRON_JOBS_QUEUE_KEY,
            CRON_JOBS_DEAD_LETTER_KEY,
            FOLLOW_LEDGER_JOB_NAME
        },
        environment: {
            NODE_ENV: process.env.NODE_ENV || 'undefined',
            FOLLOW_LEDGER_LOCK_TTL_SECONDS: process.env.FOLLOW_LEDGER_LOCK_TTL_SECONDS || '86400 (default)',
            FOLLOW_LEDGER_REQUEST_DELAY_MS: process.env.FOLLOW_LEDGER_REQUEST_DELAY_MS || '1000 (default)',
            FOLLOW_LEDGER_WRITE_BATCH_SIZE: process.env.FOLLOW_LEDGER_WRITE_BATCH_SIZE || '250 (default)',
            FOLLOW_LEDGER_CHANNEL_LOCK_SECONDS: process.env.FOLLOW_LEDGER_CHANNEL_LOCK_SECONDS || '3600 (default)',
            FOLLOW_LEDGER_QUEUE_BLOCK_TIMEOUT_SECONDS: process.env.FOLLOW_LEDGER_QUEUE_BLOCK_TIMEOUT_SECONDS || '5 (default)',
            FOLLOW_LEDGER_RUN_ON_START: process.env.FOLLOW_LEDGER_RUN_ON_START || 'false (default)'
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
    const { getFollowLedgerSyncChannelIDs, syncFollowLedgerForChannel } = await import('../utils/follow_ledger.js');
    const { CRON_JOBS_DEAD_LETTER_KEY, CRON_JOBS_QUEUE_KEY, clearCronJobDedupeByKey, parseCronQueueJob, serializeCronQueueJob } = await import('../utils/cron_jobs_queue.js');
    const { FOLLOW_LEDGER_JOB_NAME } = await import('../utils/follow_ledger_queue.js');

    async function acquireDailyLock(runId: string): Promise<boolean> {
        const cache = await getDragonflyClient('FollowLedgerWorker');
        const result = await cache.set(LOCK_KEY, runId, {
            NX: true,
            EX: LOCK_TTL_SECONDS
        });
        return result === 'OK';
    }

    async function releaseDailyLock(runId: string): Promise<void> {
        const cache = await getDragonflyClient('FollowLedgerWorker');
        const activeRun = await cache.get(LOCK_KEY);
        if (activeRun === runId) {
            await cache.del(LOCK_KEY);
        }
    }

    async function acquireChannelLock(channelID: string, reason: string): Promise<boolean> {
        const cache = await getDragonflyClient('FollowLedgerWorker');
        const lockKey = getChannelLockKey(channelID);
        const lockValue: ChannelLockValue = { reason, at: new Date().toISOString() };
        const result = await cache.set(lockKey, JSON.stringify(lockValue), {
            NX: true,
            EX: CHANNEL_LOCK_SECONDS
        });
        return result === 'OK';
    }

    async function releaseChannelLock(channelID: string): Promise<void> {
        const cache = await getDragonflyClient('FollowLedgerWorker');
        await cache.del(getChannelLockKey(channelID));
    }

    async function requeueJob(job: ReturnType<typeof parseCronQueueJob>): Promise<void> {
        if (!job) return;
        const cache = await getDragonflyClient('FollowLedgerWorker');
        await cache.rPush(CRON_JOBS_QUEUE_KEY, serializeCronQueueJob(job));
    }

    async function startQueueConsumerLoop(): Promise<void> {
        const cache = await getDragonflyClient('FollowLedgerWorker');
        while (true) {
            try {
                const result = await cache.blPop(CRON_JOBS_QUEUE_KEY, QUEUE_BLOCK_TIMEOUT_SECONDS);
                if (!result) {
                    continue;
                }
                const payload = parseCronQueueJob(result.element);
                if (!payload) {
                    await logWarn({
                        worker: 'follow_ledger',
                        message: 'Discarding invalid cron queue payload',
                        raw: result.element
                    }, { destination: 'console' });
                    continue;
                }
                if (payload.job !== FOLLOW_LEDGER_JOB_NAME) {
                    await cache.rPush(CRON_JOBS_DEAD_LETTER_KEY, serializeCronQueueJob(payload));
                    await logInfo({
                        worker: 'follow_ledger',
                        message: 'Moved unsupported cron job to dead-letter queue',
                        job: payload.job,
                        jobID: payload.id
                    }, { destination: 'console' });
                    await clearCronJobDedupeByKey(payload.dedupeKey);
                    continue;
                }
                const reason = String(payload.data?.reason || 'queued_request');
                const channelID = normalizeValue(payload.channelID || payload.accountID || payload.userID || payload.data?.channelID);
                if (!channelID) {
                    await logWarn({
                        worker: 'follow_ledger',
                        message: 'Discarding follow-ledger cron job without channel ID',
                        job: payload
                    }, { destination: 'console' });
                    await clearCronJobDedupeByKey(payload.dedupeKey);
                    continue;
                }
                const lockAvailable = await acquireChannelLock(channelID, `queue:${reason}`);
                if (!lockAvailable) {
                    await requeueJob(payload);
                    await sleep(1500);
                    continue;
                }
                try {
                    await logInfo({
                        worker: 'follow_ledger',
                        message: 'Processing queued follow-ledger sync job',
                        job: payload
                    }, { channelId: channelID, destination: 'console' });
                    const syncResult = await syncFollowLedgerForChannel(channelID, {
                        beforeFollowersRequest: async () => followersLimiter.waitTurn(),
                        beforeFollowingRequest: async () => followingLimiter.waitTurn(),
                        writeBatchSize: WRITE_BATCH_SIZE
                    });
                    if (syncResult.error) {
                        await logWarn({
                            worker: 'follow_ledger',
                            message: 'Queued follow-ledger sync job failed',
                            job: payload,
                            syncResult
                        }, { channelId: channelID, destination: 'console' });
                    } else {
                        await logInfo({
                            worker: 'follow_ledger',
                            message: 'Queued follow-ledger sync job completed',
                            job: payload,
                            syncResult
                        }, { channelId: channelID, destination: 'console' });
                    }
                } finally {
                    await releaseChannelLock(channelID);
                    await clearCronJobDedupeByKey(payload.dedupeKey);
                }
            } catch (error) {
                await logError({
                    worker: 'follow_ledger',
                    message: 'Queue consumer loop error',
                    error: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined
                }, { destination: 'console' });
                await sleep(1000);
            }
        }
    }

    async function runDailyFollowLedgerSync(): Promise<void> {
        const runId = `${Date.now()}`;
        if (!(await acquireDailyLock(runId))) {
            await logWarn({
                worker: 'follow_ledger',
                message: 'Daily follow-ledger sync already running. Skipping duplicate run.'
            }, { destination: 'console' });
            return;
        }
        const startedAt = Date.now();
        try {
            await TwitchStreamers.getTwitchAccountsFromDB();
            const channelIDs = await getFollowLedgerSyncChannelIDs();
            await logInfo({
                worker: 'follow_ledger',
                message: 'Starting daily follow-ledger sync queue',
                channels: channelIDs.length,
                requestDelayMs: REQUEST_DELAY_MS,
                writeBatchSize: WRITE_BATCH_SIZE
            }, { destination: 'console' });
            let processed = 0;
            let failed = 0;
            for (const channelID of channelIDs) {
                const normalizedChannelID = normalizeValue(channelID);
                const hasLock = await acquireChannelLock(normalizedChannelID, 'daily_utc_sweep');
                if (!hasLock) {
                    await logWarn({
                        worker: 'follow_ledger',
                        message: 'Skipping daily follow-ledger sync because channel lock is busy',
                        channelID: normalizedChannelID
                    }, { channelId: normalizedChannelID, destination: 'console' });
                    continue;
                }
                try {
                    const result = await syncFollowLedgerForChannel(normalizedChannelID, {
                        beforeFollowersRequest: async () => followersLimiter.waitTurn(),
                        beforeFollowingRequest: async () => followingLimiter.waitTurn(),
                        writeBatchSize: WRITE_BATCH_SIZE
                    });
                    processed += 1;
                    if (result.error) {
                        failed += 1;
                        await logWarn({
                            worker: 'follow_ledger',
                            message: 'Channel follow-ledger sync failed',
                            result
                        }, { channelId: normalizedChannelID, destination: 'console' });
                        continue;
                    }
                    await logInfo({
                        worker: 'follow_ledger',
                        message: 'Channel follow-ledger sync completed',
                        result,
                        progress: `${processed}/${channelIDs.length}`
                    }, { channelId: normalizedChannelID, destination: 'console' });
                } finally {
                    await releaseChannelLock(normalizedChannelID);
                }
            }
            await logInfo({
                worker: 'follow_ledger',
                message: 'Daily follow-ledger sync queue finished',
                channels: channelIDs.length,
                processed,
                failed,
                durationMs: Date.now() - startedAt
            }, { destination: 'console' });
        } catch (error) {
            await logError({
                worker: 'follow_ledger',
                message: 'Unexpected error during daily follow-ledger sync',
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                durationMs: Date.now() - startedAt
            }, { destination: 'console' });
        } finally {
            await releaseDailyLock(runId);
        }
    }

    function scheduleDailyRun(): void {
        const delayMs = getDelayToNextUtcMidnight();
        void logInfo({
            worker: 'follow_ledger',
            message: 'Scheduled next daily follow-ledger sync',
            delayMs,
            nextRunAtUtc: new Date(Date.now() + delayMs).toISOString()
        }, { destination: 'console' });
        setTimeout(async () => {
            await runDailyFollowLedgerSync();
            scheduleDailyRun();
        }, delayMs);
    }

    async function bootstrap(): Promise<void> {
        await getDragonflyClient('FollowLedgerWorker');
        await getMongoDBConnection('FollowLedgerWorker');
        await logInfo({
            worker: 'follow_ledger',
            message: 'Follow-ledger worker initialized',
            mode: RUN_ONCE ? 'once' : 'scheduler',
            runOnStart: RUN_ON_START,
            requestDelayMs: REQUEST_DELAY_MS,
            writeBatchSize: WRITE_BATCH_SIZE,
            queueBlockTimeoutSeconds: QUEUE_BLOCK_TIMEOUT_SECONDS,
            channelLockSeconds: CHANNEL_LOCK_SECONDS
        }, { destination: 'console' });
        if (RUN_ONCE) {
            await runDailyFollowLedgerSync();
            return;
        }
        void startQueueConsumerLoop();
        if (RUN_ON_START) {
            await runDailyFollowLedgerSync();
        } else {
            await logInfo({
                worker: 'follow_ledger',
                message: 'Run-on-start is disabled. Worker will process queued jobs and wait for 00:00 UTC sweep.'
            }, { destination: 'console' });
        }
        scheduleDailyRun();
    }

    await bootstrap();
}

main().catch(async (error) => {
    console.error({
        worker: 'follow_ledger',
        message: 'Failed to bootstrap follow-ledger worker',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
});
