import { TwitchChatLogsQdrantCollection } from "../../utils/qdrant/collections/twitch/message.qdrant.collection.js";
import { TwitchChannelMemoriesQdrantCollection } from "../../utils/qdrant/collections/twitch/memory.qdrant.collection.js";

export const QDRANT_COLLECTIONS = [TwitchChatLogsQdrantCollection, TwitchChannelMemoriesQdrantCollection]