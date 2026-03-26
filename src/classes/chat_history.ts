import { getDragonflyClient } from "../utils/databases/dragonfly.database.js";
import { error, warn } from "../utils/logger.js";
import { recordRedisOpsEstimate } from "../utils/observability/bot_runtime_metrics.js";

type DragonflyClient = Awaited<ReturnType<typeof getDragonflyClient>>;

class ChatHistory {
    private cacheClient: ReturnType<typeof getDragonflyClient>;
    private maxHistorySize: number = 100; // Maximum history size for premium plus channels

    constructor() {
        this.cacheClient = getDragonflyClient('ChatHistory');
    }

    async addMessage(channelID: string, username: string, message: string, formattedBadges?: string[], platform: 'twitch' | 'kick' = 'twitch') {
        try {
            const cache = await this.cacheClient;

            if(!channelID || !username || !message) {
                warn({ error: 'Invalid message data', channelID, username, message }, { channelId: channelID, destination: 'both' });
                return;
            }

            const key = `${platform}:${channelID}:chat:history`;
            const messageData = JSON.stringify({ username, message:message, timestamp: Date.now(), badges: formattedBadges });
            
            // Add new message
            await cache.lPush(key, messageData);
            recordRedisOpsEstimate(1);

            // Trim history to max size
            await cache.lTrim(key, 0, this.maxHistorySize - 1);
            recordRedisOpsEstimate(1);

        } catch (err) {
            await error({ function: 'ChatHistory.addMessage', error: err instanceof Error ? err.message : String(err) }, { channelId: channelID, destination: 'both' });
            return;
        }
    }

    async getRecentMessages(channelID: string, limit: number = 7, platform: 'twitch' | 'kick' = 'twitch') {
        try {
            const cache = await this.cacheClient;

            if(!channelID) {
                warn({ error: 'Invalid channelID for getRecentMessages' }, { channelId: channelID, destination: 'both' });
                return [];
            }

            const key = `${platform}:${channelID}:chat:history`;
            const messages = await cache.lRange(key, 0, limit - 1);
            recordRedisOpsEstimate(1);

            return messages.map(msg => JSON.parse(msg));

        } catch (err) {
            await error({ function: 'ChatHistory.getRecentMessages', error: err instanceof Error ? err.message : String(err) }, { channelId: channelID, destination: 'both' });
            return [];
        }
    }
    
    async clearHistory(channelID: string, platform: 'twitch' | 'kick' = 'twitch') {
        try {
            const cache = await this.cacheClient;

            if(!channelID) {
                warn({ error: 'Invalid channelID for clearHistory' }, { channelId: channelID, destination: 'both' });
                return;
            }

            const key = `${platform}:${channelID}:chat:history`;
            await cache.del(key);
            recordRedisOpsEstimate(1);
        } catch (err) {
            await error({ function: 'ChatHistory.clearHistory', error: err instanceof Error ? err.message : String(err) }, { channelId: channelID, destination: 'both' });
            return;
        }
    }
}

export default new ChatHistory();
