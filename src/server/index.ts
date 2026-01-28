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
import { server } from './server.js';
import { websocket } from './websocket.js';

await getDragonflyClient('Server');
await getMongoDBConnection('Server');
await getQdrantConnection('Server');

//! Qdrant Start Up
await QdrantStartUp();

await TwitchStreamers.getTwitchAccountsFromDB();

const app = await server();
const websocketServer = await websocket(app);

websocketServer!.listen(3000, () => {
    console.log('Server listening on port 3000');
});
