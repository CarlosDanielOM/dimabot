import path from 'path';
import dotenv from 'dotenv';

const isDev = process.env.NODE_ENV !== 'production';

if (isDev) {
    dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
}

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const INTERVAL_MS = Math.max(30_000, Number(process.env.TEMPORARY_ROLES_INTERVAL_MS || 60_000));
const BATCH_SIZE = Math.max(1, Number(process.env.TEMPORARY_ROLES_BATCH_SIZE || 100));
const LOCK_KEY = String(process.env.TEMPORARY_ROLES_WORKER_LOCK_KEY || 'worker:temporary-roles:lock');
const LOCK_TTL_SECONDS = Math.max(120, Number(process.env.TEMPORARY_ROLES_WORKER_LOCK_TTL_SECONDS || 900));
const LOCK_RETRY_MS = Math.max(2000, Number(process.env.TEMPORARY_ROLES_WORKER_LOCK_RETRY_MS || 10000));
const RUN_ON_START = process.env.TEMPORARY_ROLES_RUN_ON_START !== 'false';
const RUN_ONCE = process.argv.includes('--once');
const DRY_RUN = process.argv.includes('--dry-run');

let shutdownRequested = false;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldDiscardRoleRecordForApiError(message: string): boolean {
    const normalized = String(message || '').toLowerCase();
    return normalized.includes('not a vip')
        || normalized.includes('is not vip')
        || normalized.includes('not a moderator')
        || normalized.includes('is not moderator')
        || normalized.includes('does not have moderator');
}

interface LegacyVipDocument {
    _id: unknown;
    channelID: string;
    userID: string;
    username: string;
    expireTimestamp?: Date;
    expireDate?: {
        year: number;
        month: number;
        day: number;
    };
}

function getExpireTimestampFromLegacyVipDocument(doc: LegacyVipDocument | null): Date | null {
    if (doc?.expireTimestamp instanceof Date) {
        return doc.expireTimestamp;
    }
    const year = Number(doc?.expireDate?.year);
    const month = Number(doc?.expireDate?.month);
    const day = Number(doc?.expireDate?.day);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        return null;
    }
    const timestamp = new Date(year, month, day, 23, 59, 59, 999);
    return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

interface ProcessedEntry {
    channelID: string;
    userID: string;
    username: string;
    role: 'vip' | 'moderator';
}

async function runDryRun(): Promise<void> {
    const config = {
        worker: 'temporary_roles',
        mode: RUN_ONCE ? 'once' : 'scheduler',
        dryRun: true,
        flags: {
            RUN_ONCE,
            RUN_ON_START,
            DRY_RUN
        },
        intervals: {
            INTERVAL_MS,
            BATCH_SIZE,
            LOCK_TTL_SECONDS,
            LOCK_RETRY_MS
        },
        keys: {
            LOCK_KEY
        },
        environment: {
            NODE_ENV: process.env.NODE_ENV || 'undefined',
            DRAGONFLY_HOST: process.env.DRAGONFLY_HOST ? '(set)' : '(unset)',
            TEMPORARY_ROLES_INTERVAL_MS: process.env.TEMPORARY_ROLES_INTERVAL_MS || `${INTERVAL_MS} (default)`,
            TEMPORARY_ROLES_BATCH_SIZE: process.env.TEMPORARY_ROLES_BATCH_SIZE || `${BATCH_SIZE} (default)`,
            TEMPORARY_ROLES_WORKER_LOCK_KEY: process.env.TEMPORARY_ROLES_WORKER_LOCK_KEY || `${LOCK_KEY} (default)`,
            TEMPORARY_ROLES_WORKER_LOCK_TTL_SECONDS: process.env.TEMPORARY_ROLES_WORKER_LOCK_TTL_SECONDS || `${LOCK_TTL_SECONDS} (default)`,
            TEMPORARY_ROLES_WORKER_LOCK_RETRY_MS: process.env.TEMPORARY_ROLES_WORKER_LOCK_RETRY_MS || `${LOCK_RETRY_MS} (default)`,
            TEMPORARY_ROLES_RUN_ON_START: process.env.TEMPORARY_ROLES_RUN_ON_START || 'true (default)'
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
    const { removeChannelVIP } = await import('../functions/channels/remove_vip.channel.js');
    const { removeChannelModerator } = await import('../functions/channels/remove_moderator.channel.js');
    const { VipSchema } = await import('../schemas/vip.schema.js');
    const { TemporaryModeratorSchema } = await import('../schemas/temporary_moderator.schema.js');
    const { error: logError, info: logInfo, warn: logWarn } = await import('../utils/logger.js');
    const { getCachedLiveStatus } = await import('../utils/siteanalytics.js');
    const { enqueueTemporaryRoleRemovalAnnouncement, flushTemporaryRoleRemovalAnnouncements } = await import('../utils/temporary_roles_announcements.js');

    async function acquireWorkerLock(lockOwnerId: string): Promise<boolean> {
        const cache = await getDragonflyClient('TemporaryRolesWorker');
        const result = await cache.set(LOCK_KEY, lockOwnerId, {
            NX: true,
            EX: LOCK_TTL_SECONDS
        });
        return result === 'OK';
    }

    async function refreshWorkerLock(lockOwnerId: string): Promise<boolean> {
        const cache = await getDragonflyClient('TemporaryRolesWorker');
        const owner = await cache.get(LOCK_KEY);
        if (owner !== lockOwnerId) {
            return false;
        }
        await cache.expire(LOCK_KEY, LOCK_TTL_SECONDS);
        return true;
    }

    async function releaseWorkerLock(lockOwnerId: string): Promise<void> {
        const cache = await getDragonflyClient('TemporaryRolesWorker');
        const owner = await cache.get(LOCK_KEY);
        if (owner === lockOwnerId) {
            await cache.del(LOCK_KEY);
        }
    }

    async function processExpiredVips(now: Date): Promise<ProcessedEntry[]> {
        const processed: ProcessedEntry[] = [];
        const expiringVips = await VipSchema.find({ vip: true })
            .select('_id channelID userID username expireTimestamp expireDate')
            .limit(BATCH_SIZE)
            .lean();

        for (const vip of expiringVips) {
            const expireTimestamp = getExpireTimestampFromLegacyVipDocument(vip as LegacyVipDocument);
            if (!expireTimestamp || expireTimestamp.getTime() > now.getTime()) {
                continue;
            }
            const removeResult = await removeChannelVIP(vip.channelID, vip.userID);
            if (removeResult.error && !shouldDiscardRoleRecordForApiError(removeResult.message || '')) {
                await logWarn({
                    worker: 'temporary_roles',
                    message: 'Failed removing expired VIP role; will retry',
                    channelID: vip.channelID,
                    userID: vip.userID,
                    errorMessage: removeResult.message,
                    status: removeResult.status,
                    type: removeResult.type
                }, { channelId: vip.channelID, destination: 'console' });
                continue;
            }
            await VipSchema.deleteOne({ _id: vip._id });
            processed.push({
                channelID: String(vip.channelID || ''),
                userID: String(vip.userID || ''),
                username: String(vip.username || ''),
                role: 'vip'
            });
        }
        return processed;
    }

    async function processExpiredModerators(now: Date): Promise<ProcessedEntry[]> {
        const processed: ProcessedEntry[] = [];
        const expiringModerators = await TemporaryModeratorSchema.find({
            expireTimestamp: { $lte: now }
        })
            .select('_id channelID userID username expireTimestamp')
            .limit(BATCH_SIZE)
            .lean();

        for (const mod of expiringModerators) {
            const removeResult = await removeChannelModerator(mod.channelID, mod.userID);
            if (removeResult.error && !shouldDiscardRoleRecordForApiError(removeResult.message || '')) {
                await logWarn({
                    worker: 'temporary_roles',
                    message: 'Failed removing expired moderator role; will retry',
                    channelID: mod.channelID,
                    userID: mod.userID,
                    errorMessage: removeResult.message,
                    status: removeResult.status,
                    type: removeResult.type
                }, { channelId: mod.channelID, destination: 'console' });
                continue;
            }
            await TemporaryModeratorSchema.deleteOne({ _id: mod._id });
            processed.push({
                channelID: String(mod.channelID || ''),
                userID: String(mod.userID || ''),
                username: String(mod.username || ''),
                role: 'moderator'
            });
        }
        return processed;
    }

    async function runTick(lockOwnerId: string, reason: string): Promise<void> {
        const lockIsValid = await refreshWorkerLock(lockOwnerId);
        if (!lockIsValid) {
            throw new Error('Worker lock lost; another temporary roles worker appears active');
        }
        const startedAt = Date.now();
        const now = new Date();
        const [removedVipEntries, removedModeratorEntries] = await Promise.all([
            processExpiredVips(now),
            processExpiredModerators(now)
        ]);
        const allRemovedEntries = [...removedVipEntries, ...removedModeratorEntries];
        if (allRemovedEntries.length > 0) {
            for (const entry of allRemovedEntries) {
                await enqueueTemporaryRoleRemovalAnnouncement(entry.channelID, entry.role, entry.username, entry.userID);
            }
            const channelsToFlush = Array.from(new Set(allRemovedEntries.map((entry) => entry.channelID).filter(Boolean)));
            for (const channelID of channelsToFlush) {
                const liveStatus = await getCachedLiveStatus(channelID);
                if (!liveStatus.isLive) {
                    continue;
                }
                try {
                    await flushTemporaryRoleRemovalAnnouncements(channelID);
                } catch (error) {
                    await logWarn({
                        worker: 'temporary_roles',
                        message: 'Failed flushing pending role removal announcements for live channel',
                        channelID,
                        error: error instanceof Error ? error.message : String(error)
                    }, { channelId: channelID, destination: 'console' });
                }
            }
        }
        const removedVips = removedVipEntries.length;
        const removedModerators = removedModeratorEntries.length;
        if (removedVips > 0 || removedModerators > 0) {
            await logInfo({
                worker: 'temporary_roles',
                message: 'Processed expired temporary roles',
                reason,
                removedVips,
                removedModerators,
                durationMs: Date.now() - startedAt
            }, { destination: 'console' });
        }
    }

    async function bootstrap(): Promise<void> {
        const lockOwnerId = `${process.pid}-${Date.now()}`;
        await getDragonflyClient('TemporaryRolesWorker');
        await getMongoDBConnection('TemporaryRolesWorker');

        let lockAcquired = await acquireWorkerLock(lockOwnerId);
        while (!lockAcquired) {
            await logWarn({
                worker: 'temporary_roles',
                message: 'Another temporary roles worker is active. Waiting for lock.',
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
            await logInfo({
                worker: 'temporary_roles',
                message: 'Shutting down temporary roles worker',
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
            worker: 'temporary_roles',
            message: 'Temporary roles worker initialized',
            intervalMs: INTERVAL_MS,
            batchSize: BATCH_SIZE,
            runOnStart: RUN_ON_START,
            runOnce: RUN_ONCE,
            lockKey: LOCK_KEY,
            lockTtlSeconds: LOCK_TTL_SECONDS
        }, { destination: 'console' });

        if (RUN_ONCE) {
            await runTick(lockOwnerId, 'run_once');
            await releaseWorkerLock(lockOwnerId);
            return;
        }

        if (RUN_ON_START) {
            await runTick(lockOwnerId, 'startup');
        }

        while (!shutdownRequested) {
            await sleep(INTERVAL_MS);
            if (shutdownRequested) {
                break;
            }
            try {
                await runTick(lockOwnerId, 'interval');
            } catch (error) {
                await logError({
                    worker: 'temporary_roles',
                    message: 'Error during temporary roles worker tick',
                    error: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined
                }, { destination: 'console' });
                const lockIsValid = await refreshWorkerLock(lockOwnerId);
                if (!lockIsValid) {
                    await logWarn({
                        worker: 'temporary_roles',
                        message: 'Worker lock is no longer valid. Exiting process to avoid duplicate workers.',
                        lockKey: LOCK_KEY
                    }, { destination: 'console' });
                    break;
                }
            }
        }
        await releaseWorkerLock(lockOwnerId);
    }

    await bootstrap();
}

main().catch((error) => {
    console.error({
        worker: 'temporary_roles',
        message: 'Failed to bootstrap temporary roles worker',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
});
