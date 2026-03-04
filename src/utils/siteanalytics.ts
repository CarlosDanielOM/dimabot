import { getDragonflyClient } from './databases/dragonfly.database.js';
import UsersSchema from '../schemas/users.schema.js';
import { CommandsSchema } from '../schemas/commands.schema.js';
import { SiteAnalyticsSchema, type ILiveChannel } from '../schemas/site_analytics.schema.js';
import { getTwitchHelixUrl } from './links.js';
import { executeHelixAppRequestWith401Retry } from './twitch_helix_retry.js';

const SITE_ANALYTICS_KEY = 'site:analytics:channels';
const SITE_ANALYTICS_LIVE_CHANNELS_KEY = 'site:analytics:live:channels';
const SITE_ANALYTICS_PROFILE_CACHE_PREFIX = 'site:analytics:profile:';
const SITE_ANALYTICS_SINGLETON_KEY = 'global';

const ONE_HOUR_MS = 60 * 60 * 1000;
const LIVE_CHANNELS_REFRESH_MS = 15 * 1000;
const PROFILE_CACHE_TTL_SECONDS = 24 * 60 * 60;

let siteAnalyticsPersistenceWorkerStarted = false;
let liveChannelsWorkerStarted = false;

const ANALYTICS_FIELDS = {
    registeredUsers: 'registered_users',
    liveUsers: 'live_users',
    authorizedAccounts: 'authorized_accounts',
    totalMessages: 'total_messages',
    totalCommands: 'total_commands',
    legacyRegistered: 'registered',
    legacyLive: 'live',
    legacyActive: 'active'
} as const;

const FIELD_ALIASES: Record<string, string> = {
    registered: ANALYTICS_FIELDS.registeredUsers,
    registered_users: ANALYTICS_FIELDS.registeredUsers,
    live: ANALYTICS_FIELDS.liveUsers,
    live_users: ANALYTICS_FIELDS.liveUsers,
    active: ANALYTICS_FIELDS.authorizedAccounts,
    authorized_accounts: ANALYTICS_FIELDS.authorizedAccounts,
    total_messages: ANALYTICS_FIELDS.totalMessages,
    total_commands: ANALYTICS_FIELDS.totalCommands,
    total_live_viewers: 'total_live_viewers'
};

interface LiveChannelNormalized {
    channelID: string;
    channel: string;
    streamId: string;
    title: string;
    gameName: string;
    viewers: number;
    profileImageUrl: string;
    startedAt: string;
    fetchedAt: string;
    botPlatforms: ('twitch' | 'kick')[];
}

interface SiteAnalyticsSnapshot {
    registeredUsers: number;
    liveUsers: number;
    totalLiveViewers: number;
    authorizedAccounts: number;
    totalMessages: number;
    totalCommands: number;
    liveChannels: LiveChannelNormalized[];
}

interface CachedLiveStatus {
    isLive: boolean;
    checkedAt: string;
    stream: {
        title?: string;
        game_name?: string;
        viewer_count: number;
        started_at?: string;
    } | null;
}

function chunkArray<T>(items: T[], size: number): T[][] {
    if (size <= 0) {
        return [items];
    }
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

function toNumber(value: unknown): number {
    const parsed = Number.parseInt(String(value ?? '0'), 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function resolveAnalyticsField(filter: string): string {
    return FIELD_ALIASES[filter] ?? filter;
}

async function setAnalyticsSnapshot(snapshot: SiteAnalyticsSnapshot): Promise<void> {
    const cacheClient = await getDragonflyClient('SiteAnalytics');
    await cacheClient.hSet(SITE_ANALYTICS_KEY, ANALYTICS_FIELDS.registeredUsers, String(snapshot.registeredUsers));
    await cacheClient.hSet(SITE_ANALYTICS_KEY, ANALYTICS_FIELDS.liveUsers, String(snapshot.liveUsers));
    await cacheClient.hSet(SITE_ANALYTICS_KEY, 'total_live_viewers', String(snapshot.totalLiveViewers));
    await cacheClient.hSet(SITE_ANALYTICS_KEY, ANALYTICS_FIELDS.authorizedAccounts, String(snapshot.authorizedAccounts));
    await cacheClient.hSet(SITE_ANALYTICS_KEY, ANALYTICS_FIELDS.totalMessages, String(snapshot.totalMessages));
    await cacheClient.hSet(SITE_ANALYTICS_KEY, ANALYTICS_FIELDS.totalCommands, String(snapshot.totalCommands));
    await cacheClient.hSet(SITE_ANALYTICS_KEY, ANALYTICS_FIELDS.legacyRegistered, String(snapshot.registeredUsers));
    await cacheClient.hSet(SITE_ANALYTICS_KEY, ANALYTICS_FIELDS.legacyLive, String(snapshot.liveUsers));
    await cacheClient.hSet(SITE_ANALYTICS_KEY, ANALYTICS_FIELDS.legacyActive, String(snapshot.authorizedAccounts));
    await cacheClient.set(SITE_ANALYTICS_LIVE_CHANNELS_KEY, JSON.stringify(snapshot.liveChannels));
}

function normalizeLiveChannel(value: unknown): LiveChannelNormalized | null {
    if (!value || typeof value !== 'object' || !('channelID' in value)) {
        return null;
    }
    const raw = value as Record<string, unknown>;
    const botPlatformsRaw = Array.isArray(raw.botPlatforms)
        ? raw.botPlatforms
            .map((platform) => String(platform).toLowerCase())
            .filter((platform): platform is 'twitch' | 'kick' => platform === 'twitch' || platform === 'kick')
        : [];

    return {
        channelID: String(raw.channelID),
        channel: String(raw.channel || raw.channelID),
        streamId: String(raw.streamId || ''),
        title: String(raw.title || ''),
        gameName: String(raw.gameName || ''),
        viewers: Math.max(0, toNumber(String(raw.viewers ?? 0))),
        profileImageUrl: String(raw.profileImageUrl || ''),
        startedAt: String(raw.startedAt || ''),
        fetchedAt: String(raw.fetchedAt || ''),
        botPlatforms: botPlatformsRaw
    };
}

async function readLiveChannelsFromCache(): Promise<LiveChannelNormalized[]> {
    const cacheClient = await getDragonflyClient('SiteAnalytics');
    const raw = await cacheClient.get(SITE_ANALYTICS_LIVE_CHANNELS_KEY);
    if (!raw) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed
            .map((entry) => normalizeLiveChannel(entry))
            .filter((entry): entry is LiveChannelNormalized => entry !== null);
    } catch {
        return [];
    }
}

export async function getLiveChannelsBoard(): Promise<LiveChannelNormalized[]> {
    return readLiveChannelsFromCache();
}

export async function getLiveChannelsByChannelIdMap(): Promise<Map<string, LiveChannelNormalized>> {
    const channels = await readLiveChannelsFromCache();
    return new Map(channels.map((entry) => [entry.channelID, entry]));
}

export async function getCachedLiveStatus(channelID: string | number): Promise<CachedLiveStatus> {
    const normalizedChannelID = String(channelID || '').trim();
    const checkedAt = new Date().toISOString();
    if (!normalizedChannelID) {
        return {
            isLive: false,
            checkedAt,
            stream: null
        };
    }
    const liveByChannelID = await getLiveChannelsByChannelIdMap();
    const liveChannel = liveByChannelID.get(normalizedChannelID);
    if (!liveChannel) {
        return {
            isLive: false,
            checkedAt,
            stream: null
        };
    }
    return {
        isLive: true,
        checkedAt: liveChannel.fetchedAt || checkedAt,
        stream: {
            title: liveChannel.title || undefined,
            game_name: liveChannel.gameName || undefined,
            viewer_count: Number(liveChannel.viewers || 0),
            started_at: liveChannel.startedAt || undefined
        }
    };
}

interface TwitchStreamData {
    id: string;
    user_id: string;
    user_login: string;
    user_name: string;
    title: string;
    game_name: string;
    viewer_count: number;
    started_at: string;
}

async function fetchLiveStreamsByChannelIds(channelIDs: string[]): Promise<TwitchStreamData[]> {
    const uniqueIDs = Array.from(new Set(channelIDs.filter((id) => Boolean(id))));
    if (!uniqueIDs.length) {
        return [];
    }
    const batches = chunkArray(uniqueIDs, 100);
    const streams: TwitchStreamData[] = [];
    for (const batch of batches) {
        const params = new URLSearchParams({ type: 'live' });
        for (const channelID of batch) {
            params.append('user_id', channelID);
        }
        const request = await executeHelixAppRequestWith401Retry({
            worker: 'site_analytics',
            operation: 'fetch_live_streams_by_channel_ids',
            context: {
                batchSize: batch.length
            },
            executeRequest: async (headers) => fetch(getTwitchHelixUrl('streams', params.toString()), {
                headers
            })
        });
        if (request.error || !request.response?.ok) {
            continue;
        }
        const response = request.response;
        const payload = await response.json();
        const data = Array.isArray(payload?.data) ? payload.data : [];
        streams.push(...data);
    }
    return streams;
}

async function fetchProfileImagesByIds(channelIDs: string[]): Promise<Map<string, string>> {
    const uniqueIDs = Array.from(new Set(channelIDs.filter((id) => Boolean(id))));
    const profileMap = new Map<string, string>();
    if (!uniqueIDs.length) {
        return profileMap;
    }
    const cacheClient = await getDragonflyClient('SiteAnalytics');
    const cacheKeys = uniqueIDs.map((channelID) => `${SITE_ANALYTICS_PROFILE_CACHE_PREFIX}${channelID}`);
    const cachedValues = await cacheClient.mGet(cacheKeys);
    const missingIDs: string[] = [];

    for (let index = 0; index < uniqueIDs.length; index += 1) {
        const channelID = uniqueIDs[index];
        const cached = cachedValues[index];
        if (cached) {
            profileMap.set(channelID, cached);
        } else {
            missingIDs.push(channelID);
        }
    }

    if (!missingIDs.length) {
        return profileMap;
    }

    const batches = chunkArray(missingIDs, 100);
    for (const batch of batches) {
        const params = new URLSearchParams();
        for (const channelID of batch) {
            params.append('id', channelID);
        }
        const request = await executeHelixAppRequestWith401Retry({
            worker: 'site_analytics',
            operation: 'fetch_profile_images_by_ids',
            context: {
                batchSize: batch.length
            },
            executeRequest: async (headers) => fetch(getTwitchHelixUrl('users', params.toString()), {
                headers
            })
        });
        if (request.error || !request.response?.ok) {
            continue;
        }
        const response = request.response;
        const payload = await response.json();
        const data = Array.isArray(payload?.data) ? payload.data : [];
        for (const user of data) {
            const profileImage = String(user.profile_image_url || '');
            profileMap.set(user.id, profileImage);
            if (profileImage) {
                await cacheClient.set(`${SITE_ANALYTICS_PROFILE_CACHE_PREFIX}${user.id}`, profileImage, {
                    EX: PROFILE_CACHE_TTL_SECONDS
                });
            }
        }
    }
    return profileMap;
}

interface AccountInfo {
    channel: string;
    botPlatforms: ('twitch' | 'kick')[];
}

async function refreshLiveChannelsBoard(): Promise<LiveChannelNormalized[]> {
    const users = await UsersSchema.find({ 'accounts.type': 'twitch' })
        .select('accounts')
        .lean();
    const accountsByChannelID = new Map<string, AccountInfo>();

    for (const user of users) {
        const accounts = Array.isArray(user.accounts) ? user.accounts : [];
        const twitchAccount = accounts.find((account) => account.type === 'twitch' && account.id);
        if (!twitchAccount?.id) {
            continue;
        }
        const enabledPlatforms = new Set<'twitch' | 'kick'>();
        for (const account of accounts) {
            if (!account.chat_enabled) {
                continue;
            }
            if (account.type === 'twitch' || account.type === 'kick') {
                enabledPlatforms.add(account.type);
            }
        }
        accountsByChannelID.set(String(twitchAccount.id), {
            channel: String(twitchAccount.name || twitchAccount.id),
            botPlatforms: Array.from(enabledPlatforms)
        });
    }

    const channelIDs = Array.from(accountsByChannelID.keys());
    const liveStreams = await fetchLiveStreamsByChannelIds(channelIDs);
    const profileByChannelID = await fetchProfileImagesByIds(liveStreams.map((stream) => stream.user_id));
    const fetchedAt = new Date().toISOString();

    const channels: LiveChannelNormalized[] = liveStreams
        .filter((stream) => Boolean(stream.user_id))
        .map((stream) => {
            const channelID = String(stream.user_id);
            const account = accountsByChannelID.get(channelID);
            return {
                channelID,
                channel: String(stream.user_login || stream.user_name || account?.channel || channelID),
                streamId: String(stream.id || ''),
                title: String(stream.title || ''),
                gameName: String(stream.game_name || ''),
                viewers: Math.max(0, Number(stream.viewer_count || 0)),
                profileImageUrl: String(profileByChannelID.get(channelID) || ''),
                startedAt: String(stream.started_at || ''),
                fetchedAt,
                botPlatforms: account?.botPlatforms || []
            };
        })
        .sort((a, b) => b.viewers - a.viewers);

    const cacheClient = await getDragonflyClient('SiteAnalytics');
    await cacheClient.set(SITE_ANALYTICS_LIVE_CHANNELS_KEY, JSON.stringify(channels));
    await cacheClient.hSet(SITE_ANALYTICS_KEY, ANALYTICS_FIELDS.liveUsers, String(channels.length));
    await cacheClient.hSet(SITE_ANALYTICS_KEY, ANALYTICS_FIELDS.legacyLive, String(channels.length));
    await cacheClient.hSet(SITE_ANALYTICS_KEY, 'total_live_viewers', String(channels.reduce((acc, channel) => acc + channel.viewers, 0)));

    return channels;
}

function startLiveChannelsRefreshWorker(): void {
    if (liveChannelsWorkerStarted) {
        return;
    }
    liveChannelsWorkerStarted = true;

    const run = async () => {
        try {
            await refreshLiveChannelsBoard();
        } catch (error) {
            console.error('Error refreshing live channels board:', error);
        }
    };

    run().catch(() => {
        // no-op handled in run
    });

    const interval = setInterval(() => {
        run().catch(() => {
            // no-op handled in run
        });
    }, LIVE_CHANNELS_REFRESH_MS);
    interval.unref?.();
}

async function loadPersistedSiteAnalyticsSnapshot(): Promise<SiteAnalyticsSnapshot | null> {
    const document = await SiteAnalyticsSchema.findOne({ singletonKey: SITE_ANALYTICS_SINGLETON_KEY }).lean();
    if (!document) {
        return null;
    }
    return {
        registeredUsers: Number(document.registeredUsers || 0),
        liveUsers: Number(document.liveUsers || 0),
        totalLiveViewers: Number(document.totalLiveViewers || 0),
        authorizedAccounts: Number(document.authorizedAccounts || 0),
        totalMessages: Number(document.totalMessages || 0),
        totalCommands: Number(document.totalCommands || 0),
        liveChannels: Array.isArray(document.liveChannels)
            ? document.liveChannels
                .map((entry) => normalizeLiveChannel(entry))
                .filter((entry): entry is LiveChannelNormalized => entry !== null)
            : []
    };
}

export async function persistSiteAnalyticsSnapshot(): Promise<void> {
    const snapshot = await getSiteAnalyticsSnapshot();
    await SiteAnalyticsSchema.findOneAndUpdate(
        { singletonKey: SITE_ANALYTICS_SINGLETON_KEY },
        {
            $set: {
                registeredUsers: snapshot.registeredUsers,
                liveUsers: snapshot.liveUsers,
                totalLiveViewers: snapshot.totalLiveViewers,
                authorizedAccounts: snapshot.authorizedAccounts,
                totalMessages: snapshot.totalMessages,
                totalCommands: snapshot.totalCommands,
                liveChannels: snapshot.liveChannels
            }
        },
        { upsert: true, new: true }
    );
}

export function startSiteAnalyticsPersistenceWorker(): void {
    if (siteAnalyticsPersistenceWorkerStarted) {
        return;
    }
    siteAnalyticsPersistenceWorkerStarted = true;

    const interval = setInterval(async () => {
        try {
            await persistSiteAnalyticsSnapshot();
        } catch (error) {
            console.error('Error persisting site analytics snapshot:', error);
        }
    }, ONE_HOUR_MS);
    interval.unref?.();
}

export async function getSiteAnalyticsSnapshot(): Promise<SiteAnalyticsSnapshot> {
    const cacheClient = await getDragonflyClient('SiteAnalytics');
    const all = await cacheClient.hGetAll(SITE_ANALYTICS_KEY);
    const liveChannels = await readLiveChannelsFromCache();
    const totalLiveViewers = liveChannels.reduce((acc, channel) => acc + channel.viewers, 0);

    return {
        registeredUsers: toNumber(all[ANALYTICS_FIELDS.registeredUsers] || all[ANALYTICS_FIELDS.legacyRegistered]),
        liveUsers: liveChannels.length || toNumber(all[ANALYTICS_FIELDS.liveUsers] || all[ANALYTICS_FIELDS.legacyLive]),
        totalLiveViewers,
        authorizedAccounts: toNumber(all[ANALYTICS_FIELDS.authorizedAccounts] || all[ANALYTICS_FIELDS.legacyActive]),
        totalMessages: toNumber(all[ANALYTICS_FIELDS.totalMessages]),
        totalCommands: toNumber(all[ANALYTICS_FIELDS.totalCommands]),
        liveChannels
    };
}

export async function refreshSiteAnalyticsSnapshot(): Promise<SiteAnalyticsSnapshot> {
    const [registeredUsersCount, authorizedAccountsAgg, totalCommandsCount] = await Promise.all([
        UsersSchema.countDocuments({}),
        UsersSchema.aggregate<{ count: number }>([{ $unwind: '$accounts' }, { $match: { 'accounts.actived': true } }, { $count: 'count' }]),
        CommandsSchema.countDocuments({})
    ]);

    const liveChannels = await readLiveChannelsFromCache();
    const liveUsersCount = liveChannels.length;
    const totalLiveViewers = liveChannels.reduce((acc, channel) => acc + channel.viewers, 0);
    const existing = await getSiteAnalyticsSnapshot();

    const snapshot: SiteAnalyticsSnapshot = {
        registeredUsers: Number(registeredUsersCount || 0),
        liveUsers: Number(liveUsersCount || 0),
        totalLiveViewers: Number(totalLiveViewers || 0),
        authorizedAccounts: Number(authorizedAccountsAgg[0]?.count || 0),
        totalMessages: existing.totalMessages,
        totalCommands: Number(totalCommandsCount || 0),
        liveChannels
    };

    await setAnalyticsSnapshot(snapshot);
    return snapshot;
}

export async function startSiteAnalytics(): Promise<boolean> {
    const cacheClient = await getDragonflyClient('SiteAnalytics');
    const alreadyStarted = await cacheClient.exists('site:analytics:start');

    try {
        const existingCacheValues = await cacheClient.hGetAll(SITE_ANALYTICS_KEY);
        const hasCacheValues = Object.keys(existingCacheValues).length > 0;

        if (!hasCacheValues) {
            const persistedSnapshot = await loadPersistedSiteAnalyticsSnapshot();
            if (persistedSnapshot) {
                await setAnalyticsSnapshot(persistedSnapshot);
            }
        }

        const existingLiveChannels = await readLiveChannelsFromCache();
        if (!existingLiveChannels.length) {
            await refreshLiveChannelsBoard();
        }

        await refreshSiteAnalyticsSnapshot();

        if (!alreadyStarted) {
            await cacheClient.set('site:analytics:start', '1');
        }

        await persistSiteAnalyticsSnapshot();
        startSiteAnalyticsPersistenceWorker();
        startLiveChannelsRefreshWorker();

        return true;
    } catch (error) {
        console.error('Error starting site analytics: ', error);
        return false;
    }
}

export async function getSiteAnalytics(filter: string | null = null): Promise<string | Record<string, string> | null> {
    const cacheClient = await getDragonflyClient('SiteAnalytics');

    if (filter) {
        const resolvedFilter = resolveAnalyticsField(filter);
        const value = await cacheClient.hGet(SITE_ANALYTICS_KEY, resolvedFilter);
        return value;
    }

    const all = await cacheClient.hGetAll(SITE_ANALYTICS_KEY);
    return all;
}

export async function incrementSiteAnalytics(filter: string, value: number = 1): Promise<void> {
    const cacheClient = await getDragonflyClient('SiteAnalytics');
    const resolvedFilter = resolveAnalyticsField(filter);
    await cacheClient.hIncrBy(SITE_ANALYTICS_KEY, resolvedFilter, value);

    if (resolvedFilter === ANALYTICS_FIELDS.registeredUsers) {
        await cacheClient.hIncrBy(SITE_ANALYTICS_KEY, ANALYTICS_FIELDS.legacyRegistered, value);
    }
    if (resolvedFilter === ANALYTICS_FIELDS.liveUsers) {
        await cacheClient.hIncrBy(SITE_ANALYTICS_KEY, ANALYTICS_FIELDS.legacyLive, value);
    }
    if (resolvedFilter === ANALYTICS_FIELDS.authorizedAccounts) {
        await cacheClient.hIncrBy(SITE_ANALYTICS_KEY, ANALYTICS_FIELDS.legacyActive, value);
    }
}

export async function decrementSiteAnalytics(filter: string, value: number = 1): Promise<void> {
    const cacheClient = await getDragonflyClient('SiteAnalytics');
    const resolvedFilter = resolveAnalyticsField(filter);
    await cacheClient.hIncrBy(SITE_ANALYTICS_KEY, resolvedFilter, -value);

    if (resolvedFilter === ANALYTICS_FIELDS.registeredUsers) {
        await cacheClient.hIncrBy(SITE_ANALYTICS_KEY, ANALYTICS_FIELDS.legacyRegistered, -value);
    }
    if (resolvedFilter === ANALYTICS_FIELDS.liveUsers) {
        await cacheClient.hIncrBy(SITE_ANALYTICS_KEY, ANALYTICS_FIELDS.legacyLive, -value);
    }
    if (resolvedFilter === ANALYTICS_FIELDS.authorizedAccounts) {
        await cacheClient.hIncrBy(SITE_ANALYTICS_KEY, ANALYTICS_FIELDS.legacyActive, -value);
    }
}
