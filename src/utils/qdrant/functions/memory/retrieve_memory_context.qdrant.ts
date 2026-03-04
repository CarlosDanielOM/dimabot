import { generateEmbedding } from '../../../ai/openrouter/embeddings.ai.js';
import { getQdrantConnection } from '../../../databases/qdrant.database.js';
import { debug, error } from '../../../logger.js';

const COLLECTION_NAME = 'twitch_channel_memories';
const DEFAULT_MIN_SCORE = 0.72;

export interface IRetrievedMemoryItem {
    score: number;
    memory_id: string;
    channel_id: string;
    memory_type: string;
    status: string;
    risk: string;
    confidence: number;
    subject_scope: string;
    subject_username?: string;
    content: string;
    summary: string;
    updated_at: number;
}

export interface IRetrieveChannelMemoryContextParams {
    channelID: string;
    query: string;
    limit: number;
    minScore?: number;
}

export interface IRetrieveChannelMemoryContextResult {
    error: boolean;
    message?: string;
    items: IRetrievedMemoryItem[];
}

interface IQdrantPoint {
    id?: string | number;
    score?: number;
    distance?: number;
    payload?: {
        content?: string;
        channel_id?: string;
        memory_id?: string;
        memory_type?: string;
        status?: string;
        risk?: string;
        confidence?: number;
        subject_scope?: string;
        subject_username?: string;
        summary?: string;
        updated_at?: number;
    };
}

interface IQdrantQueryResponse {
    points?: IQdrantPoint[];
    result?: IQdrantPoint[];
    hits?: IQdrantPoint[];
}

function normalizeQdrantPoints(raw: IQdrantQueryResponse | IQdrantPoint[] | null | undefined): IQdrantPoint[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw.points)) return raw.points;
    if (Array.isArray(raw.result)) return raw.result;
    if (Array.isArray(raw.hits)) return raw.hits;
    return [];
}

function parsePoint(point: IQdrantPoint): IRetrievedMemoryItem | null {
    const payload = point?.payload || {};
    const content = String(payload.content || '').trim();
    const channelId = String(payload.channel_id || '').trim();
    const memoryId = String(payload.memory_id || point?.id || '').trim();

    if (!content || !channelId || !memoryId) {
        return null;
    }

    const rawScore = point?.score ?? point?.distance;
    const score = typeof rawScore === 'number' ? rawScore : 0;

    return {
        score,
        memory_id: memoryId,
        channel_id: channelId,
        memory_type: String(payload.memory_type || 'channel_lore'),
        status: String(payload.status || 'confirmed'),
        risk: String(payload.risk || 'low'),
        confidence: Number(payload.confidence || 0),
        subject_scope: String(payload.subject_scope || 'channel'),
        subject_username: payload.subject_username ? String(payload.subject_username) : undefined,
        content,
        summary: String(payload.summary || content),
        updated_at: Number(payload.updated_at || 0)
    };
}

async function queryPoints(
    qdrantClient: { query?: Function; search?: Function; queryPoints?: Function },
    channelID: string,
    embedding: number[],
    limit: number,
    minScore: number
): Promise<IQdrantPoint[]> {
    const filter = {
        must: [
            {
                key: 'channel_id',
                match: { value: channelID }
            },
            {
                key: 'status',
                match: { value: 'confirmed' }
            }
        ]
    };

    if (typeof qdrantClient.query === 'function') {
        const rawResults = await qdrantClient.query(COLLECTION_NAME, {
            query: embedding,
            limit: limit * 3,
            with_payload: true,
            filter,
            score_threshold: minScore
        });
        return normalizeQdrantPoints(rawResults as IQdrantQueryResponse);
    }

    if (typeof qdrantClient.search === 'function') {
        const rawResults = await qdrantClient.search(COLLECTION_NAME, {
            vector: embedding,
            limit: limit * 3,
            with_payload: true,
            filter,
            score_threshold: minScore
        });
        return normalizeQdrantPoints(rawResults as IQdrantQueryResponse);
    }

    if (typeof qdrantClient.queryPoints === 'function') {
        const rawResults = await qdrantClient.queryPoints(COLLECTION_NAME, {
            query: embedding,
            limit: limit * 3,
            with_payload: true,
            filter,
            score_threshold: minScore
        });
        return normalizeQdrantPoints(rawResults as IQdrantQueryResponse);
    }

    throw new Error('Qdrant client does not support query/search');
}

export async function retrieveChannelMemoryContext(
    params: IRetrieveChannelMemoryContextParams
): Promise<IRetrieveChannelMemoryContextResult> {
    try {
        if (!params.channelID || !params.query || !params.limit) {
            return {
                error: true,
                message: 'Missing required parameters',
                items: []
            };
        }

        const embeddingResult = await generateEmbedding(params.query);
        if (embeddingResult.error || !embeddingResult.embedding) {
            return {
                error: true,
                message: embeddingResult.message || 'Failed to generate embedding',
                items: []
            };
        }

        const minScore = params.minScore ?? DEFAULT_MIN_SCORE;
        const qdrantClient = await getQdrantConnection('retrieveChannelMemoryContext');
        const rawPoints = await queryPoints(qdrantClient, params.channelID, embeddingResult.embedding, params.limit, minScore);

        const items = rawPoints
            .map(parsePoint)
            .filter((item): item is IRetrievedMemoryItem => item !== null)
            .filter((item) => item.channel_id === params.channelID && item.score >= minScore)
            .sort((a, b) => {
                if (b.score === a.score) {
                    return b.updated_at - a.updated_at;
                }
                return b.score - a.score;
            })
            .slice(0, params.limit);

        debug({
            message: 'Channel memory context retrieved',
            channelID: params.channelID,
            requestedLimit: params.limit,
            retrieved: items.length,
            minScore
        }, { destination: 'cache' });

        return {
            error: false,
            items
        };
    } catch (err) {
        await error({
            function: 'retrieveChannelMemoryContext',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
        }, { channelId: params.channelID, destination: 'both' });

        return {
            error: true,
            message: 'Failed to retrieve channel memory context',
            items: []
        };
    }
}
