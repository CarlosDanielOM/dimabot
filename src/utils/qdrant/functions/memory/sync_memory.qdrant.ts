import { generateEmbedding } from '../../../ai/openrouter/embeddings.ai.js';
import { getQdrantConnection } from '../../../databases/qdrant.database.js';
import { error, debug } from '../../../logger.js';

const COLLECTION_NAME = 'twitch_channel_memories';

export interface IUpsertChannelMemoryParams {
    memoryId: string;
    channelID: string;
    memoryType?: string;
    status?: string;
    risk?: string;
    confidence?: number;
    subjectScope?: string;
    subjectUsername?: string;
    content: string;
    summary: string;
    createdAtUnix?: number;
    updatedAtUnix?: number;
}

export interface IUpsertChannelMemoryResult {
    error: boolean;
    message?: string;
}

export interface IDeleteChannelMemoryResult {
    error: boolean;
    message?: string;
}

function buildEmbeddingInput(summary: string | undefined, content: string | undefined): string {
    const cleanSummary = String(summary || '').trim();
    const cleanContent = String(content || '').trim();
    return `${cleanSummary}\n${cleanContent}`.trim();
}

export async function upsertChannelMemoryEmbedding(params: IUpsertChannelMemoryParams): Promise<IUpsertChannelMemoryResult> {
    try {
        if (!params.memoryId || !params.channelID) {
            return {
                error: true,
                message: 'Missing memoryId or channelID'
            };
        }

        const embeddingInput = buildEmbeddingInput(params.summary, params.content);
        if (!embeddingInput) {
            return {
                error: true,
                message: 'Memory content is empty'
            };
        }

        const embeddingResult = await generateEmbedding(embeddingInput);
        if (embeddingResult.error || !embeddingResult.embedding) {
            return {
                error: true,
                message: embeddingResult.message || 'Failed to generate memory embedding'
            };
        }

        const qdrantClient = await getQdrantConnection('upsertChannelMemoryEmbedding');
        await qdrantClient.upsert(COLLECTION_NAME, {
            wait: false,
            points: [
                {
                    id: params.memoryId,
                    vector: embeddingResult.embedding,
                    payload: {
                        memory_id: params.memoryId,
                        channel_id: params.channelID,
                        memory_type: params.memoryType,
                        status: params.status,
                        risk: params.risk,
                        confidence: params.confidence,
                        subject_scope: params.subjectScope,
                        subject_username: params.subjectUsername || '',
                        content: params.content,
                        summary: params.summary,
                        created_at: params.createdAtUnix,
                        updated_at: params.updatedAtUnix
                    }
                }
            ]
        });

        debug({
            message: 'Channel memory embedding upserted',
            memoryId: params.memoryId,
            channelID: params.channelID,
            status: params.status,
            type: params.memoryType
        }, { destination: 'cache' });

        return { error: false };
    } catch (err) {
        await error({
            function: 'upsertChannelMemoryEmbedding',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            memoryId: params.memoryId,
            channelID: params.channelID
        }, { channelId: params.channelID, destination: 'both' });

        return {
            error: true,
            message: 'Failed to upsert channel memory embedding'
        };
    }
}

export async function deleteChannelMemoryEmbedding(memoryId: string, channelID?: string): Promise<IDeleteChannelMemoryResult> {
    try {
        if (!memoryId) {
            return {
                error: true,
                message: 'Missing memoryId'
            };
        }

        const qdrantClient = await getQdrantConnection('deleteChannelMemoryEmbedding');
        await qdrantClient.delete(COLLECTION_NAME, {
            wait: false,
            points: [memoryId]
        });

        return { error: false };
    } catch (err) {
        await error({
            function: 'deleteChannelMemoryEmbedding',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            memoryId
        }, { channelId: channelID, destination: 'both' });

        return {
            error: true,
            message: 'Failed to delete channel memory embedding'
        };
    }
}
