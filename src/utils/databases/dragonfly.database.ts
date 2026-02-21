import { createClient } from "redis";
import type { RedisClientType } from "redis";

type DragonflyClient = RedisClientType;

let connectionPromise: Promise<DragonflyClient> | null = null;
const ERROR_LOG_WINDOW_MS = 30000;
const errorLogTracker = new Map<string, { lastLoggedAt: number; suppressed: number }>();

function logDragonflyError(caller: string, error: unknown): void {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    const code = (errorObj as NodeJS.ErrnoException).code || 'unknown';
    const key = `${caller}:${code}:${errorObj.message}`;
    const now = Date.now();
    const tracked = errorLogTracker.get(key);

    if (tracked && now - tracked.lastLoggedAt < ERROR_LOG_WINDOW_MS) {
        tracked.suppressed += 1;
        errorLogTracker.set(key, tracked);
        return;
    }

    const suppressedCount = tracked?.suppressed || 0;
    errorLogTracker.set(key, { lastLoggedAt: now, suppressed: 0 });

    if (suppressedCount > 0) {
        console.error(`Error connecting to DragonFlyDB from ${caller} (suppressed ${suppressedCount} similar errors in last ${ERROR_LOG_WINDOW_MS / 1000}s)`, errorObj);
        return;
    }

    console.error(`Error connecting to DragonFlyDB from ${caller}`, errorObj);
}

export const getDragonflyClient = async (caller: string = 'unknown'): Promise<DragonflyClient> => {
    if (connectionPromise) return connectionPromise;

    const initConnection = async () => {
        const client = createClient({
            url: `redis://${process.env.DRAGONFLY_HOST}:${process.env.DRAGONFLY_PORT}`,
        })

        client.on('error', (error) => {
            logDragonflyError(caller, error);
        });

        client.on('connect', () => {
            console.log(`Connected to DragonFlyDB from ${caller}`);
        });

        try {
            await client.connect();
            return client as DragonflyClient;
        } catch (error) {
            logDragonflyError(caller, error);
            connectionPromise = null;
            throw error;
        }
        
    }

    connectionPromise = initConnection();

    return connectionPromise;
}
