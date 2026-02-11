import { getQdrantConnection } from '../../../databases/qdrant.database.js';
import { generateEmbedding, detectLanguage } from '../../../ai/openrouter/embeddings.ai.js';
import { error, debug } from '../../../logger.js';
import { createHash } from 'crypto';
import EmbeddingBatcher from '../../../../classes/embedding_batcher.class.js';

export interface IChatMessageData {
    channel_id: string;
    channel_name?: string;
    message: string;
    username: string;
    user_id: string;
    timestamp: number;
    language?: string;
}

export interface IStoreChatLogResult {
    error: boolean;
    message?: string;
    embeddingTime?: number;
    qdrantTime?: number;
    totalTime?: number;
}

const COLLECTION_NAME = 'twitch_chat_logs';

function generatePointId(channelId: string, userId: string, timestamp: number): number {
    const hash = createHash('md5')
        .update(`${channelId}:${userId}:${timestamp}`)
        .digest('hex');
    return parseInt(hash.substring(0, 8), 16);
}

/**
 * @deprecated This function is deprecated in favor of storeChatMessageEmbeddingBatched.
 * The batched version reduces API calls and improves performance.
 * Use storeChatMessageEmbeddingBatched() instead.
 */
export async function storeChatMessageEmbedding(data: IChatMessageData): Promise<IStoreChatLogResult> {
    const startTime = Date.now();
    const embeddingStart = Date.now();
    
    try {
        if (!data.message || data.message.trim().length === 0) {
            return {
                error: true,
                message: 'Message is empty'
            };
        }

        const language = data.language || detectLanguage(data.message, 0.1);

        const embeddingResult = await generateEmbedding(data.message);
        
        const embeddingEnd = Date.now();
        const embeddingTime = embeddingEnd - embeddingStart;

        if (embeddingResult.error || !embeddingResult.embedding) {
            error({
                message: 'Failed to generate embedding for chat message',
                error: embeddingResult.message,
                channel_id: data.channel_id,
                username: data.username,
                user_id: data.user_id,
                chatMessage: data.message.substring(0, 100)
            });
            return {
                error: true,
                message: embeddingResult.message || 'Failed to generate embedding',
                embeddingTime
            };
        }

        const qdrantStart = Date.now();
        const qdrantClient = await getQdrantConnection('storeChatMessageEmbedding');
        
        const pointId = generatePointId(data.channel_id, data.user_id, data.timestamp);
        
        await qdrantClient.upsert(COLLECTION_NAME, {
            wait: false,
            points: [
                {
                    id: pointId,
                    vector: embeddingResult.embedding,
                    payload: {
                        channel_id: data.channel_id,
                        channel_name: data.channel_name,
                        username: data.username,
                        user_id: data.user_id,
                        message: data.message,
                        timestamp: data.timestamp,
                        language: language
                    }
                }
            ]
        });

        const qdrantEnd = Date.now();
        const qdrantTime = qdrantEnd - qdrantStart;
        const totalTime = Date.now() - startTime;

        debug({
            message: 'Chat message embedding stored successfully',
            channel_id: data.channel_id,
            channel_name: data.channel_name,
            username: data.username,
            user_id: data.user_id,
            language: language,
            embeddingTime,
            qdrantTime,
            totalTime
        }, { destination: 'cache' });

        return {
            error: false,
            embeddingTime,
            qdrantTime,
            totalTime
        };
    } catch (err) {
        const embeddingTime = Date.now() - embeddingStart;
        const totalTime = Date.now() - startTime;
        
        error({
            message: 'Error storing chat message embedding',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            channel_id: data.channel_id,
            username: data.username,
            user_id: data.user_id,
            chatMessage: data.message.substring(0, 100),
            embeddingTime,
            totalTime
        });
        return {
            error: true,
            message: 'Failed to store chat message embedding',
            embeddingTime,
            totalTime
        };
    }
}

export async function storeChatMessageEmbeddingBatched(data: IChatMessageData): Promise<void> {
    try {
        if (!data.message || data.message.trim().length === 0) {
            return;
        }

        EmbeddingBatcher.addMessage({
            text: data.message,
            channel_id: data.channel_id,
            channel_name: data.channel_name,
            username: data.username,
            user_id: data.user_id,
            timestamp: data.timestamp,
            language: data.language
        });
    } catch (err) {
        error({
            message: 'Error adding message to embedding batcher',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            channel_id: data.channel_id,
            username: data.username,
            user_id: data.user_id,
            chatMessage: data.message.substring(0, 100)
        });
    }
}
