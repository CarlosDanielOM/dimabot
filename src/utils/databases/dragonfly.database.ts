import { createClient } from "redis";
import type { RedisClientType } from "redis";

type DragonflyClient = RedisClientType;

let connectionPromise: Promise<DragonflyClient> | null = null;

export const getDragonflyClient = async (caller: string = 'unknown'): Promise<DragonflyClient> => {
    if (connectionPromise) return connectionPromise;

    const initConnection = async () => {
        const client = createClient({
            url: `redis://${process.env.DRAGONFLY_HOST}:${process.env.DRAGONFLY_PORT}`,
        })

        client.on('error', (error) => {
            console.error(`Error connecting to DragonFlyDB from ${caller}`, error);
        });

        client.on('connect', () => {
            console.log(`Connected to DragonFlyDB from ${caller}`);
        });

        try {
            await client.connect();
            return client as DragonflyClient;
        } catch (error) {
            console.error(`Error connecting to DragonFlyDB from ${caller}`, error);
            connectionPromise = null;
            throw error;
        }
        
    }

    connectionPromise = initConnection();

    return connectionPromise;
}