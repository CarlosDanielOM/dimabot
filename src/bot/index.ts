import dotenv from 'dotenv';
import path from 'path';

const isDev = process.env.NODE_ENV !== 'production';

console.log(process.env.NODE_ENV ?? 'No NODE_ENV found');
if(isDev) {
    dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
    console.log('Loaded .env.local');
}

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

//? Imports after dotenv config

import { getDragonflyClient } from '../utils/databases/dragonfly.database.js';
import { getMongoDBConnection } from '../utils/databases/mongodb.database.js';
import { getQdrantConnection } from '../utils/databases/qdrant.database.js';
import { pubSubManager } from '../classes/pubsub_manager.class.js';
import TwitchStreamers from '../classes/twitch_streamers.class.js';
import { twitchEventsub } from './eventsub.twitch.js';
import ChatHistory from '../classes/chat_history.js';
import { getPolarShClient } from '../utils/polarsh.js';
//? TODO: Add other eventsub imports

await getDragonflyClient('Bot');
await getMongoDBConnection('Bot');
await getQdrantConnection('Bot');
await getPolarShClient('Bot');

// Initialize PubSub for clip queue
await pubSubManager.init();

await TwitchStreamers.getTwitchAccountsFromDB();

twitchEventsub();

//? TODO: Add refresh Tokens intervals