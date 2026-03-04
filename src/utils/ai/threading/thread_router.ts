import { getThreadLimitsForTier, type PlanTier, type ThreadLimits } from './thread_limits.js';
import {
    appendThreadTurn,
    createThread,
    enforceThreadLimits,
    getThreadMeta,
    getThreadPromptContext,
    getThreadTurns,
    getUserThreadCandidates,
    touchThreadIndexes,
    type ThreadMeta,
    type ThreadTurn,
    type PromptContextTurn
} from './thread_store.js';
import { recordThreadRoutingMetric } from '../../observability/bot_runtime_metrics.js';

const THREAD_MATCH_THRESHOLD = 0.55;

export interface ResolveThreadParams {
    channelID: string;
    userID: string;
    username: string;
    message: string;
    planTier: PlanTier;
    sourceMessageId?: string;
}

export interface AppendAssistantParams {
    channelID: string;
    threadID: string;
    message: string;
    planTier: PlanTier;
    sourceMessageId?: string;
    delivered?: boolean;
}

export interface ResolvedThread {
    threadID: string;
    createdNewThread: boolean;
    selectedScore: number;
    threshold: number;
    candidateCount: number;
    promptTurnsUsed: number;
    limits: ThreadLimits;
    promptContext: PromptContextTurn[];
}

function tokenize(text: string): string[] {
    return String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3)
        .slice(0, 64);
}

function lexicalSimilarity(aTokens: string[], bTokens: string[]): number {
    if (!aTokens.length || !bTokens.length) return 0;
    const aSet = new Set(aTokens);
    const bSet = new Set(bTokens);
    let overlap = 0;
    for (const token of aSet) {
        if (bSet.has(token)) overlap += 1;
    }
    return overlap / Math.max(aSet.size, bSet.size);
}

function recencyScore(lastActivityTs: number, nowTs: number): number {
    const deltaMs = Math.max(0, nowTs - lastActivityTs);
    const hours = deltaMs / (1000 * 60 * 60);
    return Math.max(0, 1 - hours / 24);
}

async function scoreThread(meta: ThreadMeta, incomingMessage: string, userID: string): Promise<number> {
    const nowTs = Date.now();
    const messageTokens = tokenize(incomingMessage);
    const metaTokens = meta.topicKeywords || [];
    const recentTurns = await getThreadTurns(meta.channelID, meta.threadID, 4);
    const recentTurnTokens = tokenize(recentTurns.map((turn) => turn.message).join(' '));
    const lexicalMeta = lexicalSimilarity(messageTokens, metaTokens);
    const lexicalTurns = lexicalSimilarity(messageTokens, recentTurnTokens);
    const lexicalScore = Math.max(lexicalMeta, lexicalTurns);
    const recency = recencyScore(meta.lastActivityTs, nowTs);
    const continuity = meta.ownerUserID === userID ? 1 : 0.2;
    return lexicalScore * 0.45 + recency * 0.35 + continuity * 0.2;
}

export async function resolveUserThreadForMessage(params: ResolveThreadParams): Promise<ResolvedThread> {
    const startedAt = Date.now();
    const limits = getThreadLimitsForTier(params.planTier);
    const nowTs = Date.now();
    try {
        const candidates = await getUserThreadCandidates(
            params.channelID,
            params.userID,
            Math.max(5, limits.maxUserThreads * 3)
        );
        let bestMeta: ThreadMeta | null = null;
        let bestScore = 0;
        for (const candidate of candidates) {
            const score = await scoreThread(candidate, params.message, params.userID);
            if (score > bestScore) {
                bestScore = score;
                bestMeta = candidate;
            }
        }
        let selectedThread: ThreadMeta;
        let createdNewThread = false;
        if (!bestMeta || bestScore < THREAD_MATCH_THRESHOLD) {
            selectedThread = await createThread(
                params.channelID,
                params.userID,
                params.username,
                params.message,
                nowTs
            );
            createdNewThread = true;
        } else {
            selectedThread = bestMeta;
        }
        await touchThreadIndexes(params.channelID, params.userID, selectedThread.threadID, nowTs);
        const promptContext = await getThreadPromptContext(
            params.channelID,
            selectedThread.threadID,
            limits.promptTurns
        );
        const userTurn: ThreadTurn = {
            role: 'user',
            userID: params.userID,
            username: params.username,
            message: params.message,
            timestamp: nowTs,
            sourceMessageId: params.sourceMessageId
        };
        await appendThreadTurn(params.channelID, selectedThread.threadID, userTurn, limits);
        const evicted = await enforceThreadLimits(params.channelID, params.userID, limits);
        void recordThreadRoutingMetric({
            channelID: params.channelID,
            created: createdNewThread,
            reused: !createdNewThread,
            candidateCount: candidates.length,
            selectedScore: bestScore,
            promptTurnsUsed: limits.promptTurns,
            userEvictions: evicted.userEvicted,
            channelEvictions: evicted.channelEvicted,
            latencyMs: Date.now() - startedAt,
            failed: false
        });
        return {
            threadID: selectedThread.threadID,
            createdNewThread,
            selectedScore: bestScore,
            threshold: THREAD_MATCH_THRESHOLD,
            candidateCount: candidates.length,
            promptTurnsUsed: limits.promptTurns,
            limits,
            promptContext
        };
    } catch {
        void recordThreadRoutingMetric({
            channelID: params.channelID,
            created: false,
            reused: false,
            candidateCount: 0,
            selectedScore: 0,
            promptTurnsUsed: limits.promptTurns,
            userEvictions: 0,
            channelEvictions: 0,
            latencyMs: Date.now() - startedAt,
            failed: true
        });
        const fallbackThread = await createThread(
            params.channelID,
            params.userID,
            params.username,
            params.message,
            nowTs
        );
        await touchThreadIndexes(params.channelID, params.userID, fallbackThread.threadID, nowTs);
        const fallbackTurn: ThreadTurn = {
            role: 'user',
            userID: params.userID,
            username: params.username,
            message: params.message,
            timestamp: nowTs,
            sourceMessageId: params.sourceMessageId
        };
        await appendThreadTurn(params.channelID, fallbackThread.threadID, fallbackTurn, limits);
        return {
            threadID: fallbackThread.threadID,
            createdNewThread: true,
            selectedScore: 0,
            threshold: THREAD_MATCH_THRESHOLD,
            candidateCount: 0,
            promptTurnsUsed: limits.promptTurns,
            limits,
            promptContext: []
        };
    }
}

export async function appendAssistantTurnToThread(params: AppendAssistantParams): Promise<void> {
    const limits = getThreadLimitsForTier(params.planTier);
    const nowTs = Date.now();
    const meta = await getThreadMeta(params.channelID, params.threadID);
    const assistantTurn: ThreadTurn = {
        role: 'assistant',
        username: 'DomDimaBot',
        message: params.message,
        timestamp: nowTs,
        sourceMessageId: params.sourceMessageId,
        delivered: params.delivered
    };
    await appendThreadTurn(params.channelID, params.threadID, assistantTurn, limits);
    if (meta?.ownerUserID) {
        await touchThreadIndexes(params.channelID, meta.ownerUserID, params.threadID, nowTs);
    }
}
