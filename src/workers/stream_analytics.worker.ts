import path from 'path';
import dotenv from 'dotenv';

const isDev = process.env.NODE_ENV !== 'production';

if (isDev) {
    dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
}

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const INTERVAL_MS = Math.max(60_000, Number(process.env.STREAM_ANALYTICS_INTERVAL_MS || 5 * 60 * 1000));
const RUN_ON_START = process.env.STREAM_ANALYTICS_RUN_ON_START !== 'false';
const LOCK_KEY = String(process.env.STREAM_ANALYTICS_WORKER_LOCK_KEY || 'worker:stream-analytics:lock');
const LOCK_TTL_SECONDS = Math.max(120, Number(process.env.STREAM_ANALYTICS_WORKER_LOCK_TTL_SECONDS || 900));
const LOCK_RETRY_MS = Math.max(2000, Number(process.env.STREAM_ANALYTICS_WORKER_LOCK_RETRY_MS || 10000));

const RUN_ONCE = process.argv.includes('--once');
const DRY_RUN = process.argv.includes('--dry-run');

if (DRY_RUN) {
    console.log(JSON.stringify({
        worker: 'stream_analytics',
        message: 'Dry run mode - resolved configuration',
        config: {
            intervalMs: INTERVAL_MS,
            runOnStart: RUN_ON_START,
            runOnce: RUN_ONCE,
            dryRun: DRY_RUN,
            lockKey: LOCK_KEY,
            lockTtlSeconds: LOCK_TTL_SECONDS,
            lockRetryMs: LOCK_RETRY_MS,
            nodeEnv: process.env.NODE_ENV || 'development'
        }
    }, null, 2));
    process.exit(0);
}

let shutdownRequested = false;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function bootstrap(): Promise<void> {
    const [
        { default: TwitchStreamers },
        { getDragonflyClient },
        { getMongoDBConnection },
        { collectLiveViewerSnapshots, reconcileLiveSessionsOnStartup },
        { error: logError, info: logInfo, warn: logWarn }
    ] = await Promise.all([
        import('../classes/twitch_streamers.class.js'),
        import('../utils/databases/dragonfly.database.js'),
        import('../utils/databases/mongodb.database.js'),
        import('../utils/stream_analytics.js'),
        import('../utils/logger.js')
    ]);

    async function acquireWorkerLock(lockOwnerId: string): Promise<boolean> {
        const cache = await getDragonflyClient('StreamAnalyticsWorker');
        const result = await cache.set(LOCK_KEY, lockOwnerId, {
            NX: true,
            EX: LOCK_TTL_SECONDS
        });
        return result === 'OK';
    }

    async function refreshWorkerLock(lockOwnerId: string): Promise<boolean> {
        const cache = await getDragonflyClient('StreamAnalyticsWorker');
        const activeOwner = await cache.get(LOCK_KEY);
        if (activeOwner !== lockOwnerId) {
            return false;
        }
        await cache.expire(LOCK_KEY, LOCK_TTL_SECONDS);
        return true;
    }

    async function releaseWorkerLock(lockOwnerId: string): Promise<void> {
        const cache = await getDragonflyClient('StreamAnalyticsWorker');
        const activeOwner = await cache.get(LOCK_KEY);
        if (activeOwner === lockOwnerId) {
            await cache.del(LOCK_KEY);
        }
    }

    async function runSnapshotTick(lockOwnerId: string, reason: string): Promise<void> {
        const lockIsValid = await refreshWorkerLock(lockOwnerId);
        if (!lockIsValid) {
            throw new Error('Worker lock lost; another stream analytics worker appears active');
        }
        await logInfo({
            worker: 'stream_analytics',
            message: 'Running stream analytics snapshot tick',
            reason
        }, { destination: 'console' });
        await collectLiveViewerSnapshots();
    }

    const lockOwnerId = `${process.pid}-${Date.now()}`;

    const shutdown = async (signal: string): Promise<void> => {
        if (shutdownRequested) {
            return;
        }
        shutdownRequested = true;
        await logInfo({
            worker: 'stream_analytics',
            message: 'Shutting down stream analytics worker',
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

    await getDragonflyClient('StreamAnalyticsWorker');
    await getMongoDBConnection('StreamAnalyticsWorker');
    await TwitchStreamers.getTwitchAccountsFromDB();

    let lockAcquired = await acquireWorkerLock(lockOwnerId);
    while (!lockAcquired) {
        await logWarn({
            worker: 'stream_analytics',
            message: 'Another stream analytics worker is active. Waiting for lock.',
            lockKey: LOCK_KEY,
            retryInMs: LOCK_RETRY_MS
        }, { destination: 'console' });
        await sleep(LOCK_RETRY_MS);
        if (shutdownRequested) {
            return;
        }
        lockAcquired = await acquireWorkerLock(lockOwnerId);
    }

    await logInfo({
        worker: 'stream_analytics',
        message: 'Stream analytics worker initialized',
        intervalMs: INTERVAL_MS,
        runOnStart: RUN_ON_START,
        runOnce: RUN_ONCE,
        lockKey: LOCK_KEY,
        lockTtlSeconds: LOCK_TTL_SECONDS
    }, { destination: 'console' });

    await reconcileLiveSessionsOnStartup();

    if (RUN_ONCE) {
        await runSnapshotTick(lockOwnerId, 'run_once');
        await releaseWorkerLock(lockOwnerId);
        return;
    }

    if (RUN_ON_START) {
        await runSnapshotTick(lockOwnerId, 'startup');
    }

    while (!shutdownRequested) {
        await sleep(INTERVAL_MS);
        if (shutdownRequested) {
            break;
        }
        try {
            await runSnapshotTick(lockOwnerId, 'interval');
        } catch (error) {
            await logError({
                worker: 'stream_analytics',
                message: 'Error during stream analytics snapshot tick',
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            }, { destination: 'console' });
            const lockIsValid = await refreshWorkerLock(lockOwnerId);
            if (!lockIsValid) {
                await logWarn({
                    worker: 'stream_analytics',
                    message: 'Worker lock is no longer valid. Exiting process to avoid duplicate workers.',
                    lockKey: LOCK_KEY
                }, { destination: 'console' });
                break;
            }
        }
    }
    await releaseWorkerLock(lockOwnerId);
}

bootstrap().catch((error) => {
    console.error(JSON.stringify({
        worker: 'stream_analytics',
        message: 'Failed to bootstrap stream analytics worker',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
    }, null, 2));
    process.exit(1);
});
