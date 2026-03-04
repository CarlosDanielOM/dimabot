import { getDragonflyClient } from './databases/dragonfly.database.js';
import { sendTwitchChatMessage } from '../functions/chats/send_message.chat.js';

const PENDING_KEY_PREFIX = 'twitch:temporary-roles:pending-announcements';
const PENDING_TTL_SECONDS = 14 * 24 * 60 * 60;
const COMPRESSION_THRESHOLD = 5;

type TemporaryRole = 'vip' | 'moderator';

interface PendingAnnouncementPayload {
    role: TemporaryRole;
    username: string;
    userID: string;
    removedAt: string;
}

function getPendingAnnouncementsKey(channelID: string): string {
    return `${PENDING_KEY_PREFIX}:${channelID}`;
}

function normalizeLogin(value: string | undefined | null): string {
    return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}

function buildSingleRemovalMessage(role: TemporaryRole, username: string): string {
    const normalized = normalizeLogin(username);
    const mention = normalized ? `@${normalized}` : 'User';
    return role === 'vip'
        ? `${mention} has been removed from VIP`
        : `${mention} has been removed from moderator`;
}

function buildCompressedRemovalMessage(role: TemporaryRole, count: number): string {
    return role === 'vip'
        ? `${count} users were removed from VIP`
        : `${count} users were removed from moderator`;
}

export async function enqueueTemporaryRoleRemovalAnnouncement(
    channelID: string,
    role: TemporaryRole,
    username: string,
    userID: string
): Promise<void> {
    const cache = await getDragonflyClient('TemporaryRoleAnnouncements');
    const key = getPendingAnnouncementsKey(channelID);
    const payload: PendingAnnouncementPayload = {
        role,
        username: normalizeLogin(username),
        userID: String(userID || '').trim(),
        removedAt: new Date().toISOString()
    };
    await cache.rPush(key, JSON.stringify(payload));
    await cache.expire(key, PENDING_TTL_SECONDS);
}

async function sendRoleRemovalBatch(
    channelID: string,
    role: TemporaryRole,
    users: string[]
): Promise<void> {
    if (users.length === 0) {
        return;
    }

    if (users.length > COMPRESSION_THRESHOLD) {
        const response = await sendTwitchChatMessage(
            channelID,
            buildCompressedRemovalMessage(role, users.length)
        );
        if (response.error) {
            throw new Error(response.message || 'Failed sending compressed role removal message');
        }
        return;
    }

    for (const user of users) {
        const response = await sendTwitchChatMessage(
            channelID,
            buildSingleRemovalMessage(role, user)
        );
        if (response.error) {
            throw new Error(response.message || 'Failed sending role removal message');
        }
    }
}

export async function flushTemporaryRoleRemovalAnnouncements(
    channelID: string
): Promise<{ sent: number }> {
    const cache = await getDragonflyClient('TemporaryRoleAnnouncements');
    const key = getPendingAnnouncementsKey(channelID);
    const rawItems = await cache.lRange(key, 0, -1);

    if (!rawItems || rawItems.length === 0) {
        return { sent: 0 };
    }

    const grouped: Record<TemporaryRole, Set<string>> = {
        vip: new Set(),
        moderator: new Set()
    };

    for (const raw of rawItems) {
        try {
            const parsed = JSON.parse(raw) as PendingAnnouncementPayload;
            if (parsed.role !== 'vip' && parsed.role !== 'moderator') {
                continue;
            }
            const login = normalizeLogin(parsed.username) || normalizeLogin(parsed.userID);
            if (!login) {
                continue;
            }
            grouped[parsed.role].add(login);
        } catch {
            continue;
        }
    }

    const vipUsers = Array.from(grouped.vip);
    const moderatorUsers = Array.from(grouped.moderator);

    await sendRoleRemovalBatch(channelID, 'vip', vipUsers);
    await sendRoleRemovalBatch(channelID, 'moderator', moderatorUsers);

    await cache.del(key);

    return {
        sent: vipUsers.length + moderatorUsers.length
    };
}
