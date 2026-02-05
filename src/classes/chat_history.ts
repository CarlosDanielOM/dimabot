import { getDragonflyClient } from "../utils/databases/dragonfly.database.js";

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
                console.warn('Invalid message data:', { channelID, username, message });
                return;
            }

            const key = `${platform}:${channelID}:chat:history`;
            const messageData = JSON.stringify({ username, message:message, timestamp: Date.now(), badges: formattedBadges });
            
            // Add new message
            await cache.lPush(key, messageData);

            // Trim history to max size
            await cache.lTrim(key, 0, this.maxHistorySize - 1);
            
        } catch (error) {
            console.error('Error adding message to chat history:', error);
            return;
        }
    }

    async getRecentMessages(channelID: string, limit: number = 7, platform: 'twitch' | 'kick' = 'twitch') {
        try {
            const cache = await this.cacheClient;

            if(!channelID) {
                console.warn('Invalid channelID for getRecentMessages');
                return [];
            }

            const key = `${platform}:${channelID}:chat:history`;
            const messages = await cache.lRange(key, 0, limit - 1);

            return messages.map(msg => JSON.parse(msg));
            
        } catch (error) {
            console.error('Error getting recent messages:', error);
            return [];
        }
    }
    
    async clearHistory(channelID: string, platform: 'twitch' | 'kick' = 'twitch') {
        try {
            const cache = await this.cacheClient;

            if(!channelID) {
                console.warn('Invalid channelID for clearHistory');
                return;
            }

            const key = `${platform}:${channelID}:chat:history`;
            await cache.del(key);
        } catch (error) {
            console.error('Error clearing chat history:', error);
            return;
        }
    }
}

export default new ChatHistory();