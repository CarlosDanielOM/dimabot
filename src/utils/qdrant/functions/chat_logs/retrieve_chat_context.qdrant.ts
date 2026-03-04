import { detectLanguage, generateEmbedding } from '../../../ai/openrouter/embeddings.ai.js';
import { getQdrantConnection } from '../../../databases/qdrant.database.js';
import { debug, error } from '../../../logger.js';
import { recordSemanticMemoryMetric } from '../../../observability/bot_runtime_metrics.js';

const COLLECTION_NAME = 'twitch_chat_logs';
const DEFAULT_PRIMARY_MIN_SCORE = 0.75;
const DEFAULT_FALLBACK_MIN_SCORE = 0.69;

export interface ISemanticChatContextParams {
    channelID: string;
    query: string;
    limit: number;
    primaryMinScore?: number;
    fallbackMinScore?: number;
}

export interface ISemanticChatItem {
    score: number;
    channel_id: string;
    username: string;
    user_id: string;
    message: string;
    timestamp: number;
    language?: string;
}

export interface ISemanticPassResult {
    pass: 'high' | 'fallback';
    threshold: number;
    rawMatches: number;
    keptMatches: number;
}

export interface ISemanticChatContextResult {
    error: boolean;
    message?: string;
    items: ISemanticChatItem[];
    selectedPass: 'high' | 'fallback' | 'none';
    passResults: ISemanticPassResult[];
}

export function getSemanticMemoryLimitForTier(planTier: string): number {
    if (planTier === 'pro') return 15;
    if (planTier === 'premium') return 6;
    return 3;
}

function normalizeQdrantPoints(raw: unknown): unknown[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;

    const asRecord = raw as { points?: unknown[]; result?: unknown[]; hits?: unknown[] };
    if (Array.isArray(asRecord.points)) return asRecord.points;
    if (Array.isArray(asRecord.result)) return asRecord.result;
    if (Array.isArray(asRecord.hits)) return asRecord.hits;

    return [];
}

function parseSemanticMemory(point: unknown): ISemanticChatItem | null {
    const typedPoint = point as { payload?: Record<string, unknown>; score?: unknown; distance?: unknown };
    const payload = typedPoint?.payload || {};
    const message = String(payload.message || '').trim();
    const channelId = String(payload.channel_id || '').trim();

    if (!message || !channelId) {
        return null;
    }

    const rawScore = typedPoint?.score ?? typedPoint?.distance;
    const score = typeof rawScore === 'number' ? rawScore : Number(rawScore || 0);

    return {
        score,
        channel_id: channelId,
        username: String(payload.username || 'unknown'),
        user_id: String(payload.user_id || 'unknown'),
        message,
        timestamp: Number(payload.timestamp || 0),
        language: payload.language ? String(payload.language) : undefined
    };
}

async function querySemanticPoints(
    qdrantClient: unknown,
    channelID: string,
    embedding: number[],
    limit: number,
    minScore: number
): Promise<unknown[]> {
    const filter = {
        must: [
            {
                key: 'channel_id',
                match: { value: channelID }
            }
        ]
    };

    const clientAny = qdrantClient as {
        query?: (collection: string, params: Record<string, unknown>) => Promise<unknown>;
        search?: (collection: string, params: Record<string, unknown>) => Promise<unknown>;
        queryPoints?: (collection: string, params: Record<string, unknown>) => Promise<unknown>;
    };

    if (typeof clientAny.query === 'function') {
        const rawResults = await clientAny.query(COLLECTION_NAME, {
            query: embedding,
            limit: limit * 3,
            with_payload: true,
            filter,
            score_threshold: minScore
        });
        return normalizeQdrantPoints(rawResults);
    }

    if (typeof clientAny.search === 'function') {
        const rawResults = await clientAny.search(COLLECTION_NAME, {
            vector: embedding,
            limit: limit * 3,
            with_payload: true,
            filter,
            score_threshold: minScore
        });
        return normalizeQdrantPoints(rawResults);
    }

    if (typeof clientAny.queryPoints === 'function') {
        const rawResults = await clientAny.queryPoints(COLLECTION_NAME, {
            query: embedding,
            limit: limit * 3,
            with_payload: true,
            filter,
            score_threshold: minScore
        });
        return normalizeQdrantPoints(rawResults);
    }

    throw new Error('Qdrant client does not support query/search');
}

function dedupeAndSort(channelID: string, points: unknown[], threshold: number, limit: number): ISemanticChatItem[] {
    const parsed = points
        .map(parseSemanticMemory)
        .filter((item): item is ISemanticChatItem => {
            if (!item) return false;
            if (item.channel_id !== channelID) return false;
            return item.score >= threshold;
        });

    const uniqueByMessage = new Map<string, ISemanticChatItem>();
    for (const item of parsed) {
        if (item.message.length < 3) continue;
        if (!uniqueByMessage.has(item.message)) {
            uniqueByMessage.set(item.message, item);
        }
    }

    return Array.from(uniqueByMessage.values())
        .sort((a, b) => {
            if (b.score === a.score) {
                return b.timestamp - a.timestamp;
            }
            return b.score - a.score;
        })
        .slice(0, limit);
}

export async function retrieveSemanticChatContext(params: ISemanticChatContextParams): Promise<ISemanticChatContextResult> {
    const startedAt = Date.now();

    try {
        if (!params.channelID || !params.query || !params.limit) {
            void recordSemanticMemoryMetric({
                channelID: params.channelID,
                requested: params.limit,
                retrieved: 0,
                avgScore: 0,
                latencyMs: Date.now() - startedAt,
                failed: true,
                pass: 'none'
            });

            return {
                error: true,
                message: 'Missing required parameters',
                items: [],
                selectedPass: 'none',
                passResults: []
            };
        }

        const queryText = String(params.query || '').trim();
        const language = detectLanguage(queryText, 0.1);
        const embeddingResult = await generateEmbedding(queryText, language);

        if (embeddingResult.error || !embeddingResult.embedding) {
            void recordSemanticMemoryMetric({
                channelID: params.channelID,
                requested: params.limit,
                retrieved: 0,
                avgScore: 0,
                latencyMs: Date.now() - startedAt,
                failed: true,
                pass: 'none'
            });

            return {
                error: true,
                message: embeddingResult.message || 'Failed to generate embedding',
                items: [],
                selectedPass: 'none',
                passResults: []
            };
        }

        const qdrantClient = await getQdrantConnection('retrieveSemanticChatContext');
        const primaryMinScore = params.primaryMinScore ?? DEFAULT_PRIMARY_MIN_SCORE;
        const fallbackMinScore = params.fallbackMinScore ?? DEFAULT_FALLBACK_MIN_SCORE;
        const passResults: ISemanticPassResult[] = [];

        const firstPassPoints = await querySemanticPoints(
            qdrantClient,
            params.channelID,
            embeddingResult.embedding,
            params.limit,
            primaryMinScore
        );
        const firstPassItems = dedupeAndSort(params.channelID, firstPassPoints, primaryMinScore, params.limit);
        passResults.push({
            pass: 'high',
            threshold: primaryMinScore,
            rawMatches: firstPassPoints.length,
            keptMatches: firstPassItems.length
        });

        let items = firstPassItems;
        let selectedPass: 'high' | 'fallback' | 'none' = firstPassItems.length > 0 ? 'high' : 'none';

        if (items.length === 0) {
            const secondPassPoints = await querySemanticPoints(
                qdrantClient,
                params.channelID,
                embeddingResult.embedding,
                params.limit,
                fallbackMinScore
            );
            const secondPassItems = dedupeAndSort(params.channelID, secondPassPoints, fallbackMinScore, params.limit);
            passResults.push({
                pass: 'fallback',
                threshold: fallbackMinScore,
                rawMatches: secondPassPoints.length,
                keptMatches: secondPassItems.length
            });

            if (secondPassItems.length > 0) {
                items = secondPassItems;
                selectedPass = 'fallback';
            }
        }

        const avgScore = items.length > 0
            ? items.reduce((acc, item) => acc + item.score, 0) / items.length
            : 0;

        void recordSemanticMemoryMetric({
            channelID: params.channelID,
            requested: params.limit,
            retrieved: items.length,
            avgScore,
            latencyMs: Date.now() - startedAt,
            failed: false,
            pass: selectedPass
        });

        void debug({
            message: 'Semantic memory retrieved',
            channel_id: params.channelID,
            requestedLimit: params.limit,
            retrieved: items.length,
            selectedPass,
            passResults
        }, { destination: 'cache' });

        return {
            error: false,
            items,
            selectedPass,
            passResults
        };
    } catch (err) {
        void recordSemanticMemoryMetric({
            channelID: params.channelID,
            requested: params.limit,
            retrieved: 0,
            avgScore: 0,
            latencyMs: Date.now() - startedAt,
            failed: true,
            pass: 'none'
        });

        await error({
            function: 'retrieveSemanticChatContext',
            error: err instanceof Error ? err.message : String(err)
        }, { channelId: params.channelID, destination: 'both' });

        return {
            error: true,
            message: 'Failed to retrieve semantic memory',
            items: [],
            selectedPass: 'none',
            passResults: []
        };
    }
}
