import type { RedisClientType } from 'redis';
import { getDragonflyClient } from '../utils/databases/dragonfly.database.js';
import { pubSubManager, type ClipRequestData } from '../classes/pubsub_manager.class.js';
import { downloadClip, deleteOldClip } from '../utils/video.js';
import { getIO } from './websocket.js';

class ClipQueueHandler {
    private cache: RedisClientType | null = null;
    private currentTimeouts: Map<string, NodeJS.Timeout> = new Map();
    private processingChannels: Set<string> = new Set();
    private initialized = false;

    async init(): Promise<void> {
        if (this.initialized) {
            console.log('ClipQueueHandler already initialized');
            return;
        }

        try {
            this.cache = await getDragonflyClient('ClipQueueHandler:init');

            console.log('ClipQueueHandler initialized');
            this.initialized = true;
        } catch (error) {
            console.error('Error initializing ClipQueueHandler:', error);
            throw error;
        }
    }

    async subscribeToChannel(channelID: string): Promise<void> {
        if (!this.initialized || !this.cache) {
            throw new Error('ClipQueueHandler not initialized');
        }

        try {
            await pubSubManager.subscribeToClipRequests(channelID, async (clipData: ClipRequestData) => {
                await this.handleClipRequest(channelID, clipData);
            });

            console.log(`Subscribed to clip requests for channel ${channelID}`);
        } catch (error) {
            console.error(`Error subscribing to channel ${channelID}:`, error);
            throw error;
        }
    }

    private async handleClipRequest(channelID: string, clipData: ClipRequestData): Promise<void> {
        if (!this.cache) {
            console.error('Cache not initialized in handleClipRequest');
            return;
        }

        try {
            const idExists = await this.cache.zRank(`twitch:${channelID}:clips:queue`, clipData.clipID);

            if (!idExists) {
                await this.cache.zAdd(`twitch:${channelID}:clips:queue`, {
                    score: clipData.timestamp,
                    value: clipData.clipID
                });
                await this.cache.set(`twitch:${channelID}:clips:queue:data:${clipData.clipID}`, JSON.stringify(clipData));
            }

            const isProcessing = await this.cache.exists(`twitch:${channelID}:clip:processing`);

            if (!isProcessing) {
                await this.cache.set(`twitch:${channelID}:clip:processing`, "true");
                this.processingChannels.add(channelID);
                await this.downloadAndSendToOBS(channelID, clipData);
            }
        } catch (error) {
            console.error(`Error in handleClipRequest for channel ${channelID}:`, {
                clipData,
                error: error instanceof Error ? error.message : String(error),
                timestamp: new Date().toISOString()
            });
        }
    }

    async processNextClip(channelID: string): Promise<void> {
        if (!this.cache) {
            console.error('Cache not initialized in processNextClip');
            return;
        }

        try {
            const nextIDResult = await this.cache.zPopMin(`twitch:${channelID}:clips:queue`);

            if (!nextIDResult) {
                return;
            }

            const nextID = nextIDResult.value;

            if (!nextID) {
                return;
            }

            const nextData = await this.cache.get(`twitch:${channelID}:clips:queue:data:${nextID}`);

            if (!nextData) {
                console.error(`Clip data not found for ID ${nextID} in channel ${channelID}`);
                return;
            }

            const clipData: ClipRequestData = JSON.parse(nextData);

            await this.cache.set(`twitch:${channelID}:clip:processing`, "true");
            this.processingChannels.add(channelID);

            await this.downloadAndSendToOBS(channelID, clipData);
        } catch (error) {
            console.error(`Error in processNextClip for channel ${channelID}:`, {
                error: error instanceof Error ? error.message : String(error),
                timestamp: new Date().toISOString()
            });
        }
    }

    private async downloadAndSendToOBS(channelID: string, clipData: ClipRequestData): Promise<void> {
        if (!this.cache) {
            console.error('Cache not initialized in downloadAndSendToOBS');
            return;
        }

        const timeoutKey = `${channelID}:${clipData.clipID}`;
        let timeoutSeconds = 60;
        let timeout: NodeJS.Timeout | null = null;

        try {
            const timeoutSetting = await this.cache.get(`twitch:${channelID}:clips:timeouts:default`);

            if (timeoutSetting) {
                timeoutSeconds = parseInt(timeoutSetting);
            }

            timeoutSeconds += 5;

            timeout = setTimeout(async () => {
                console.error(`Clip timeout for ${channelID}, clipID: ${clipData.clipID}`);

                await this.cleanupClip(channelID, clipData.clipID);

                await this.processNextClip(channelID);
            }, timeoutSeconds * 1000);

            this.currentTimeouts.set(timeoutKey, timeout);

            const downloadDir = `${process.cwd()}/src/server/routes/public/downloads`;

            await deleteOldClip(channelID, downloadDir);

            const downloadResult = await downloadClip(clipData.clipUrl, channelID, downloadDir);

            if (downloadResult.error) {
                if (timeout) {
                    clearTimeout(timeout);
                    this.currentTimeouts.delete(timeoutKey);
                }

                await this.cleanupClip(channelID, clipData.clipID);

                await this.processNextClip(channelID);
                return;
            }

            const io = getIO();

            if (!io) {
                console.error('Socket.IO not initialized');
                await this.cleanupClip(channelID, clipData.clipID);
                await this.processNextClip(channelID);
                return;
            }

            const clipPayload = {
                clipID: clipData.clipID,
                clipUrl: clipData.clipUrl,
                duration: clipData.duration,
                title: clipData.title,
                game: clipData.game,
                streamer: clipData.streamer,
                streamerLogin: clipData.streamerLogin,
                profileImage: clipData.profileImage,
                description: clipData.description,
                streamerColor: clipData.streamerColor
            };

            io.of(`/clip/${channelID}`).emit('play-clip', clipPayload);

            console.log(`Clip sent to OBS for channel ${channelID}, clipID: ${clipData.clipID}`);
        } catch (error) {
            console.error(`Error in downloadAndSendToOBS for channel ${channelID}:`, {
                clipData,
                error: error instanceof Error ? error.message : String(error),
                timestamp: new Date().toISOString()
            });

            if (timeout) {
                clearTimeout(timeout);
                this.currentTimeouts.delete(timeoutKey);
            }

            await this.cleanupClip(channelID, clipData.clipID);

            await this.processNextClip(channelID);
        }
    }

    private async cleanupClip(channelID: string, clipID: string): Promise<void> {
        if (!this.cache) {
            return;
        }

        try {
            await this.cache.del(`twitch:${channelID}:clip:processing`);
            await this.cache.del(`twitch:${channelID}:clips:queue:data:${clipID}`);
            this.processingChannels.delete(channelID);

            const timeoutKey = `${channelID}:${clipID}`;
            const timeout = this.currentTimeouts.get(timeoutKey);

            if (timeout) {
                clearTimeout(timeout);
                this.currentTimeouts.delete(timeoutKey);
            }
        } catch (error) {
            console.error(`Error in cleanupClip for channel ${channelID}:`, {
                clipID,
                error: error instanceof Error ? error.message : String(error),
                timestamp: new Date().toISOString()
            });
        }
    }

    async cleanupOldQueueData(channelID: string): Promise<void> {
        if (!this.cache) {
            return;
        }

        try {
            const keys = await this.cache.keys(`twitch:${channelID}:clips:queue:data:*`);

            for (const key of keys) {
                const ttl = await this.cache.ttl(key);

                if (ttl === -1 || ttl > 86400) {
                    await this.cache.del(key);
                    console.log(`Deleted old queue data key: ${key}`);
                }
            }
        } catch (error) {
            console.error(`Error in cleanupOldQueueData for channel ${channelID}:`, {
                error: error instanceof Error ? error.message : String(error),
                timestamp: new Date().toISOString()
            });
        }
    }

    async startupCleanup(): Promise<void> {
        if (!this.cache) {
            console.error('Cache not initialized in startupCleanup');
            return;
        }

        try {
            console.log('Running startup cleanup for clip queue...');

            await this.cache.del(`twitch:*:clip:processing`);

            await this.cleanupOldQueueData('*');

            console.log('Startup cleanup completed');
        } catch (error) {
            console.error('Error in startupCleanup:', {
                error: error instanceof Error ? error.message : String(error),
                timestamp: new Date().toISOString()
            });
        }
    }
}

const clipQueueHandler = new ClipQueueHandler();

export { clipQueueHandler };
