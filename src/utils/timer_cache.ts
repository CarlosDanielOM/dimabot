import { CustomTimerSchema } from '../schemas/custom_timer.schema.js';
import { getDragonflyClient } from '../utils/databases/dragonfly.database.js';
import { error as logError, info as logInfo } from '../utils/logger.js';

export async function loadChannelTimersIntoCache(channelID: string): Promise<void> {
    try {
        const cache = await getDragonflyClient('loadChannelTimers');
        const timers = await CustomTimerSchema.find({ channelID, active: true }).lean();

        if (timers.length === 0) {
            await cache.sAdd('timer:active', channelID);
            return;
        }

        const timerMap: Record<string, string> = {};
        for (const timer of timers) {
            timerMap[String(timer._id)] = JSON.stringify(timer);
        }

        if (Object.keys(timerMap).length > 0) {
            await cache.hSet(`timer:channel:${channelID}:timers`, timerMap);

            for (const timer of timers) {
                const heartbeatKey = `timer:channel:${channelID}:heartbeat:${timer._id}`;
                const exists = await cache.exists(heartbeatKey);
                if (!exists) {
                    await cache.set(heartbeatKey, '0');
                }
            }
        }

        await cache.sAdd('timer:active', channelID);

        await logInfo({
            function: 'loadChannelTimersIntoCache',
            channelID,
            timerCount: timers.length,
            message: 'Loaded timers into cache for live channel'
        }, { channelId: channelID, destination: 'console' });
    } catch (error) {
        await logError({
            function: 'loadChannelTimersIntoCache',
            channelID,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        }, { channelId: channelID, destination: 'both' });
    }
}

export async function unloadChannelTimersFromCache(channelID: string): Promise<void> {
    try {
        const cache = await getDragonflyClient('unloadChannelTimers');
        await cache.sRem('timer:active', channelID);

        const timersData = await cache.hGetAll(`timer:channel:${channelID}:timers`);
        if (timersData) {
            for (const timerID of Object.keys(timersData)) {
                await cache.del(`timer:channel:${channelID}:heartbeat:${timerID}`);
            }
        }

        await cache.del(`timer:channel:${channelID}:timers`);

        await logInfo({
            function: 'unloadChannelTimersFromCache',
            channelID,
            message: 'Unloaded timers from cache for offline channel'
        }, { channelId: channelID, destination: 'console' });
    } catch (error) {
        await logError({
            function: 'unloadChannelTimersFromCache',
            channelID,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        }, { channelId: channelID, destination: 'both' });
    }
}

export async function refreshChannelTimerInCache(channelID: string, timerID: string): Promise<void> {
    try {
        const cache = await getDragonflyClient('refreshChannelTimer');
        const isActive = await cache.sIsMember('timer:active', channelID);
        if (!isActive) {
            return;
        }

        const timer = await CustomTimerSchema.findById(timerID).lean();
        if (!timer || !timer.active) {
            await cache.hDel(`timer:channel:${channelID}:timers`, timerID);
            await cache.del(`timer:channel:${channelID}:heartbeat:${timerID}`);
            return;
        }

        await cache.hSet(`timer:channel:${channelID}:timers`, timerID, JSON.stringify(timer));
        await cache.set(`timer:channel:${channelID}:heartbeat:${timerID}`, '0');
    } catch (error) {
        await logError({
            function: 'refreshChannelTimerInCache',
            channelID,
            timerID,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        }, { channelId: channelID, destination: 'both' });
    }
}

export async function removeChannelTimerFromCache(channelID: string, timerID: string): Promise<void> {
    try {
        const cache = await getDragonflyClient('removeChannelTimer');
        await cache.hDel(`timer:channel:${channelID}:timers`, timerID);
        await cache.del(`timer:channel:${channelID}:heartbeat:${timerID}`);
    } catch (error) {
        await logError({
            function: 'removeChannelTimerFromCache',
            channelID,
            timerID,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        }, { channelId: channelID, destination: 'both' });
    }
}
