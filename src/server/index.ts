import path from 'path';
import dotenv from 'dotenv';

const isDev = process.env.NODE_ENV !== 'production';

if (isDev) {
    dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
}

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

//? Imports after dotenv config
import { getDragonflyClient } from '../utils/databases/dragonfly.database.js';
import { getMongoDBConnection } from '../utils/databases/mongodb.database.js';
import { getQdrantConnection } from '../utils/databases/qdrant.database.js';
import { QdrantStartUp } from '../utils/qdrant/start_up.qdrant.js';
import TwitchStreamers from '../classes/twitch_streamers.class.js';
import { pubSubManager } from '../classes/pubsub_manager.class.js';
import { server } from './server.js';
import { websocket } from './websocket.js';
import { clipQueueHandler } from '../handlers/clip_queue.handler.js';
import { getPolarShClient } from '../utils/polarsh.js';
import { info, error } from '../utils/logger.js';
import { reconcileLiveSessionsOnStartup, startStreamAnalyticsWorker } from '../utils/stream_analytics.js';

await getDragonflyClient('Server');
await getMongoDBConnection('Server');
await getQdrantConnection('Server');
await getPolarShClient('Server');
// Initialize PubSub for clip queue
await pubSubManager.init();

//! Qdrant Start Up
await QdrantStartUp();

await TwitchStreamers.getTwitchAccountsFromDB();

// Initialize clip queue handler
await clipQueueHandler.init();

await reconcileLiveSessionsOnStartup();

startStreamAnalyticsWorker();

// Run startup cleanup for clip queue
// TODO: Reactivate startup cleanup when testing is complete
// await clipQueueHandler.startupCleanup();

const app = await server();
const websocketServer = await websocket(app);

if (websocketServer) {
    websocketServer.listen(3000, () => {
        info({ message: 'Server listening on port 3000' }, { destination: 'console' });
    });
} else {
    await error({ message: 'Failed to initialize websocket server' }, { destination: 'both' });
    process.exit(1);
}
