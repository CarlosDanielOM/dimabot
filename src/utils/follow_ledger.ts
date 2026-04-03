import { type ClientSession } from 'mongoose';
import UsersSchema from '../schemas/users.schema.js';
import { FollowRelationshipLedgerSchema } from '../schemas/follow_relationship_ledger.schema.js';
import TwitchStreamers from '../classes/twitch_streamers.class.js';
import { getTwitchStreamerHeaderById } from './header.js';
import { getTwitchHelixUrl } from './links.js';
import { executeHelixStreamerRequestWith401Retry } from './twitch_helix_retry.js';

const DEFAULT_BATCH_SIZE = 250;
const FOLLOW_START_MAX_ATTEMPTS = 3;

// Type definitions

export interface RecordFollowLedgerStartInput {
    follower_id?: string;
    follower_login?: string;
    follower_name?: string;
    followed_id?: string;
    followed_login?: string;
    followed_name?: string;
    followed_at?: Date | string;
    platform?: string;
}

export interface HelixFollowerItem {
    user_id: string;
    user_login: string;
    user_name: string;
    followed_at: string;
}

export interface HelixFollowedItem {
    broadcaster_id: string;
    broadcaster_login: string;
    broadcaster_name: string;
    followed_at: string;
}

export interface HelixFollowersPageResponse {
    error: boolean;
    message: string;
    status?: number;
    followers: HelixFollowerItem[];
    total?: number;
    nextCursor?: string;
}

export interface HelixFollowedPageResponse {
    error: boolean;
    message: string;
    status?: number;
    followed: HelixFollowedItem[];
    total?: number;
    nextCursor?: string;
}

export interface FollowSyncStats {
    totalFromApi: number;
    requests: number;
    pages: number;
    activeUpserts: number;
    endedCount: number;
}

export interface FollowLedgerSyncOptions {
    writeBatchSize?: number;
    beforeRequest?: () => Promise<void>;
    beforeFollowersRequest?: () => Promise<void>;
    beforeFollowingRequest?: () => Promise<void>;
}

export interface FollowLedgerSyncResult {
    error: boolean;
    message: string;
    channelID?: string;
    status?: number;
    totalFromApi: number;
    requests: number;
    pages: number;
    activeUpserts: number;
    endedCount: number;
}

interface SyncIncomingResult {
    error: boolean;
    message: string;
    stats: FollowSyncStats;
}

interface SyncOutgoingResult {
    error: boolean;
    message: string;
    stats: FollowSyncStats;
}

// Utility functions

function normalizeValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function toDate(value: unknown): Date {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }
    return new Date();
}

function chunkValues<T>(values: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }
    return chunks;
}

function hasMongoErrorLabel(error: unknown, label: string): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }
    const mongoError = error as { hasErrorLabel?: (label: string) => boolean; errorLabels?: string[] };
    if (typeof mongoError.hasErrorLabel === 'function') {
        return mongoError.hasErrorLabel(label);
    }
    if (Array.isArray(mongoError.errorLabels)) {
        return mongoError.errorLabels.includes(label);
    }
    return false;
}

function isRetryableFollowStartError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }
    const mongoError = error as { code?: number };
    const code = typeof mongoError.code === 'number' ? mongoError.code : -1;
    const retryableCodes = new Set([11000, 112, 91, 189, 251]);
    if (retryableCodes.has(code)) {
        return true;
    }
    if (hasMongoErrorLabel(error, 'TransientTransactionError')) {
        return true;
    }
    if (hasMongoErrorLabel(error, 'UnknownTransactionCommitResult')) {
        return true;
    }
    return false;
}

function isTransactionUnsupportedError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }
    const mongoError = error as { message?: string };
    const message = String(mongoError.message || '').toLowerCase();
    return message.includes('transaction numbers are only allowed on a replica set member or mongos');
}

async function runBulkWriteInChunks(
    operations: Array<{ updateOne: { filter: Record<string, unknown>; update: Record<string, unknown>; upsert?: boolean } }>,
    chunkSize: number
): Promise<void> {
    if (operations.length === 0) {
        return;
    }
    const batches = chunkValues(operations, Math.max(1, chunkSize));
    for (const batch of batches) {
        await FollowRelationshipLedgerSchema.bulkWrite(batch, { ordered: false });
    }
}

async function fetchFollowersPage(
    channelID: string,
    cursor: string | null,
    _header: unknown,
    beforeRequest?: () => Promise<void>
): Promise<HelixFollowersPageResponse> {
    try {
        if (beforeRequest) {
            await beforeRequest();
        }
        const params = new URLSearchParams({
            broadcaster_id: channelID,
            first: '100'
        });
        if (cursor) {
            params.set('after', cursor);
        }
        const request = await executeHelixStreamerRequestWith401Retry({
            worker: 'follow_ledger',
            operation: 'fetch_followers_page',
            channelID,
            context: { cursor },
            requestUrl: getTwitchHelixUrl('channels/followers', params.toString()),
            requestMethod: 'GET',
            executeRequest: async (headers) => fetch(getTwitchHelixUrl('channels/followers', params.toString()), {
                method: 'GET',
                headers: headers as Record<string, string>
            })
        });
        if (request.error) {
            return {
                error: true,
                message: request.message || 'Unknown error',
                status: request.status,
                followers: []
            };
        }
        const response = request.response!;
        const payload = await response.json() as { data?: HelixFollowerItem[]; total?: number; pagination?: { cursor?: string }; error?: boolean; message?: string; status?: number };
        if (!response.ok || payload.error) {
            return {
                error: true,
                message: payload.message || `Failed to fetch followers for ${channelID}`,
                status: payload.status || response.status,
                followers: []
            };
        }
        return {
            error: false,
            message: 'Followers page fetched',
            followers: Array.isArray(payload.data) ? payload.data : [],
            total: typeof payload.total === 'number' ? payload.total : 0,
            nextCursor: payload.pagination?.cursor
        };
    } catch (error) {
        return {
            error: true,
            message: error instanceof Error ? error.message : String(error),
            followers: []
        };
    }
}

async function fetchFollowedPage(
    channelID: string,
    cursor: string | null,
    _header: unknown,
    beforeRequest?: () => Promise<void>
): Promise<HelixFollowedPageResponse> {
    try {
        if (beforeRequest) {
            await beforeRequest();
        }
        const params = new URLSearchParams({
            user_id: channelID,
            first: '100'
        });
        if (cursor) {
            params.set('after', cursor);
        }
        const request = await executeHelixStreamerRequestWith401Retry({
            worker: 'follow_ledger',
            operation: 'fetch_followed_page',
            channelID,
            context: { cursor },
            requestUrl: getTwitchHelixUrl('channels/followed', params.toString()),
            requestMethod: 'GET',
            executeRequest: async (headers) => fetch(getTwitchHelixUrl('channels/followed', params.toString()), {
                method: 'GET',
                headers: headers as Record<string, string>
            })
        });
        if (request.error) {
            return {
                error: true,
                message: request.message || 'Unknown error',
                status: request.status,
                followed: []
            };
        }
        const response = request.response!;
        const payload = await response.json() as { data?: HelixFollowedItem[]; total?: number; pagination?: { cursor?: string }; error?: boolean; message?: string; status?: number };
        if (!response.ok || payload.error) {
            return {
                error: true,
                message: payload.message || `Failed to fetch channels followed by ${channelID}`,
                status: payload.status || response.status,
                followed: []
            };
        }
        return {
            error: false,
            message: 'Followed page fetched',
            followed: Array.isArray(payload.data) ? payload.data : [],
            total: typeof payload.total === 'number' ? payload.total : 0,
            nextCursor: payload.pagination?.cursor
        };
    } catch (error) {
        return {
            error: true,
            message: error instanceof Error ? error.message : String(error),
            followed: []
        };
    }
}

// Main exported functions

export async function recordFollowLedgerStart(input: RecordFollowLedgerStartInput): Promise<void> {
    const platform = input.platform || 'twitch';
    const followerID = normalizeValue(input.follower_id);
    const followedID = normalizeValue(input.followed_id);
    if (!followerID || !followedID) {
        return;
    }
    const eventAt = toDate(input.followed_at);
    const followerLogin = normalizeValue(input.follower_login);
    const followerName = normalizeValue(input.follower_name);
    const followedLogin = normalizeValue(input.followed_login);
    const followedName = normalizeValue(input.followed_name);

    const writeFollowStart = async (session?: ClientSession): Promise<void> => {
        const sessionOption = session ? { session } : undefined;
        const reverseActive = await FollowRelationshipLedgerSchema.findOne({
            platform,
            follower_id: followedID,
            followed_id: followerID,
            status: 'active'
        })
            .session(session ?? null)
            .select('_id mutual')
            .lean();
        const isMutual = Boolean(reverseActive);
        await FollowRelationshipLedgerSchema.updateMany({
            platform,
            follower_id: followerID,
            followed_id: followedID,
            status: 'active'
        }, {
            $set: {
                status: 'ended',
                ended_at: eventAt,
                ended_reason: 'unknown',
                mutual: false,
                last_event_at: eventAt
            }
        }, sessionOption);
        await FollowRelationshipLedgerSchema.create([
            {
                platform,
                follower_id: followerID,
                follower_login: followerLogin,
                follower_name: followerName,
                followed_id: followedID,
                followed_login: followedLogin,
                followed_name: followedName,
                followed_at: eventAt,
                ended_at: null,
                ended_reason: null,
                mutual: isMutual,
                status: 'active',
                last_event_at: eventAt
            }
        ], sessionOption as { session: ClientSession } | undefined);
        if (reverseActive && !reverseActive.mutual) {
            await FollowRelationshipLedgerSchema.updateOne({
                platform,
                follower_id: followedID,
                followed_id: followerID,
                status: 'active'
            }, {
                $set: {
                    mutual: true,
                    last_event_at: eventAt
                }
            }, sessionOption as { session: ClientSession } | undefined);
        }
    };

    try {
        for (let attempt = 1; attempt <= FOLLOW_START_MAX_ATTEMPTS; attempt += 1) {
            const session = await FollowRelationshipLedgerSchema.startSession();
            try {
                await session.withTransaction(async () => {
                    await writeFollowStart(session);
                });
                await session.endSession();
                return;
            } catch (transactionError) {
                await session.endSession();
                if (isTransactionUnsupportedError(transactionError)) {
                    try {
                        await writeFollowStart();
                        return;
                    } catch (fallbackError) {
                        if (attempt < FOLLOW_START_MAX_ATTEMPTS && isRetryableFollowStartError(fallbackError)) {
                            continue;
                        }
                        throw fallbackError;
                    }
                }
                if (attempt < FOLLOW_START_MAX_ATTEMPTS && isRetryableFollowStartError(transactionError)) {
                    continue;
                }
                throw transactionError;
            }
        }
    } catch (error) {
        console.error('Error in recordFollowLedgerStart:', {
            input,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
    }
}

export async function getFollowLedgerSyncChannelIDs(): Promise<string[]> {
    try {
        const users = await UsersSchema.find({
            accounts: {
                $elemMatch: {
                    type: 'twitch',
                    actived: true,
                    has_permissions: true
                }
            }
        }).select('accounts').lean();
        const ids = new Set<string>();
        for (const user of users) {
            for (const account of user.accounts || []) {
                if (account.type !== 'twitch') {
                    continue;
                }
                if (!account.actived || !account.has_permissions) {
                    continue;
                }
                const accountID = normalizeValue(account.id);
                if (!accountID) {
                    continue;
                }
                const hasRefreshToken = Boolean(account.refresh_token?.content);
                if (!hasRefreshToken) {
                    continue;
                }
                ids.add(accountID);
            }
        }
        return Array.from(ids);
    } catch (error) {
        console.error('Error in getFollowLedgerSyncChannelIDs:', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
        return [];
    }
}

// Internal helper functions for sync

function emptyFollowSyncStats(): FollowSyncStats {
    return {
        totalFromApi: 0,
        requests: 0,
        pages: 0,
        activeUpserts: 0,
        endedCount: 0
    };
}

function mergeFollowSyncStats(...stats: FollowSyncStats[]): FollowSyncStats {
    return stats.reduce((acc, item) => ({
        totalFromApi: acc.totalFromApi + item.totalFromApi,
        requests: acc.requests + item.requests,
        pages: acc.pages + item.pages,
        activeUpserts: acc.activeUpserts + item.activeUpserts,
        endedCount: acc.endedCount + item.endedCount
    }), emptyFollowSyncStats());
}

async function syncIncomingFollowersForChannel(
    channelID: string,
    streamerLogin: string,
    header: unknown,
    batchSize: number,
    beforeRequest?: () => Promise<void>
): Promise<SyncIncomingResult> {
    const stats = emptyFollowSyncStats();
    const seenFollowerIDs = new Set<string>();
    let cursor: string | null = null;

    do {
        stats.requests += 1;
        const page = await fetchFollowersPage(channelID, cursor, header, beforeRequest);
        if (page.error) {
            return { error: true, message: page.message, stats };
        }
        stats.pages += 1;
        stats.totalFromApi = Math.max(stats.totalFromApi, page.total || 0);

        const followerIDs: string[] = [];
        for (const follower of page.followers) {
            const followerID = normalizeValue(follower.user_id);
            if (!followerID) {
                continue;
            }
            followerIDs.push(followerID);
            seenFollowerIDs.add(followerID);
        }

        const reverseActives = followerIDs.length > 0
            ? await FollowRelationshipLedgerSchema.find({
                platform: 'twitch',
                status: 'active',
                follower_id: channelID,
                followed_id: { $in: followerIDs }
            }).select('followed_id').lean()
            : [];

        const reverseFollowedIDs = new Set(reverseActives.map((item) => normalizeValue(item.followed_id)));

        const upsertOperations: Array<{ updateOne: { filter: Record<string, unknown>; update: Record<string, unknown>; upsert: boolean } }> = [];
        for (const follower of page.followers) {
            const followerID = normalizeValue(follower.user_id);
            if (!followerID) {
                continue;
            }
            const followDate = toDate(follower.followed_at);
            upsertOperations.push({
                updateOne: {
                    filter: {
                        platform: 'twitch',
                        follower_id: followerID,
                        followed_id: channelID,
                        status: 'active'
                    },
                    update: {
                        $set: {
                            follower_login: normalizeValue(follower.user_login),
                            follower_name: normalizeValue(follower.user_name),
                            followed_login: streamerLogin,
                            followed_name: streamerLogin,
                            followed_at: followDate,
                            mutual: reverseFollowedIDs.has(followerID),
                            ended_at: null,
                            ended_reason: null,
                            last_event_at: followDate,
                            status: 'active'
                        },
                        $setOnInsert: {
                            platform: 'twitch'
                        }
                    },
                    upsert: true
                }
            });
        }

        await runBulkWriteInChunks(upsertOperations, batchSize);
        stats.activeUpserts += upsertOperations.length;

        const reverseMutualIDs = Array.from(reverseFollowedIDs).filter((value) => value.length > 0);
        if (reverseMutualIDs.length > 0) {
            await FollowRelationshipLedgerSchema.updateMany({
                platform: 'twitch',
                status: 'active',
                follower_id: channelID,
                followed_id: { $in: reverseMutualIDs }
            }, {
                $set: {
                    mutual: true
                }
            });
        }

        cursor = page.nextCursor || null;
    } while (cursor);

    const activeIncomingRows = await FollowRelationshipLedgerSchema.find({
        platform: 'twitch',
        followed_id: channelID,
        status: 'active'
    }).select('_id follower_id mutual').lean();

    const endedAt = new Date();
    const endOperations: Array<{ updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> } }> = [];
    const endedFollowerIDsWithMutual = new Set<string>();

    for (const row of activeIncomingRows) {
        const followerID = normalizeValue(row.follower_id);
        if (!followerID || seenFollowerIDs.has(followerID)) {
            continue;
        }
        endOperations.push({
            updateOne: {
                filter: {
                    _id: row._id,
                    status: 'active'
                },
                update: {
                    $set: {
                        status: 'ended',
                        ended_at: endedAt,
                        ended_reason: 'missing_in_followers_scan',
                        mutual: false,
                        last_event_at: endedAt
                    }
                }
            }
        });
        if (row.mutual) {
            endedFollowerIDsWithMutual.add(followerID);
        }
    }

    await runBulkWriteInChunks(endOperations, batchSize);
    stats.endedCount += endOperations.length;

    const reverseMutualResetIDs = Array.from(endedFollowerIDsWithMutual);
    if (reverseMutualResetIDs.length > 0) {
        await FollowRelationshipLedgerSchema.updateMany({
            platform: 'twitch',
            status: 'active',
            follower_id: channelID,
            followed_id: { $in: reverseMutualResetIDs },
            mutual: true
        }, {
            $set: {
                mutual: false
            }
        });
    }

    return {
        error: false,
        message: 'Incoming followers scan completed',
        stats
    };
}

async function syncOutgoingFollowedForChannel(
    channelID: string,
    streamerLogin: string,
    header: unknown,
    batchSize: number,
    beforeRequest?: () => Promise<void>
): Promise<SyncOutgoingResult> {
    const stats = emptyFollowSyncStats();
    const seenFollowedIDs = new Set<string>();
    let cursor: string | null = null;

    do {
        stats.requests += 1;
        const page = await fetchFollowedPage(channelID, cursor, header, beforeRequest);
        if (page.error) {
            return { error: true, message: page.message, stats };
        }
        stats.pages += 1;
        stats.totalFromApi = Math.max(stats.totalFromApi, page.total || 0);

        const followedIDs: string[] = [];
        for (const followed of page.followed) {
            const followedID = normalizeValue(followed.broadcaster_id);
            if (!followedID) {
                continue;
            }
            followedIDs.push(followedID);
            seenFollowedIDs.add(followedID);
        }

        const reverseActives = followedIDs.length > 0
            ? await FollowRelationshipLedgerSchema.find({
                platform: 'twitch',
                status: 'active',
                follower_id: { $in: followedIDs },
                followed_id: channelID
            }).select('follower_id').lean()
            : [];

        const reverseFollowerIDs = new Set(reverseActives.map((item) => normalizeValue(item.follower_id)));

        const upsertOperations: Array<{ updateOne: { filter: Record<string, unknown>; update: Record<string, unknown>; upsert: boolean } }> = [];
        for (const followed of page.followed) {
            const followedID = normalizeValue(followed.broadcaster_id);
            if (!followedID) {
                continue;
            }
            const followDate = toDate(followed.followed_at);
            upsertOperations.push({
                updateOne: {
                    filter: {
                        platform: 'twitch',
                        follower_id: channelID,
                        followed_id: followedID,
                        status: 'active'
                    },
                    update: {
                        $set: {
                            follower_login: streamerLogin,
                            follower_name: streamerLogin,
                            followed_login: normalizeValue(followed.broadcaster_login),
                            followed_name: normalizeValue(followed.broadcaster_name),
                            followed_at: followDate,
                            mutual: reverseFollowerIDs.has(followedID),
                            ended_at: null,
                            ended_reason: null,
                            last_event_at: followDate,
                            status: 'active'
                        },
                        $setOnInsert: {
                            platform: 'twitch'
                        }
                    },
                    upsert: true
                }
            });
        }

        await runBulkWriteInChunks(upsertOperations, batchSize);
        stats.activeUpserts += upsertOperations.length;

        const reverseMutualIDs = Array.from(reverseFollowerIDs).filter((value) => value.length > 0);
        if (reverseMutualIDs.length > 0) {
            await FollowRelationshipLedgerSchema.updateMany({
                platform: 'twitch',
                status: 'active',
                follower_id: { $in: reverseMutualIDs },
                followed_id: channelID
            }, {
                $set: {
                    mutual: true
                }
            });
        }

        cursor = page.nextCursor || null;
    } while (cursor);

    const activeOutgoingRows = await FollowRelationshipLedgerSchema.find({
        platform: 'twitch',
        follower_id: channelID,
        status: 'active'
    }).select('_id followed_id mutual').lean();

    const endedAt = new Date();
    const endOperations: Array<{ updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> } }> = [];
    const reverseMutualResetIDs = new Set<string>();

    for (const row of activeOutgoingRows) {
        const followedID = normalizeValue(row.followed_id);
        if (!followedID || seenFollowedIDs.has(followedID)) {
            continue;
        }
        endOperations.push({
            updateOne: {
                filter: {
                    _id: row._id,
                    status: 'active'
                },
                update: {
                    $set: {
                        status: 'ended',
                        ended_at: endedAt,
                        ended_reason: 'missing_in_following_scan',
                        mutual: false,
                        last_event_at: endedAt
                    }
                }
            }
        });
        if (row.mutual) {
            reverseMutualResetIDs.add(followedID);
        }
    }

    await runBulkWriteInChunks(endOperations, batchSize);
    stats.endedCount += endOperations.length;

    const resetIDs = Array.from(reverseMutualResetIDs);
    if (resetIDs.length > 0) {
        await FollowRelationshipLedgerSchema.updateMany({
            platform: 'twitch',
            status: 'active',
            follower_id: { $in: resetIDs },
            followed_id: channelID,
            mutual: true
        }, {
            $set: {
                mutual: false
            }
        });
    }

    return {
        error: false,
        message: 'Outgoing followed scan completed',
        stats
    };
}

async function reconcileMutualForChannel(channelID: string): Promise<void> {
    const outgoingRows = await FollowRelationshipLedgerSchema.find({
        platform: 'twitch',
        status: 'active',
        follower_id: channelID
    }).select('followed_id').lean();

    const incomingRows = await FollowRelationshipLedgerSchema.find({
        platform: 'twitch',
        status: 'active',
        followed_id: channelID
    }).select('follower_id').lean();

    const outgoingIDs = new Set(outgoingRows.map((row) => normalizeValue(row.followed_id)).filter((id) => id.length > 0));
    const incomingIDs = new Set(incomingRows.map((row) => normalizeValue(row.follower_id)).filter((id) => id.length > 0));

    const outgoingMutualIDs = Array.from(outgoingIDs).filter((id) => incomingIDs.has(id));
    const outgoingNonMutualIDs = Array.from(outgoingIDs).filter((id) => !incomingIDs.has(id));
    const incomingMutualIDs = Array.from(incomingIDs).filter((id) => outgoingIDs.has(id));
    const incomingNonMutualIDs = Array.from(incomingIDs).filter((id) => !outgoingIDs.has(id));

    if (outgoingMutualIDs.length > 0) {
        await FollowRelationshipLedgerSchema.updateMany(
            { platform: 'twitch', status: 'active', follower_id: channelID, followed_id: { $in: outgoingMutualIDs } },
            { $set: { mutual: true } }
        );
    }
    if (outgoingNonMutualIDs.length > 0) {
        await FollowRelationshipLedgerSchema.updateMany(
            { platform: 'twitch', status: 'active', follower_id: channelID, followed_id: { $in: outgoingNonMutualIDs } },
            { $set: { mutual: false } }
        );
    }
    if (incomingMutualIDs.length > 0) {
        await FollowRelationshipLedgerSchema.updateMany(
            { platform: 'twitch', status: 'active', followed_id: channelID, follower_id: { $in: incomingMutualIDs } },
            { $set: { mutual: true } }
        );
    }
    if (incomingNonMutualIDs.length > 0) {
        await FollowRelationshipLedgerSchema.updateMany(
            { platform: 'twitch', status: 'active', followed_id: channelID, follower_id: { $in: incomingNonMutualIDs } },
            { $set: { mutual: false } }
        );
    }
}

export async function syncFollowLedgerForChannel(
    channelID: string,
    options: FollowLedgerSyncOptions = {}
): Promise<FollowLedgerSyncResult> {
    const channelIdValue = normalizeValue(channelID);
    const batchSize = Math.max(1, options.writeBatchSize || DEFAULT_BATCH_SIZE);
    const baseStats = emptyFollowSyncStats();

    if (!channelIdValue) {
        return {
            error: true,
            message: 'Invalid channel ID',
            channelID,
            ...baseStats
        };
    }

    const streamerAccount = await TwitchStreamers.getTwitchAccountById(channelIdValue);
    const streamerLogin = normalizeValue(streamerAccount?.name);
    const headerResult = await getTwitchStreamerHeaderById(channelIdValue);

    if (headerResult.error || !headerResult.header) {
        return {
            error: true,
            message: headerResult.message,
            channelID: channelIdValue,
            ...baseStats
        };
    }

    const beforeFollowersRequest = options.beforeFollowersRequest || options.beforeRequest;
    const beforeFollowingRequest = options.beforeFollowingRequest || options.beforeRequest;

    try {
        const [incomingResult, outgoingResult] = await Promise.all([
            syncIncomingFollowersForChannel(channelIdValue, streamerLogin, headerResult.header, batchSize, beforeFollowersRequest),
            syncOutgoingFollowedForChannel(channelIdValue, streamerLogin, headerResult.header, batchSize, beforeFollowingRequest)
        ]);

        if (incomingResult.error) {
            return {
                error: true,
                message: incomingResult.message,
                channelID: channelIdValue,
                ...mergeFollowSyncStats(incomingResult.stats, outgoingResult.stats)
            };
        }
        if (outgoingResult.error) {
            return {
                error: true,
                message: outgoingResult.message,
                channelID: channelIdValue,
                ...mergeFollowSyncStats(incomingResult.stats, outgoingResult.stats)
            };
        }

        await reconcileMutualForChannel(channelIdValue);

        return {
            error: false,
            message: 'Follow ledger sync completed',
            channelID: channelIdValue,
            ...mergeFollowSyncStats(incomingResult.stats, outgoingResult.stats)
        };
    } catch (error) {
        return {
            error: true,
            message: error instanceof Error ? error.message : String(error),
            channelID: channelIdValue,
            ...baseStats
        };
    }
}
