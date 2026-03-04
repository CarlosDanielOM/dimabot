import { getQdrantConnection } from '../../../databases/qdrant.database.js';
import { error } from '../../../logger.js';

const COLLECTION_NAME = 'twitch_chat_logs';
const MAX_FETCH_LIMIT = 500;
const MAX_SCROLL_ITERATIONS = 12;

export interface IChatWindowParams {
    channelID: string;
    fromUnix: number;
    toUnix: number;
    limit: number;
}

export interface IChatWindowItem {
    channel_id: string;
    username: string;
    user_id: string;
    message: string;
    timestamp: number;
    language?: string;
}

export interface IChatWindowResult {
    error: boolean;
    message?: string;
    items: IChatWindowItem[];
}

interface IScrollResult {
    points: unknown[];
    nextOffset: unknown;
}

function normalizeTimestamp(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return 0;
    }
    return Math.floor(parsed);
}

function parsePoint(point: unknown): IChatWindowItem | null {
    const payload = (point as { payload?: Record<string, unknown> } | undefined)?.payload || {};
    const message = String(payload.message || '').trim();
    const channelID = String(payload.channel_id || '').trim();
    const timestamp = normalizeTimestamp(payload.timestamp);

    if (!message || !channelID || timestamp <= 0) {
        return null;
    }

    return {
        channel_id: channelID,
        username: String(payload.username || 'unknown'),
        user_id: String(payload.user_id || 'unknown'),
        message,
        timestamp,
        language: payload.language ? String(payload.language) : undefined
    };
}

function normalizeScrollResult(raw: unknown): IScrollResult {
    if (!raw) {
        return { points: [], nextOffset: null };
    }

    const direct = raw as { points?: unknown[]; next_page_offset?: unknown };
    if (Array.isArray(direct.points)) {
        return { points: direct.points, nextOffset: direct.next_page_offset ?? null };
    }

    const nested = raw as { result?: { points?: unknown[]; next_page_offset?: unknown } | unknown[] };
    if (nested.result && !Array.isArray(nested.result) && Array.isArray(nested.result.points)) {
        return { points: nested.result.points, nextOffset: nested.result.next_page_offset ?? null };
    }

    if (Array.isArray(nested.result)) {
        return { points: nested.result, nextOffset: null };
    }

    return { points: [], nextOffset: null };
}

export async function retrieveChannelChatWindow(params: IChatWindowParams): Promise<IChatWindowResult> {
    try {
        const channelID = String(params.channelID || '').trim();
        const fromUnix = normalizeTimestamp(params.fromUnix);
        const toUnix = normalizeTimestamp(params.toUnix);
        const limit = Math.max(1, Math.min(MAX_FETCH_LIMIT, normalizeTimestamp(params.limit)));

        if (!channelID || fromUnix <= 0 || toUnix <= 0 || fromUnix > toUnix) {
            return {
                error: true,
                message: 'Invalid chat window parameters',
                items: []
            };
        }

        const qdrant = await getQdrantConnection('retrieveChannelChatWindow');
        const filter = {
            must: [
                { key: 'channel_id', match: { value: channelID } },
                {
                    key: 'timestamp',
                    range: {
                        gte: fromUnix,
                        lte: toUnix
                    }
                }
            ]
        };

        const points: unknown[] = [];
        let offset: unknown = null;
        let iterations = 0;

        while (points.length < limit && iterations < MAX_SCROLL_ITERATIONS) {
            iterations += 1;
            const chunkSize = Math.min(120, limit - points.length);
            const scrollParams: Record<string, unknown> = {
                filter,
                with_payload: true,
                with_vector: false,
                limit: chunkSize
            };

            if (offset !== null && offset !== undefined) {
                scrollParams.offset = offset;
            }

            let raw: unknown;
            const clientAny = qdrant as unknown as {
                scroll?: (collection: string, params: Record<string, unknown>) => Promise<unknown>;
                scrollPoints?: (collection: string, params: Record<string, unknown>) => Promise<unknown>;
            };

            if (typeof clientAny.scroll === 'function') {
                raw = await clientAny.scroll(COLLECTION_NAME, scrollParams);
            } else if (typeof clientAny.scrollPoints === 'function') {
                raw = await clientAny.scrollPoints(COLLECTION_NAME, scrollParams);
            } else {
                break;
            }

            const normalized = normalizeScrollResult(raw);
            points.push(...normalized.points);

            if (!normalized.nextOffset) {
                break;
            }
            offset = normalized.nextOffset;
        }

        const items = points
            .map(parsePoint)
            .filter((item): item is IChatWindowItem => Boolean(item))
            .filter((item) => item.channel_id === channelID && item.timestamp >= fromUnix && item.timestamp <= toUnix)
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(0, limit);

        return {
            error: false,
            items
        };
    } catch (err) {
        await error({
            function: 'retrieveChannelChatWindow',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            channelID: params.channelID,
            fromUnix: params.fromUnix,
            toUnix: params.toUnix,
            limit: params.limit
        }, { channelId: params.channelID, destination: 'both' });

        return {
            error: true,
            message: 'Failed to retrieve chat window context',
            items: []
        };
    }
}
