import { getDragonflyClient } from './databases/dragonfly.database.js';
import { error } from './logger.js';
import fs from 'fs/promises';
import path from 'path';

export async function clearSpeechFiles(channelID: string): Promise<void> {
    try {
        const cache = await getDragonflyClient('clearSpeechFiles');
        const messageQueue = await cache.sMembers(`${channelID}:speach`);
        
        if (messageQueue.length === 0) return;
        
        for (const id of messageQueue) {
            const filePath = path.join(process.cwd(), 'src-js/server/routes/public/speech', `${id}.mp3`);
            
            try {
                if (await fileExists(filePath)) {
                    await fs.unlink(filePath);
                }
            } catch (err) {
                console.error(`Error deleting speech file ${filePath}:`, err);
            }
            
            await cache.sRem(`${channelID}:speach`, id);
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
