import { createClient } from 'redis';
import type { RedisClientType } from 'redis';
import { getDragonflyClient } from '../utils/databases/dragonfly.database.js';

type DragonflyClient = RedisClientType;

let publisher: DragonflyClient;
let subscriber: DragonflyClient;
let subscriptions: Map<string, (data: any) => void> = new Map();

class PubSubManager {
    async init() {
        try {
            const client = await getDragonflyClient('PubSubManager:init');

            publisher = client.duplicate();
            subscriber = client.duplicate();

            subscriber.on('message', this.handleMessage.bind(this));
            subscriber.on('error', (error: any) => {
                console.error('PubSub subscriber error:', error);
            });

            await subscriber.connect();
            await publisher.connect();

            console.log('PubSub manager initialized');
        } catch (error) {
            console.error('Error initializing PubSub manager:', error);
            throw error;
        }
    }

    async publish(channel: string, data: object): Promise<void> {
        try {
            if (!publisher) {
                await this.init();
            }

            const message = JSON.stringify({
                ...data,
                timestamp: Date.now()
            });

            await publisher.publish(channel, message);
        } catch (error) {
            console.error(`Error publishing to ${channel}:`, error);
            throw error;
        }
    }

    async subscribe(channel: string, handler: (data: any) => void): Promise<void> {
        try {
            if (!subscriber) {
                await this.init();
            }

            subscriptions.set(channel, handler);

            await subscriber.subscribe(channel, (message: string, subChannel: string) => {
                if (subChannel === channel) {
                    const handler = subscriptions.get(channel);
                    if (handler) {
                        const data = JSON.parse(message);
                        handler(data);
                    }
                }
            });
        } catch (error) {
            console.error(`Error subscribing to ${channel}:`, error);
            throw error;
        }
    }

    async unsubscribe(channel: string): Promise<void> {
        try {
            if (subscriber) {
                await subscriber.unsubscribe(channel);
                subscriptions.delete(channel);
            }
        } catch (error) {
            console.error(`Error unsubscribing from ${channel}:`, error);
            throw error;
        }
    }

    private handleMessage(channel: string, message: string): void {
        try {
            const data = JSON.parse(message);
            const handler = subscriptions.get(channel);

            if (handler) {
                handler(data);
            }
        } catch (error) {
            console.error('Error handling pub/sub message:', error);
        }
    }

    // Clip-specific convenience methods
    async publishClipRequest(channelID: string, clipData: ClipRequestData): Promise<void> {
        await this.publish(`twitch:${channelID}:clip:request`, clipData);
    }

    async subscribeToClipRequests(channelID: string, handler: (data: ClipRequestData) => void): Promise<void> {
        await this.subscribe(`twitch:${channelID}:clip:request`, handler);
    }
}

interface ClipRequestData {
    clipID: string;
    streamerLogin: string;
    duration: number;
    clipUrl: string;
    title: string;
    game: string;
    streamer: string;
    profileImage: string;
    description: string;
    streamerColor: string;
    timestamp: number;
}

const pubSubManager = new PubSubManager();

export { pubSubManager };
export type { ClipRequestData };
