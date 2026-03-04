import { StreamSessionSchema } from '../../../schemas/stream_session.schema.js';
import { StreamViewerSnapshotSchema } from '../../../schemas/stream_viewer_snapshot.schema.js';
import { ChannelAIMemorySchema } from '../../../schemas/channel_ai_memory.schema.js';
import { getQdrantConnection } from '../../databases/qdrant.database.js';
import { error as logError } from '../../logger.js';

const DEFAULT_CHAT_LIMIT = Math.max(40, Number(process.env.STREAM_MEMORY_SUMMARY_CHAT_LIMIT || 240));
const DEFAULT_EXISTING_MEMORY_LIMIT = Math.max(25, Number(process.env.STREAM_MEMORY_EXISTING_MEMORY_LIMIT || 120));
const QDRANT_COLLECTION_NAME = 'twitch_chat_logs';
const QDRANT_MAX_FETCH_LIMIT = 500;
const QDRANT_MAX_SCROLL_ITERATIONS = 12;

export interface BuildStreamSummaryContextParams {
    channelID: string;
    sessionID?: string;
    streamID?: string;
}

export interface SessionSummary {
    id: string;
    streamID: string;
    channel: string;
    status: string;
    startedAt: string;
    endedAt: string;
    durationMinutes: number;
    averageViewers: number;
    peakViewers: number;
    follows: number;
    subs: number;
    bits: number;
    donations: number;
}

export interface SnapshotSummary {
    capturedAt: string;
    viewers: number;
    title: string;
    gameName: string;
}

export interface ChatMessageItem {
    channel_id: string;
    username: string;
    user_id: string;
    message: string;
    timestamp: number;
    language?: string;
}

export interface SampledChatMessage {
    username: string;
    message: string;
    timestamp: number;
}

export interface ExistingMemorySummary {
    memoryID: string;
    status: string;
    type: string;
    confidence: number;
    summary: string;
    content: string;
    useCount: number;
    lastUsedAt?: string;
    updatedAt?: string;
}

export interface StreamSummaryContext {
    channelID: string;
    session: SessionSummary;
    snapshots: SnapshotSummary[];
    chatMessages: ChatMessageItem[];
    sampledChatMessages: SampledChatMessage[];
    existingMemories: ExistingMemorySummary[];
}

export interface BuildStreamSummaryContextResult {
    error: boolean;
    message?: string;
    context?: StreamSummaryContext;
}

interface RetrieveChatWindowParams {
    channelID: string;
    fromUnix: number;
    toUnix: number;
    limit: number;
}

interface RetrieveChatWindowResult {
    error: boolean;
    message?: string;
    items: ChatMessageItem[];
}

interface QdrantScrollResult {
    points: unknown[];
    nextOffset: unknown;
}

interface QdrantPoint {
    payload?: {
        message?: string;
        channel_id?: string;
        timestamp?: number;
        username?: string;
        user_id?: string;
        language?: string;
    };
}

function normalizeTimestamp(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return 0;
    }
    return Math.floor(parsed);
}

function parsePoint(point: unknown): ChatMessageItem | null {
    const payload = (point as QdrantPoint | undefined)?.payload || {};
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

function normalizeScrollResult(raw: unknown): QdrantScrollResult {
    if (!raw) {
        return { points: [], nextOffset: null };
    }
    const rawObj = raw as Record<string, unknown>;
    if (Array.isArray((rawObj as { points?: unknown }).points)) {
        return {
            points: (rawObj as { points: unknown[] }).points,
            nextOffset: (rawObj as { next_page_offset?: unknown }).next_page_offset || null
        };
    }
    if (rawObj.result && Array.isArray((rawObj.result as { points?: unknown }).points)) {
        return {
            points: (rawObj.result as { points: unknown[] }).points,
            nextOffset: ((rawObj.result as { next_page_offset?: unknown }).next_page_offset) || null
        };
    }
    if (Array.isArray(rawObj.result)) {
        return { points: rawObj.result as unknown[], nextOffset: null };
    }
    return { points: [], nextOffset: null };
}

async function retrieveChannelChatWindow(params: RetrieveChatWindowParams): Promise<RetrieveChatWindowResult> {
    try {
        const channelID = String(params.channelID || '').trim();
        const fromUnix = normalizeTimestamp(params.fromUnix);
        const toUnix = normalizeTimestamp(params.toUnix);
        const limit = Math.max(1, Math.min(QDRANT_MAX_FETCH_LIMIT, normalizeTimestamp(params.limit)));
        
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
        
        while (points.length < limit && iterations < QDRANT_MAX_SCROLL_ITERATIONS) {
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
            const qdrantClient = qdrant as { scroll?: Function; scrollPoints?: Function };
            
            if (typeof qdrantClient.scroll === 'function') {
                raw = await qdrantClient.scroll(QDRANT_COLLECTION_NAME, scrollParams);
            } else if (typeof qdrantClient.scrollPoints === 'function') {
                raw = await qdrantClient.scrollPoints(QDRANT_COLLECTION_NAME, scrollParams);
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
            .filter((item): item is ChatMessageItem => Boolean(item))
            .filter((item) => item.channel_id === channelID && item.timestamp >= fromUnix && item.timestamp <= toUnix)
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(0, limit);
        
        return {
            error: false,
            items
        };
    } catch (err) {
        await logError({
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

function normalizeTimestampMs(value: unknown): number {
    const date = value instanceof Date ? value : new Date(value as string | number);
    const ms = date.getTime();
    if (!Number.isFinite(ms) || ms <= 0) {
        return Date.now();
    }
    return ms;
}

interface StreamSessionDocument {
    _id: { toString(): string };
    duration_minutes?: number;
    started_at: Date;
    ended_at?: Date | null;
    stream_id?: string;
    channel?: string;
    status?: string;
    average_viewers?: number;
    peak_viewers?: number;
    follows?: number;
    subs?: number;
    bits?: number;
    donations?: number;
}

function getDurationMinutes(session: StreamSessionDocument): number {
    if ((session.duration_minutes ?? 0) > 0) {
        return session.duration_minutes!;
    }
    const startedMs = normalizeTimestampMs(session.started_at);
    const endedMs = normalizeTimestampMs(session.ended_at || new Date());
    return Math.max(0, Math.round((endedMs - startedMs) / 60000));
}

function sampleChatMessages(messages: ChatMessageItem[], maxItems = 80): ChatMessageItem[] {
    if (messages.length <= maxItems) {
        return messages;
    }
    
    const sampled: ChatMessageItem[] = [];
    const thirds = [
        messages.slice(0, Math.floor(messages.length / 3)),
        messages.slice(Math.floor(messages.length / 3), Math.floor((messages.length * 2) / 3)),
        messages.slice(Math.floor((messages.length * 2) / 3))
    ];
    
    for (const bucket of thirds) {
        if (!bucket.length) {
            continue;
        }
        const step = Math.max(1, Math.floor(bucket.length / Math.max(1, Math.floor(maxItems / 3))));
        for (let i = 0; i < bucket.length && sampled.length < maxItems; i += step) {
            sampled.push(bucket[i]);
        }
    }
    
    if (sampled.length < maxItems) {
        const missing = maxItems - sampled.length;
        const tail = messages.slice(-missing);
        sampled.push(...tail);
    }
    
    const unique = new Map<string, ChatMessageItem>();
    for (const message of sampled) {
        const key = `${message.timestamp}:${message.user_id}:${message.message}`;
        if (!unique.has(key)) {
            unique.set(key, message);
        }
    }
    
    return Array.from(unique.values())
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(0, maxItems);
}

interface ResolveTargetSessionParams {
    channelID: string;
    sessionID?: string;
    streamID?: string;
}

async function resolveTargetSession(params: ResolveTargetSessionParams): Promise<StreamSessionDocument | null> {
    const sessionID = String(params.sessionID || '').trim();
    const streamID = String(params.streamID || '').trim();
    
    if (sessionID) {
        const bySessionID = await StreamSessionSchema.findOne({ _id: sessionID, channelID: params.channelID }).lean();
        if (bySessionID) {
            return bySessionID as unknown as StreamSessionDocument;
        }
    }
    
    if (streamID) {
        const byStreamID = await StreamSessionSchema.findOne({
            channelID: params.channelID,
            stream_id: streamID,
            ended_at: { $ne: null }
        }).sort({ ended_at: -1 }).lean();
        if (byStreamID) {
            return byStreamID as unknown as StreamSessionDocument;
        }
    }
    
    const latestClosed = await StreamSessionSchema.findOne({
        channelID: params.channelID,
        ended_at: { $ne: null }
    }).sort({ ended_at: -1 }).lean();
    
    return latestClosed as unknown as StreamSessionDocument | null;
}

export async function buildStreamSummaryContext(params: BuildStreamSummaryContextParams): Promise<BuildStreamSummaryContextResult> {
    try {
        const channelID = String(params.channelID || '').trim();
        if (!channelID) {
            return {
                error: true,
                message: 'Invalid channel ID'
            };
        }
        
        const session = await resolveTargetSession({
            channelID,
            sessionID: params.sessionID,
            streamID: params.streamID
        });
        
        if (!session || !session.ended_at) {
            return {
                error: true,
                message: 'No closed stream session found'
            };
        }
        
        const startedUnix = Math.floor(normalizeTimestampMs(session.started_at) / 1000);
        const endedUnix = Math.floor(normalizeTimestampMs(session.ended_at) / 1000);
        
        const [snapshots, chatWindow, existingMemories] = await Promise.all([
            StreamViewerSnapshotSchema.find({
                channelID,
                session_id: session._id
            }).sort({ captured_at: 1 }).lean(),
            retrieveChannelChatWindow({
                channelID,
                fromUnix: startedUnix,
                toUnix: endedUnix,
                limit: DEFAULT_CHAT_LIMIT
            }),
            ChannelAIMemorySchema.find({
                channelID,
                status: { $in: ['confirmed', 'archived'] }
            }).sort({ updatedAt: -1 }).limit(DEFAULT_EXISTING_MEMORY_LIMIT).lean()
        ]);
        
        const chatMessages = chatWindow.error ? [] : chatWindow.items;
        const sampledChatMessages = sampleChatMessages(chatMessages, 90).map((message) => ({
            username: message.username,
            message: message.message,
            timestamp: message.timestamp
        }));
        
        interface SnapshotDocument {
            captured_at: Date;
            viewers?: number;
            title?: string;
            game_name?: string;
        }
        
        interface MemoryDocument {
            _id: { toString(): string };
            status?: string;
            type?: string;
            confidence?: number;
            summary?: string;
            content?: string;
            useCount?: number;
            lastUsedAt?: Date;
            updatedAt?: Date;
        }
        
        const context: StreamSummaryContext = {
            channelID,
            session: {
                id: String(session._id),
                streamID: String(session.stream_id || ''),
                channel: String(session.channel || ''),
                status: String(session.status || 'offline'),
                startedAt: new Date(session.started_at).toISOString(),
                endedAt: new Date(session.ended_at).toISOString(),
                durationMinutes: getDurationMinutes(session),
                averageViewers: Number(session.average_viewers || 0),
                peakViewers: Number(session.peak_viewers || 0),
                follows: Number(session.follows || 0),
                subs: Number(session.subs || 0),
                bits: Number(session.bits || 0),
                donations: Number(session.donations || 0)
            },
            snapshots: (snapshots as unknown as SnapshotDocument[]).map((snapshot) => ({
                capturedAt: new Date(snapshot.captured_at).toISOString(),
                viewers: Number(snapshot.viewers || 0),
                title: String(snapshot.title || ''),
                gameName: String(snapshot.game_name || '')
            })),
            chatMessages,
            sampledChatMessages,
            existingMemories: (existingMemories as unknown as MemoryDocument[]).map((memory) => ({
                memoryID: String(memory._id),
                status: String(memory.status || 'confirmed'),
                type: String(memory.type || 'channel_lore'),
                confidence: Number(memory.confidence || 0),
                summary: String(memory.summary || ''),
                content: String(memory.content || ''),
                useCount: Number(memory.useCount || 0),
                lastUsedAt: memory.lastUsedAt ? new Date(memory.lastUsedAt).toISOString() : undefined,
                updatedAt: memory.updatedAt ? new Date(memory.updatedAt).toISOString() : undefined
            }))
        };
        
        return {
            error: false,
            context
        };
    } catch (error) {
        console.error('Error in buildStreamSummaryContext:', {
            channelID: params.channelID,
            sessionID: params.sessionID,
            streamID: params.streamID,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
        
        return {
            error: true,
            message: 'Failed to build stream summary context'
        };
    }
}
