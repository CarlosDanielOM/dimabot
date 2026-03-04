import path from 'path';
import dotenv from 'dotenv';

const isDev = process.env.NODE_ENV !== 'production';

if (isDev) {
    dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
}

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

//? Constants (parsed before any I/O imports)
const INTERVAL_MS = Math.max(60_000, Number(process.env.TIMER_WORKER_INTERVAL_MS || 5 * 60 * 1000));
const RUN_ON_START = process.env.TIMER_WORKER_RUN_ON_START !== 'false';
const LOCK_KEY = String(process.env.TIMER_WORKER_LOCK_KEY || 'worker:timer:lock');
const LOCK_TTL_SECONDS = Math.max(120, Number(process.env.TIMER_WORKER_LOCK_TTL_SECONDS || 900));
const LOCK_RETRY_MS = Math.max(2000, Number(process.env.TIMER_WORKER_LOCK_RETRY_MS || 10000));
const RUN_ONCE = process.argv.includes('--once');
const DRY_RUN = process.argv.includes('--dry-run');
const MAX_COMMAND_REF_DEPTH = 5;

//? Redis key contracts (must be preserved exactly)
const TIMER_ACTIVE_KEY = 'timer:active';
const getTimerChannelKey = (channelID: string) => `timer:channel:${channelID}:timers`;
const getTimerHeartbeatKey = (channelID: string, timerID: string) => `timer:channel:${channelID}:heartbeat:${timerID}`;

let shutdownRequested = false;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runDryRun(): Promise<void> {
    const config = {
        mode: RUN_ONCE ? 'once' : 'scheduler',
        dryRun: true,
        flags: {
            RUN_ONCE,
            RUN_ON_START,
            DRY_RUN
        },
        intervals: {
            INTERVAL_MS,
            LOCK_TTL_SECONDS,
            LOCK_RETRY_MS
        },
        keys: {
            LOCK_KEY,
            TIMER_ACTIVE_KEY,
            timerChannelPattern: 'timer:channel:{channelID}:timers',
            timerHeartbeatPattern: 'timer:channel:{channelID}:heartbeat:{timerID}'
        },
        constants: {
            MAX_COMMAND_REF_DEPTH
        },
        environment: {
            NODE_ENV: process.env.NODE_ENV || 'undefined',
            TIMER_WORKER_INTERVAL_MS: process.env.TIMER_WORKER_INTERVAL_MS || `${5 * 60 * 1000} (default)`,
            TIMER_WORKER_RUN_ON_START: process.env.TIMER_WORKER_RUN_ON_START || 'true (default)',
            TIMER_WORKER_LOCK_KEY: process.env.TIMER_WORKER_LOCK_KEY || 'worker:timer:lock (default)',
            TIMER_WORKER_LOCK_TTL_SECONDS: process.env.TIMER_WORKER_LOCK_TTL_SECONDS || '900 (default)',
            TIMER_WORKER_LOCK_RETRY_MS: process.env.TIMER_WORKER_LOCK_RETRY_MS || '10000 (default)',
            DRAGONFLY_HOST: process.env.DRAGONFLY_HOST || 'undefined'
        }
    };

    console.log(JSON.stringify(config, null, 2));
}

async function main(): Promise<void> {
    if (DRY_RUN) {
        await runDryRun();
        return;
    }

    //? Dynamic imports for modules that connect to databases
    const { getDragonflyClient } = await import('../utils/databases/dragonfly.database.js');
    const { getMongoDBConnection } = await import('../utils/databases/mongodb.database.js');
    const { sendTwitchChatMessage } = await import('../functions/chats/send_message.chat.js');
    const TwitchStreamers = (await import('../classes/twitch_streamers.class.js')).default;
    const { error: logError, info: logInfo, warn: logWarn } = await import('../utils/logger.js');
    const { commandHandler } = await import('../handlers/commands.handler.js');

    async function acquireWorkerLock(lockOwnerId: string): Promise<boolean> {
        const cache = await getDragonflyClient('TimerWorker');
        const result = await cache.set(LOCK_KEY, lockOwnerId, {
            NX: true,
            EX: LOCK_TTL_SECONDS
        });
        return result === 'OK';
    }

    async function refreshWorkerLock(lockOwnerId: string): Promise<boolean> {
        const cache = await getDragonflyClient('TimerWorker');
        const activeOwner = await cache.get(LOCK_KEY);
        if (activeOwner !== lockOwnerId) {
            return false;
        }
        await cache.expire(LOCK_KEY, LOCK_TTL_SECONDS);
        return true;
    }

    async function releaseWorkerLock(lockOwnerId: string): Promise<void> {
        const cache = await getDragonflyClient('TimerWorker');
        const activeOwner = await cache.get(LOCK_KEY);
        if (activeOwner === lockOwnerId) {
            await cache.del(LOCK_KEY);
        }
    }

    async function resolveCommandReference(
        commandName: string,
        args: string,
        channelID: string,
        streamerName: string,
        visitedCommands: Set<string>,
        depth: number
    ): Promise<string> {
        if (depth >= MAX_COMMAND_REF_DEPTH) {
            await logWarn({
                worker: 'timer',
                message: 'Command reference depth exceeded',
                channelID,
                commandName,
                depth
            }, { destination: 'console' });
            return '';
        }

        const normalizedCommand = commandName.toLowerCase().trim();
        if (visitedCommands.has(normalizedCommand)) {
            await logWarn({
                worker: 'timer',
                message: 'Command reference cycle detected',
                channelID,
                commandName,
                visitedCommands: Array.from(visitedCommands)
            }, { destination: 'console' });
            return '';
        }

        visitedCommands.add(normalizedCommand);

        try {
            const fakeEventData = {
                chatter_user_id: channelID,
                chatter_user_login: streamerName.toLowerCase(),
                chatter_user_name: streamerName,
                badges: [],
                message_id: `timer-${Date.now()}`,
                message: { text: '', fragments: [] },
                message_type: 'text' as const,
                cheer: { bits: 0 },
                color: ''
            };

            const result = await commandHandler(channelID, fakeEventData, normalizedCommand, args || undefined);
            if (result.error || !result.message) {
                return '';
            }

            let message = result.message;
            const commandRefPattern = /#\(([^)]+)\)/g;
            let match;
            while ((match = commandRefPattern.exec(message)) !== null) {
                const fullMatch = match[0];
                const inner = match[1].trim();
                const firstSpace = inner.indexOf(' ');
                const innerCommand = firstSpace === -1 ? inner : inner.substring(0, firstSpace);
                const innerArgs = firstSpace === -1 ? '' : inner.substring(firstSpace + 1);
                const resolved = await resolveCommandReference(
                    innerCommand,
                    innerArgs,
                    channelID,
                    streamerName,
                    new Set(visitedCommands),
                    depth + 1
                );
                message = message.replace(fullMatch, resolved);
                commandRefPattern.lastIndex = 0;
            }

            return message;
        } catch (error) {
            await logError({
                worker: 'timer',
                message: 'Error resolving command reference',
                channelID,
                commandName,
                error: error instanceof Error ? error.message : String(error)
            }, { destination: 'console' });
            return '';
        }
    }

    async function processTimerTick(
        cache: Awaited<ReturnType<typeof getDragonflyClient>>,
        channelID: string,
        timer: { _id: string | number; frequency: number; message: string; name: string; active: boolean },
        streamerName: string
    ): Promise<void> {
        const timerID = String(timer._id);
        const heartbeatKey = getTimerHeartbeatKey(channelID, timerID);
        const currentHeartbeat = parseInt(await cache.get(heartbeatKey) || '0', 10);
        const newHeartbeat = currentHeartbeat + 1;

        if (newHeartbeat >= timer.frequency) {
            try {
                const visitedCommands = new Set<string>();
                let parsedMessage = await resolveCommandReference('', timer.message, channelID, streamerName, visitedCommands, 0);

                const directPattern = /#\(([^)]+)\)/g;
                let match;
                while ((match = directPattern.exec(timer.message)) !== null) {
                    const fullMatch = match[0];
                    const inner = match[1].trim();
                    const firstSpace = inner.indexOf(' ');
                    const commandName = firstSpace === -1 ? inner : inner.substring(0, firstSpace);
                    const args = firstSpace === -1 ? '' : inner.substring(firstSpace + 1);

                    if (!visitedCommands.has(commandName.toLowerCase())) {
                        const resolved = await resolveCommandReference(commandName, args, channelID, streamerName, visitedCommands, 1);
                        parsedMessage = parsedMessage.replace(fullMatch, resolved);
                    }
                }

                if (parsedMessage && parsedMessage.trim().length > 0) {
                    await sendTwitchChatMessage(channelID, parsedMessage.trim());
                    await logInfo({
                        worker: 'timer',
                        message: 'Timer fired',
                        channelID,
                        timerName: timer.name,
                        frequency: timer.frequency,
                        originalMessage: timer.message,
                        parsedMessage: parsedMessage.trim()
                    }, { channelId: channelID, destination: 'console' });
                }

                await cache.set(heartbeatKey, '0');
            } catch (err) {
                await logError({
                    worker: 'timer',
                    message: 'Error processing timer',
                    channelID,
                    timerName: timer.name,
                    error: err instanceof Error ? err.message : String(err),
                    stack: err instanceof Error ? err.stack : undefined
                }, { channelId: channelID, destination: 'console' });
                await cache.set(heartbeatKey, '0');
            }
        } else {
            await cache.set(heartbeatKey, String(newHeartbeat));
        }
    }

    async function runTimerTick(lockOwnerId: string, reason: string): Promise<void> {
        const lockIsValid = await refreshWorkerLock(lockOwnerId);
        if (!lockIsValid) {
            throw new Error('Worker lock lost; another timer worker appears active');
        }

        const cache = await getDragonflyClient('TimerWorker');
        const activeChannels = await cache.sMembers(TIMER_ACTIVE_KEY);

        if (!activeChannels || activeChannels.length === 0) {
            return;
        }

        await logInfo({
            worker: 'timer',
            message: 'Running timer tick',
            reason,
            activeChannels: activeChannels.length
        }, { destination: 'console' });

        for (const channelID of activeChannels) {
            try {
                const timersData = await cache.hGetAll(getTimerChannelKey(channelID));
                if (!timersData || Object.keys(timersData).length === 0) {
                    continue;
                }

                const streamer = await TwitchStreamers.getTwitchAccountById(channelID);
                if (!streamer) {
                    continue;
                }

                for (const [timerID, timerJSON] of Object.entries(timersData)) {
                    try {
                        const timer = JSON.parse(timerJSON);
                        if (!timer.active) {
                            continue;
                        }
                        await processTimerTick(cache, channelID, timer, streamer.name || '');
                    } catch (parseErr) {
                        await logError({
                            worker: 'timer',
                            message: 'Error parsing timer from cache',
                            channelID,
                            timerID,
                            error: parseErr instanceof Error ? parseErr.message : String(parseErr)
                        }, { destination: 'console' });
                    }
                }
            } catch (channelErr) {
                await logError({
                    worker: 'timer',
                    message: 'Error processing channel timers',
                    channelID,
                    error: channelErr instanceof Error ? channelErr.message : String(channelErr)
                }, { destination: 'console' });
            }
        }
    }

    async function bootstrap(): Promise<void> {
        const lockOwnerId = `${process.pid}-${Date.now()}`;

        await getDragonflyClient('TimerWorker');
        await getMongoDBConnection('TimerWorker');
        await TwitchStreamers.getTwitchAccountsFromDB();

        let lockAcquired = await acquireWorkerLock(lockOwnerId);
        while (!lockAcquired) {
            await logWarn({
                worker: 'timer',
                message: 'Another timer worker is active. Waiting for lock.',
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
                worker: 'timer',
                message: 'Shutting down timer worker',
                signal
            }, { destination: 'console' });
            await releaseWorkerLock(lockOwnerId);
            process.exit(0);
        };

        process.once('SIGINT', () => void shutdown('SIGINT'));
        process.once('SIGTERM', () => void shutdown('SIGTERM'));

        await logInfo({
            worker: 'timer',
            message: 'Timer worker initialized',
            intervalMs: INTERVAL_MS,
            runOnStart: RUN_ON_START,
            runOnce: RUN_ONCE,
            lockKey: LOCK_KEY,
            lockTtlSeconds: LOCK_TTL_SECONDS
        }, { destination: 'console' });

        if (RUN_ONCE) {
            await runTimerTick(lockOwnerId, 'run_once');
            await releaseWorkerLock(lockOwnerId);
            return;
        }

        if (RUN_ON_START) {
            await runTimerTick(lockOwnerId, 'startup');
        }

        while (!shutdownRequested) {
            await sleep(INTERVAL_MS);
            if (shutdownRequested) {
                break;
            }
            try {
                await runTimerTick(lockOwnerId, 'interval');
            } catch (error) {
                await logError({
                    worker: 'timer',
                    message: 'Error during timer tick',
                    error: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined
                }, { destination: 'console' });

                const lockIsValid = await refreshWorkerLock(lockOwnerId);
                if (!lockIsValid) {
                    await logWarn({
                        worker: 'timer',
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

main().catch(async (error) => {
    console.error({
        worker: 'timer',
        message: 'Failed to bootstrap timer worker',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
});
