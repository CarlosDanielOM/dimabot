import { randomUUID } from 'node:crypto';
import { getDragonflyClient } from '../../databases/dragonfly.database.js';
import type { ThreadLimits } from './thread_limits.js';

const THREAD_TTL_SECONDS = 24 * 60 * 60;

export interface ThreadTurn {
    role: 'user' | 'assistant';
    userID?: string;
    username?: string;
    message: string;
    timestamp: number;
    sourceMessageId?: string;
    delivered?: boolean;
}

export interface ThreadMeta {
    threadID: string;
    channelID: string;
    ownerUserID: string;
    ownerUsername: string;
    createdAt: string;
    updatedAt: string;
    lastActivityTs: number;
    status: 'active' | 'archived' | 'deleted';
    topicSeed: string;
    topicKeywords: string[];
    messageCount: number;
    lastUserMessage?: string;
    lastAssistantMessage?: string;
}

export interface PromptContextTurn {
    timestamp: number;
    username: string;
    message: string;
    badges?: string;
}

function channelThreadsKey(channelID: string): string {
    return `twitch:${channelID}:ai:threads:active`;
}

function userThreadsKey(channelID: string, userID: string): string {
    return `twitch:${channelID}:ai:user:${userID}:threads`;
}

function threadMetaKey(channelID: string, threadID: string): string {
    return `twitch:${channelID}:ai:thread:${threadID}:meta`;
}

function threadTurnsKey(channelID: string, threadID: string): string {
    return `twitch:${channelID}:ai:thread:${threadID}:turns`;
}

function safeJsonParse<T>(payload: string | null): T | null {
    if (!payload) return null;
    try {
        return JSON.parse(payload) as T;
    } catch {
        return null;
    }
}

function extractKeywords(text: string): string[] {
    const normalized = String(text || '').toLowerCase();
    const tokens = normalized
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3)
        .filter((token) => !['the', 'and', 'that', 'with', 'this', 'you', 'que', 'pero', 'para', 'como', 'con', 'una', 'por', 'wow'].includes(token));
    return Array.from(new Set(tokens)).slice(0, 12);
}

async function getRecentSortedSetMembers(key: string, limit: number): Promise<string[]> {
    const cache = await getDragonflyClient('ThreadStore.GetRecentMembers');
    const normalizedLimit = Math.max(0, limit);
    if (normalizedLimit === 0) return [];
    try {
        const result = await (cache as { zRange(key: string, start: number, stop: number): Promise<string[]> }).zRange(key, -normalizedLimit, -1);
        if (!Array.isArray(result)) {
            return [];
        }
        return result.reverse();
    } catch {
        const result = await (cache as { zRange(key: string, start: number, stop: number): Promise<string[]> }).zRange(key, 0, -1);
        if (!Array.isArray(result)) {
            return [];
        }
        return result.reverse().slice(0, limit);
    }
}

async function getOldestSortedSetMembers(key: string, count: number): Promise<string[]> {
    const cache = await getDragonflyClient('ThreadStore.GetOldestMembers');
    const normalizedCount = Math.max(0, count);
    if (normalizedCount === 0) return [];
    try {
        const result = await (cache as { zRange(key: string, start: number, stop: number): Promise<string[]> }).zRange(key, 0, normalizedCount - 1);
        return Array.isArray(result) ? result : [];
    } catch {
        return [];
    }
}

export async function getThreadMeta(channelID: string, threadID: string): Promise<ThreadMeta | null> {
    const cache = await getDragonflyClient('ThreadStore.GetMeta');
    const serialized = await cache.get(threadMetaKey(channelID, threadID));
    return safeJsonParse<ThreadMeta>(serialized);
}

export async function getThreadTurns(channelID: string, threadID: string, limit: number): Promise<ThreadTurn[]> {
    const cache = await getDragonflyClient('ThreadStore.GetTurns');
    const entries = await cache.lRange(threadTurnsKey(channelID, threadID), 0, Math.max(0, limit - 1));
    const turns = entries
        .map((entry) => safeJsonParse<ThreadTurn>(entry))
        .filter((entry): entry is ThreadTurn => entry !== null)
        .reverse();
    return turns;
}

export async function createThread(
    channelID: string,
    userID: string,
    username: string,
    seedMessage: string,
    timestamp: number
): Promise<ThreadMeta> {
    const threadID = randomUUID();
    const nowIso = new Date(timestamp).toISOString();
    const meta: ThreadMeta = {
        threadID,
        channelID,
        ownerUserID: userID,
        ownerUsername: username,
        createdAt: nowIso,
        updatedAt: nowIso,
        lastActivityTs: timestamp,
        status: 'active',
        topicSeed: seedMessage.slice(0, 220),
        topicKeywords: extractKeywords(seedMessage),
        messageCount: 0
    };
    const cache = await getDragonflyClient('ThreadStore.Create');
    await cache.set(threadMetaKey(channelID, threadID), JSON.stringify(meta), { EX: THREAD_TTL_SECONDS });
    return meta;
}

export async function appendThreadTurn(
    channelID: string,
    threadID: string,
    turn: ThreadTurn,
    limits: ThreadLimits
): Promise<void> {
    const cache = await getDragonflyClient('ThreadStore.AppendTurn');
    const nowTs = turn.timestamp || Date.now();
    const metaKey = threadMetaKey(channelID, threadID);
    const turnsKey = threadTurnsKey(channelID, threadID);
    const currentMeta = await getThreadMeta(channelID, threadID);
    if (!currentMeta) {
        return;
    }
    currentMeta.updatedAt = new Date(nowTs).toISOString();
    currentMeta.lastActivityTs = nowTs;
    currentMeta.messageCount += 1;
    if (turn.role === 'user') {
        currentMeta.lastUserMessage = turn.message;
        const mergedKeywords = new Set([...currentMeta.topicKeywords, ...extractKeywords(turn.message)]);
        currentMeta.topicKeywords = Array.from(mergedKeywords).slice(0, 18);
    }
    if (turn.role === 'assistant') {
        currentMeta.lastAssistantMessage = turn.message;
    }
    await cache.lPush(turnsKey, JSON.stringify(turn));
    await cache.lTrim(turnsKey, 0, Math.max(0, limits.maxTurnsStored - 1));
    await cache.expire(turnsKey, THREAD_TTL_SECONDS);
    await cache.set(metaKey, JSON.stringify(currentMeta), { EX: THREAD_TTL_SECONDS });
}

export async function touchThreadIndexes(channelID: string, userID: string, threadID: string, score: number): Promise<void> {
    const cache = await getDragonflyClient('ThreadStore.TouchIndexes');
    await cache.zAdd(channelThreadsKey(channelID), { score, value: threadID });
    await cache.zAdd(userThreadsKey(channelID, userID), { score, value: threadID });
    await cache.expire(channelThreadsKey(channelID), THREAD_TTL_SECONDS);
    await cache.expire(userThreadsKey(channelID, userID), THREAD_TTL_SECONDS);
}

export async function removeThread(channelID: string, threadID: string): Promise<void> {
    const cache = await getDragonflyClient('ThreadStore.RemoveThread');
    const meta = await getThreadMeta(channelID, threadID);
    await cache.zRem(channelThreadsKey(channelID), threadID);
    if (meta?.ownerUserID) {
        await cache.zRem(userThreadsKey(channelID, meta.ownerUserID), threadID);
    }
    await cache.del(threadMetaKey(channelID, threadID));
    await cache.del(threadTurnsKey(channelID, threadID));
}

export async function enforceThreadLimits(
    channelID: string,
    userID: string,
    limits: ThreadLimits
): Promise<{ userEvicted: number; channelEvicted: number }> {
    const cache = await getDragonflyClient('ThreadStore.EnforceLimits');
    let userEvicted = 0;
    let channelEvicted = 0;
    const userKey = userThreadsKey(channelID, userID);
    const userCount = await cache.zCard(userKey);
    if (userCount > limits.maxUserThreads) {
        const overflow = userCount - limits.maxUserThreads;
        const evictThreadIds = await getOldestSortedSetMembers(userKey, overflow);
        for (const threadID of evictThreadIds) {
            await removeThread(channelID, threadID);
            userEvicted += 1;
        }
    }
    const channelKey = channelThreadsKey(channelID);
    const channelCount = await cache.zCard(channelKey);
    if (channelCount > limits.maxChannelThreads) {
        const overflow = channelCount - limits.maxChannelThreads;
        const evictThreadIds = await getOldestSortedSetMembers(channelKey, overflow);
        for (const threadID of evictThreadIds) {
            await removeThread(channelID, threadID);
            channelEvicted += 1;
        }
    }
    return { userEvicted, channelEvicted };
}

export async function getUserThreadCandidates(channelID: string, userID: string, limit: number): Promise<ThreadMeta[]> {
    const threadIds = await getRecentSortedSetMembers(userThreadsKey(channelID, userID), Math.max(1, limit));
    const metas: ThreadMeta[] = [];
    for (const threadID of threadIds) {
        const meta = await getThreadMeta(channelID, threadID);
        if (!meta || meta.status !== 'active') continue;
        metas.push(meta);
    }
    return metas;
}

export async function getThreadPromptContext(
    channelID: string,
    threadID: string,
    promptTurns: number
): Promise<PromptContextTurn[]> {
    const turns = await getThreadTurns(channelID, threadID, Math.max(1, promptTurns));
    return turns.map((turn) => ({
        timestamp: turn.timestamp,
        username: turn.username || (turn.role === 'assistant' ? 'DomDimaBot' : 'UnknownUser'),
        message: turn.message,
        badges: turn.role === 'assistant' ? '🤖' : undefined
    }));
}
