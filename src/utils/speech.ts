import { getDragonflyClient } from './databases/dragonfly.database.js';
import { error } from './logger.js';
import fs from 'fs/promises';
import path from 'path';
import { getDirname } from './pollyfills.js';

const __dirname = getDirname(import.meta.url);
const speechPublicDir = path.resolve(__dirname, '../server/routes/public/speech');

export async function clearSpeechFiles(channelID: string): Promise<void> {
    try {
        const cache = await getDragonflyClient('clearSpeechFiles');

        const queueKeys = await cache.keys(`twitch:${channelID}:tts:queue:data:*`);
        for (const key of queueKeys) {
            await cache.del(key);
        }

        await cache.del(`twitch:${channelID}:tts:queue`);
        await cache.del(`twitch:${channelID}:tts:processing`);
        await cache.del(`twitch:${channelID}:tts:connected`);
        await cache.del(`twitch:${channelID}:tts:last_cleanup`);

        const channelDir = path.join(speechPublicDir, channelID);
        if (await fileExists(channelDir)) {
            await fs.rm(channelDir, { recursive: true, force: true });
        }
    } catch (err) {
        await error({ 
            function: 'clearSpeechFiles', 
            channelID, 
            error: err instanceof Error ? err.message : String(err) 
        });
    }
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}
