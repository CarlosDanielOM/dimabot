import { monitorEventLoopDelay } from 'node:perf_hooks';
import { getDragonflyClient } from '../databases/dragonfly.database.js';

const HISTORY_LIMIT = Math.max(120, Number(process.env.BOT_METRICS_HISTORY_LIMIT || 5760));
const SNAPSHOT_INTERVAL_MS = Math.max(5000, Number(process.env.BOT_METRICS_INTERVAL_MS || 30000));
const KEY_PREFIX = String(process.env.BOT_METRICS_PREFIX || 'metrics:bot');
const KEY_RUNTIME_LATEST = `${KEY_PREFIX}:runtime:latest`;
const KEY_RUNTIME_HISTORY = `${KEY_PREFIX}:runtime:history`;
const KEY_RUNTIME_CUMULATIVE = `${KEY_PREFIX}:runtime:cumulative`;
const METRICS_TTL_SECONDS = Math.max(3600, Number(process.env.BOT_METRICS_TTL_SECONDS || 172800));
const SEMANTIC_METRICS_TTL_SECONDS = 24 * 60 * 60;

let metricsStarted = false;
let metricsTimer: NodeJS.Timeout | null = null;
const eventLoopHistogram = monitorEventLoopDelay({ resolution: 20 });
let inflightEventsubHandlers = 0;
let inflightMessageHandlers = 0;
let embeddingQueueSize = 0;
let embeddingProcessing = false;

interface Totals {
    maxInflightEventsubHandlers: number;
    maxInflightMessageHandlers: number;
    maxEmbeddingQueueSize: number;
}

interface WindowCounters {
    eventsubNotifications: number;
    eventsubNotificationBytes: number;
    eventsubHandled: number;
    eventsubHandleErrors: number;
    messageHandlerStarted: number;
    messageHandlerCompleted: number;
    messageHandlerErrors: number;
    embeddingEnqueued: number;
    embeddingBatchesSuccess: number;
    embeddingBatchesFailed: number;
    embeddingMessagesProcessed: number;
    redisOpsEstimated: number;
    openrouterEmbeddingRequests: number;
    openrouterEmbeddingErrors: number;
    openrouterEmbeddingInputChars: number;
}

interface EventsubHandlerTracker {
    startedAt: number;
    type: string;
}

interface MessageHandlerTracker {
    startedAt: number;
    type: string;
}

interface SemanticMemoryMetricInput {
    channelID: string;
    requested?: number;
    retrieved?: number;
    latencyMs?: number;
    avgScore?: number;
    failed?: boolean;
    pass?: string;
}

interface ThreadRoutingMetricInput {
    channelID: string;
    candidateCount?: number;
    selectedScore?: number;
    promptTurnsUsed?: number;
    latencyMs?: number;
    userEvictions?: number;
    channelEvictions?: number;
    failed?: boolean;
    created?: boolean;
    reused?: boolean;
}

interface StreamMemoryJobMetricInput {
    channelID: string;
    latencyMs?: number;
    failed?: boolean;
    status?: string;
    jobType?: string;
    source?: string;
}

interface StreamMemoryActionMetricInput {
    channelID: string;
    action?: string;
    source?: string;
    count?: number;
}

const totals: Totals = {
    maxInflightEventsubHandlers: 0,
    maxInflightMessageHandlers: 0,
    maxEmbeddingQueueSize: 0
};

let startedAt = Date.now();

const windowCounters: WindowCounters = {
    eventsubNotifications: 0,
    eventsubNotificationBytes: 0,
    eventsubHandled: 0,
    eventsubHandleErrors: 0,
    messageHandlerStarted: 0,
    messageHandlerCompleted: 0,
    messageHandlerErrors: 0,
    embeddingEnqueued: 0,
    embeddingBatchesSuccess: 0,
    embeddingBatchesFailed: 0,
    embeddingMessagesProcessed: 0,
    redisOpsEstimated: 0,
    openrouterEmbeddingRequests: 0,
    openrouterEmbeddingErrors: 0,
    openrouterEmbeddingInputChars: 0
};

const eventsubTypeWindowCounts = new Map<string, number>();
const eventsubTypeCumulativeCounts = new Map<string, number>();

function formatMinuteBucket(date: Date): string {
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const min = String(date.getUTCMinutes()).padStart(2, '0');
    return `${yyyy}${mm}${dd}${hh}${min}`;
}

function resetWindowCounters(): WindowCounters {
    const snapshot = { ...windowCounters };
    for (const key of Object.keys(windowCounters) as (keyof WindowCounters)[]) {
        windowCounters[key] = 0;
    }
    eventsubTypeWindowCounts.clear();
    return snapshot;
}

function snapshotEventsubTypeWindow(): Record<string, number> {
    return Object.fromEntries(eventsubTypeWindowCounts.entries());
}

function getActiveHandleCount(): number | null {
    const proc = process as NodeJS.Process & { _getActiveHandles?: () => unknown[] };
    if (typeof proc._getActiveHandles !== 'function') {
        return null;
    }
    return proc._getActiveHandles().length;
}

function getActiveRequestCount(): number | null {
    const proc = process as NodeJS.Process & { _getActiveRequests?: () => unknown[] };
    if (typeof proc._getActiveRequests !== 'function') {
        return null;
    }
    return proc._getActiveRequests().length;
}

function toMillis(nanos: number): number {
    if (!Number.isFinite(nanos)) {
        return 0;
    }
    return Number((nanos / 1_000_000).toFixed(3));
}

export function observeEventsubNotification(type: string, payloadBytes: number): void {
    const normalizedType = String(type || 'unknown');
    windowCounters.eventsubNotifications += 1;
    windowCounters.eventsubNotificationBytes += Math.max(0, payloadBytes || 0);
    eventsubTypeWindowCounts.set(normalizedType, (eventsubTypeWindowCounts.get(normalizedType) || 0) + 1);
    eventsubTypeCumulativeCounts.set(normalizedType, (eventsubTypeCumulativeCounts.get(normalizedType) || 0) + 1);
}

export function startEventsubHandlerMetric(type: string): EventsubHandlerTracker {
    inflightEventsubHandlers += 1;
    if (inflightEventsubHandlers > totals.maxInflightEventsubHandlers) {
        totals.maxInflightEventsubHandlers = inflightEventsubHandlers;
    }
    return {
        startedAt: Date.now(),
        type: String(type || 'unknown')
    };
}

export function endEventsubHandlerMetric(_tracker: EventsubHandlerTracker, failed?: boolean): void {
    inflightEventsubHandlers = Math.max(0, inflightEventsubHandlers - 1);
    windowCounters.eventsubHandled += 1;
    if (failed) {
        windowCounters.eventsubHandleErrors += 1;
    }
}

export function startMessageHandlerMetric(): MessageHandlerTracker {
    inflightMessageHandlers += 1;
    windowCounters.messageHandlerStarted += 1;
    if (inflightMessageHandlers > totals.maxInflightMessageHandlers) {
        totals.maxInflightMessageHandlers = inflightMessageHandlers;
    }
    return {
        startedAt: Date.now(),
        type: 'message_handler'
    };
}

export function endMessageHandlerMetric(_tracker: MessageHandlerTracker, failed?: boolean): void {
    inflightMessageHandlers = Math.max(0, inflightMessageHandlers - 1);
    windowCounters.messageHandlerCompleted += 1;
    if (failed) {
        windowCounters.messageHandlerErrors += 1;
    }
}

export function observeEmbeddingQueue(queueSize: number, isProcessing: boolean): void {
    embeddingQueueSize = Math.max(0, queueSize || 0);
    embeddingProcessing = Boolean(isProcessing);
    if (embeddingQueueSize > totals.maxEmbeddingQueueSize) {
        totals.maxEmbeddingQueueSize = embeddingQueueSize;
    }
}

export function recordEmbeddingEnqueued(queueSize: number): void {
    windowCounters.embeddingEnqueued += 1;
    observeEmbeddingQueue(queueSize, embeddingProcessing);
}

export function recordEmbeddingBatchResult(batchSize: number, success: boolean): void {
    if (success) {
        windowCounters.embeddingBatchesSuccess += 1;
        windowCounters.embeddingMessagesProcessed += Math.max(0, batchSize || 0);
    } else {
        windowCounters.embeddingBatchesFailed += 1;
    }
}

export function recordRedisOpsEstimate(count: number): void {
    windowCounters.redisOpsEstimated += Math.max(0, Math.round(count || 0));
}

export function recordOpenRouterEmbeddingRequest(inputChars: number): void {
    windowCounters.openrouterEmbeddingRequests += 1;
    windowCounters.openrouterEmbeddingInputChars += Math.max(0, inputChars || 0);
}

export function recordOpenRouterEmbeddingError(): void {
    windowCounters.openrouterEmbeddingErrors += 1;
}

export async function recordSemanticMemoryMetric(input: SemanticMemoryMetricInput): Promise<void> {
    try {
        const now = new Date();
        const cache = await getDragonflyClient('BotRuntimeMetrics.Semantic');
        const minuteBucket = formatMinuteBucket(now);
        const minuteKey = `${KEY_PREFIX}:semantic:minute:${minuteBucket}`;
        const cumulativeKey = `${KEY_PREFIX}:semantic:cumulative`;
        const channelMinuteKey = `${KEY_PREFIX}:semantic:channel:${input.channelID}:minute:${minuteBucket}`;

        const requested = Math.max(0, Math.round(input.requested || 0));
        const retrieved = Math.max(0, Math.round(input.retrieved || 0));
        const latencyMs = Math.max(0, Math.round(input.latencyMs || 0));
        const avgScoreMilli = Math.max(0, Math.round((input.avgScore || 0) * 1000));
        const failed = Boolean(input.failed);
        const pass = input.pass || 'none';

        await cache.hIncrBy(minuteKey, 'requests', 1);
        await cache.hIncrBy(minuteKey, 'requestedTotal', requested);
        await cache.hIncrBy(minuteKey, 'retrievedTotal', retrieved);
        await cache.hIncrBy(minuteKey, 'latencyMsTotal', latencyMs);
        await cache.hIncrBy(minuteKey, 'avgScoreMilliTotal', avgScoreMilli);
        if (failed) {
            await cache.hIncrBy(minuteKey, 'errors', 1);
        }
        await cache.hIncrBy(minuteKey, `pass:${pass}`, 1);

        await cache.hIncrBy(channelMinuteKey, 'requests', 1);
        await cache.hIncrBy(channelMinuteKey, 'requestedTotal', requested);
        await cache.hIncrBy(channelMinuteKey, 'retrievedTotal', retrieved);
        await cache.hIncrBy(channelMinuteKey, 'latencyMsTotal', latencyMs);
        await cache.hIncrBy(channelMinuteKey, 'avgScoreMilliTotal', avgScoreMilli);
        if (failed) {
            await cache.hIncrBy(channelMinuteKey, 'errors', 1);
        }
        await cache.hIncrBy(channelMinuteKey, `pass:${pass}`, 1);

        await cache.hIncrBy(cumulativeKey, 'requests', 1);
        await cache.hIncrBy(cumulativeKey, 'requestedTotal', requested);
        await cache.hIncrBy(cumulativeKey, 'retrievedTotal', retrieved);
        await cache.hIncrBy(cumulativeKey, 'latencyMsTotal', latencyMs);
        await cache.hIncrBy(cumulativeKey, 'avgScoreMilliTotal', avgScoreMilli);
        if (failed) {
            await cache.hIncrBy(cumulativeKey, 'errors', 1);
        }
        await cache.hIncrBy(cumulativeKey, `pass:${pass}`, 1);
        await cache.hSet(cumulativeKey, {
            updatedAt: now.toISOString()
        });

        await cache.expire(minuteKey, SEMANTIC_METRICS_TTL_SECONDS);
        await cache.expire(channelMinuteKey, SEMANTIC_METRICS_TTL_SECONDS);
        await cache.expire(cumulativeKey, SEMANTIC_METRICS_TTL_SECONDS);
    } catch (error) {
        console.error('Error recording semantic memory metrics:', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString(),
            channelID: input.channelID
        });
    }
}

export async function recordThreadRoutingMetric(input: ThreadRoutingMetricInput): Promise<void> {
    try {
        const now = new Date();
        const cache = await getDragonflyClient('BotRuntimeMetrics.ThreadRouting');
        const minuteBucket = formatMinuteBucket(now);
        const minuteKey = `${KEY_PREFIX}:threading:minute:${minuteBucket}`;
        const channelMinuteKey = `${KEY_PREFIX}:threading:channel:${input.channelID}:minute:${minuteBucket}`;
        const cumulativeKey = `${KEY_PREFIX}:threading:cumulative`;

        const candidateCount = Math.max(0, Math.round(input.candidateCount || 0));
        const scoreMilli = Math.max(0, Math.round((input.selectedScore || 0) * 1000));
        const promptTurnsUsed = Math.max(0, Math.round(input.promptTurnsUsed || 0));
        const latencyMs = Math.max(0, Math.round(input.latencyMs || 0));
        const userEvictions = Math.max(0, Math.round(input.userEvictions || 0));
        const channelEvictions = Math.max(0, Math.round(input.channelEvictions || 0));
        const failed = Boolean(input.failed);

        const incrementKeys = async (key: string): Promise<void> => {
            await cache.hIncrBy(key, 'requests', 1);
            await cache.hIncrBy(key, 'candidateCountTotal', candidateCount);
            await cache.hIncrBy(key, 'selectedScoreMilliTotal', scoreMilli);
            await cache.hIncrBy(key, 'promptTurnsTotal', promptTurnsUsed);
            await cache.hIncrBy(key, 'latencyMsTotal', latencyMs);
            await cache.hIncrBy(key, 'userEvictions', userEvictions);
            await cache.hIncrBy(key, 'channelEvictions', channelEvictions);
            if (input.created) {
                await cache.hIncrBy(key, 'created', 1);
            }
            if (input.reused) {
                await cache.hIncrBy(key, 'reused', 1);
            }
            if (failed) {
                await cache.hIncrBy(key, 'errors', 1);
            }
        };

        await incrementKeys(minuteKey);
        await incrementKeys(channelMinuteKey);
        await incrementKeys(cumulativeKey);

        await cache.hSet(cumulativeKey, {
            updatedAt: now.toISOString()
        });

        await cache.expire(minuteKey, SEMANTIC_METRICS_TTL_SECONDS);
        await cache.expire(channelMinuteKey, SEMANTIC_METRICS_TTL_SECONDS);
        await cache.expire(cumulativeKey, SEMANTIC_METRICS_TTL_SECONDS);
    } catch (error) {
        console.error('Error recording thread routing metrics:', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString(),
            channelID: input.channelID
        });
    }
}

export async function recordStreamMemoryJobMetric(input: StreamMemoryJobMetricInput): Promise<void> {
    try {
        const now = new Date();
        const cache = await getDragonflyClient('BotRuntimeMetrics.StreamMemory');
        const minuteBucket = formatMinuteBucket(now);
        const minuteKey = `${KEY_PREFIX}:stream_memory:job:minute:${minuteBucket}`;
        const channelMinuteKey = `${KEY_PREFIX}:stream_memory:job:channel:${input.channelID}:minute:${minuteBucket}`;
        const cumulativeKey = `${KEY_PREFIX}:stream_memory:job:cumulative`;

        const latencyMs = Math.max(0, Math.round(input.latencyMs || 0));
        const failed = Boolean(input.failed);
        const status = String(input.status || 'noop');
        const jobType = String(input.jobType || 'unknown');
        const source = String(input.source || 'stream_offline');

        const increment = async (key: string): Promise<void> => {
            await cache.hIncrBy(key, 'requests', 1);
            await cache.hIncrBy(key, `job:${jobType}`, 1);
            await cache.hIncrBy(key, `source:${source}`, 1);
            await cache.hIncrBy(key, `status:${status}`, 1);
            await cache.hIncrBy(key, 'latencyMsTotal', latencyMs);
            if (failed) {
                await cache.hIncrBy(key, 'errors', 1);
            }
        };

        await increment(minuteKey);
        await increment(channelMinuteKey);
        await increment(cumulativeKey);

        await cache.hSet(cumulativeKey, {
            updatedAt: now.toISOString()
        });

        await cache.expire(minuteKey, SEMANTIC_METRICS_TTL_SECONDS);
        await cache.expire(channelMinuteKey, SEMANTIC_METRICS_TTL_SECONDS);
        await cache.expire(cumulativeKey, SEMANTIC_METRICS_TTL_SECONDS);
    } catch (error) {
        console.error('Error recording stream memory job metrics:', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString(),
            channelID: input.channelID
        });
    }
}

export async function recordStreamMemoryActionMetric(input: StreamMemoryActionMetricInput): Promise<void> {
    try {
        const now = new Date();
        const cache = await getDragonflyClient('BotRuntimeMetrics.StreamMemory');
        const minuteBucket = formatMinuteBucket(now);
        const minuteKey = `${KEY_PREFIX}:stream_memory:action:minute:${minuteBucket}`;
        const channelMinuteKey = `${KEY_PREFIX}:stream_memory:action:channel:${input.channelID}:minute:${minuteBucket}`;
        const cumulativeKey = `${KEY_PREFIX}:stream_memory:action:cumulative`;

        const action = String(input.action || 'unknown');
        const source = String(input.source || 'stream_offline');
        const count = Math.max(0, Math.round(input.count || 0));

        if (count <= 0) {
            return;
        }

        const increment = async (key: string): Promise<void> => {
            await cache.hIncrBy(key, 'count', count);
            await cache.hIncrBy(key, `action:${action}`, count);
            await cache.hIncrBy(key, `source:${source}`, count);
        };

        await increment(minuteKey);
        await increment(channelMinuteKey);
        await increment(cumulativeKey);

        await cache.hSet(cumulativeKey, {
            updatedAt: now.toISOString()
        });

        await cache.expire(minuteKey, SEMANTIC_METRICS_TTL_SECONDS);
        await cache.expire(channelMinuteKey, SEMANTIC_METRICS_TTL_SECONDS);
        await cache.expire(cumulativeKey, SEMANTIC_METRICS_TTL_SECONDS);
    } catch (error) {
        console.error('Error recording stream memory action metrics:', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString(),
            channelID: input.channelID
        });
    }
}

async function flushRuntimeSnapshot(): Promise<void> {
    try {
        const cache = await getDragonflyClient('BotRuntimeMetrics');
        const now = new Date();
        const memory = process.memoryUsage();
        const elapsedMs = Date.now() - startedAt;
        const eventsubTypeWindow = snapshotEventsubTypeWindow();
        const windowSnapshot = resetWindowCounters();

        const eventLoopStats = {
            minMs: toMillis(eventLoopHistogram.min),
            maxMs: toMillis(eventLoopHistogram.max),
            meanMs: toMillis(eventLoopHistogram.mean),
            stddevMs: toMillis(eventLoopHistogram.stddev),
            p50Ms: toMillis(eventLoopHistogram.percentile(50)),
            p95Ms: toMillis(eventLoopHistogram.percentile(95)),
            p99Ms: toMillis(eventLoopHistogram.percentile(99))
        };
        eventLoopHistogram.reset();

        const eventsubTypeCumulative = Object.fromEntries(eventsubTypeCumulativeCounts.entries());

        const snapshot = {
            timestamp: now.toISOString(),
            process: {
                pid: process.pid,
                node: process.version,
                uptimeSeconds: Math.round(process.uptime()),
                startedAt: new Date(startedAt).toISOString(),
                elapsedMs
            },
            memory: {
                rssBytes: memory.rss,
                heapTotalBytes: memory.heapTotal,
                heapUsedBytes: memory.heapUsed,
                externalBytes: memory.external,
                arrayBuffersBytes: memory.arrayBuffers
            },
            runtime: {
                inflightEventsubHandlers,
                inflightMessageHandlers,
                activeHandles: getActiveHandleCount(),
                activeRequests: getActiveRequestCount(),
                embeddingQueueSize,
                embeddingProcessing
            },
            eventLoop: eventLoopStats,
            window: {
                durationMs: SNAPSHOT_INTERVAL_MS,
                ...windowSnapshot,
                eventsubByType: eventsubTypeWindow
            },
            totals: {
                ...totals,
                eventsubByType: eventsubTypeCumulative
            }
        };

        const serialized = JSON.stringify(snapshot);
        await cache.set(KEY_RUNTIME_LATEST, serialized, { EX: METRICS_TTL_SECONDS });
        await cache.lPush(KEY_RUNTIME_HISTORY, serialized);
        await cache.lTrim(KEY_RUNTIME_HISTORY, 0, HISTORY_LIMIT - 1);
        await cache.expire(KEY_RUNTIME_HISTORY, METRICS_TTL_SECONDS);

        const cumulativeEntries: Record<string, string> = {
            updatedAt: snapshot.timestamp,
            maxInflightEventsubHandlers: String(totals.maxInflightEventsubHandlers),
            maxInflightMessageHandlers: String(totals.maxInflightMessageHandlers),
            maxEmbeddingQueueSize: String(totals.maxEmbeddingQueueSize)
        };

        for (const [key, value] of Object.entries(windowSnapshot)) {
            await cache.hIncrBy(KEY_RUNTIME_CUMULATIVE, key, value);
        }
        for (const [type, count] of Object.entries(eventsubTypeWindow)) {
            await cache.hIncrBy(`${KEY_RUNTIME_CUMULATIVE}:eventsubByType`, type, Number(count));
        }
        await cache.hSet(KEY_RUNTIME_CUMULATIVE, cumulativeEntries);
        await cache.expire(KEY_RUNTIME_CUMULATIVE, METRICS_TTL_SECONDS);
        await cache.expire(`${KEY_RUNTIME_CUMULATIVE}:eventsubByType`, METRICS_TTL_SECONDS);

        const minuteBucket = formatMinuteBucket(now);
        const minuteKey = `${KEY_PREFIX}:eventsub:minute:${minuteBucket}`;
        const minuteMetaKey = `${KEY_PREFIX}:runtime:minute:${minuteBucket}`;

        await cache.hIncrBy(minuteKey, 'total', windowSnapshot.eventsubNotifications);
        await cache.hIncrBy(minuteMetaKey, 'messageHandlersStarted', windowSnapshot.messageHandlerStarted);
        await cache.hIncrBy(minuteMetaKey, 'messageHandlersCompleted', windowSnapshot.messageHandlerCompleted);
        await cache.hIncrBy(minuteMetaKey, 'embeddingEnqueued', windowSnapshot.embeddingEnqueued);
        await cache.hIncrBy(minuteMetaKey, 'embeddingProcessed', windowSnapshot.embeddingMessagesProcessed);
        await cache.hIncrBy(minuteMetaKey, 'redisOpsEstimated', windowSnapshot.redisOpsEstimated);

        for (const [type, count] of Object.entries(eventsubTypeWindow)) {
            await cache.hIncrBy(minuteKey, type, Number(count));
        }

        await cache.expire(minuteKey, METRICS_TTL_SECONDS);
        await cache.expire(minuteMetaKey, METRICS_TTL_SECONDS);
    } catch (error) {
        console.error('Error flushing bot runtime metrics:', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
    }
}

export function startBotRuntimeMetricsLoop(): void {
    if (metricsStarted) {
        return;
    }
    metricsStarted = true;
    startedAt = Date.now();
    eventLoopHistogram.enable();
    metricsTimer = setInterval(() => {
        void flushRuntimeSnapshot();
    }, SNAPSHOT_INTERVAL_MS);
    metricsTimer.unref?.();
    process.once('SIGTERM', () => {
        void flushRuntimeSnapshot();
    });
    process.once('SIGINT', () => {
        void flushRuntimeSnapshot();
    });
}
