import { getDragonflyClient } from './databases/dragonfly.database.js';
import { error } from './logger.js';

export async function clearChannelCache(channelID: string): Promise<void> {
    try {
        const cache = await getDragonflyClient('clearChannelCache');
        await cache.del(`${channelID}:follows:count`);
        await cache.del(`${channelID}:commands`);
    } catch (err) {
        await error({ 
            function: 'clearChannelCache', 
            channelID, 
            error: err instanceof Error ? err.message : String(err) 
        });
    }
}

export async function resetSumimetro(channelID: string): Promise<void> {
    try {
        const cache = await getDragonflyClient('resetSumimetro');
        const keys = await cache.keys(`${channelID}:sumimetro:*`);
        
        if (keys.length === 0) return;
        
        for (const key of keys) {
            await cache.del(key);
        }
    } catch (err) {
        await error({ 
            function: 'resetSumimetro', 
            channelID, 
            error: err instanceof Error ? err.message : String(err) 
        });
    }
}
