const MODERATOR_BADGE_IDS = new Set(['moderator', 'lead_mod', 'lead_moderator', 'mod']);

type BadgeInfo = {
    set_id?: string;
    id?: string;
};

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function clampConfidence(value: number): number {
    return Math.max(0, Math.min(0.99, value));
}

function hasModeratorBadge(badges: BadgeInfo[] = []): boolean {
    return badges.some((badge) => {
        const setId = String(badge?.set_id || badge?.id || '').toLowerCase();
        return MODERATOR_BADGE_IDS.has(setId);
    });
}

export function inferMemorySourceType(channelID: string, userID: string, badges: BadgeInfo[] = []): 'streamer' | 'mod' | 'chat' {
    if (userID && userID === channelID) return 'streamer';
    if (hasModeratorBadge(badges)) return 'mod';
    return 'chat';
}

function sanitizeForMemory(message: string): string {
    return message
        .replace(/\s+/g, ' ')
        .trim();
}

function looksNoisy(message: string): boolean {
    if (message.startsWith('!')) return true;
    if (message.length < 12) return true;
    if (/https?:\/\//i.test(message)) return true;
    if (/^[@#]\w+/i.test(message)) return true;
    return false;
}

export interface IExtractMemoryCandidateParams {
    channelID: string;
    userID: string;
    username: string;
    message: string;
    badges?: BadgeInfo[];
    timestamp?: number;
}

export interface IMemoryCandidate {
    type: 'preference' | 'boundary' | 'channel_lore' | 'running_joke' | 'known_user_fact';
    risk: 'low' | 'medium';
    confidence: number;
    content: string;
    summary: string;
    subject: {
        scope: 'channel' | 'user';
        username?: string;
        userID?: string;
    };
    source: 'streamer' | 'mod' | 'chat';
    timestamp: number;
}

export function extractMemoryCandidate(params: IExtractMemoryCandidateParams): IMemoryCandidate | null {
    const message = sanitizeForMemory(normalizeText(params.message));
    if (!message || looksNoisy(message)) {
        return null;
    }
    const lower = message.toLowerCase();
    const source = inferMemorySourceType(params.channelID, params.userID, params.badges || []);
    const confidenceBoost = source === 'streamer' ? 0.1 : (source === 'mod' ? 0.05 : 0);
    const timestamp = Number(params.timestamp || Math.floor(Date.now() / 1000));
    const preferenceRegex = /(my favorite|i love|i like|i prefer|me encanta|me gusta|prefiero|mi favorito|odio|i hate)/i;
    if (preferenceRegex.test(message)) {
        const base = /(my favorite|mi favorito)/i.test(message) ? 0.88 : 0.78;
        return {
            type: 'preference',
            risk: 'low',
            confidence: clampConfidence(base + confidenceBoost),
            content: message,
            summary: `${params.username} preference: ${message}`,
            subject: {
                scope: 'user',
                username: normalizeText(params.username),
                userID: normalizeText(params.userID)
            },
            source,
            timestamp
        };
    }
    const boundaryRegex = /(don'?t|do not|stop|never|no quiero|no me gusta|no hables|no menciones|prohibido)/i;
    if (boundaryRegex.test(message)) {
        return {
            type: 'boundary',
            risk: 'medium',
            confidence: clampConfidence(0.74 + confidenceBoost),
            content: message,
            summary: `Boundary request from ${params.username}: ${message}`,
            subject: {
                scope: 'user',
                username: normalizeText(params.username),
                userID: normalizeText(params.userID)
            },
            source,
            timestamp
        };
    }
    const channelLoreRegex = /(in this channel|en este canal|aqui siempre|here we always|as we always|como siempre)/i;
    if (channelLoreRegex.test(message)) {
        return {
            type: 'channel_lore',
            risk: 'low',
            confidence: clampConfidence(0.8 + confidenceBoost),
            content: message,
            summary: `Channel lore note: ${message}`,
            subject: {
                scope: 'channel'
            },
            source,
            timestamp
        };
    }
    const runningJokeRegex = /(jaj+a+|lol+|lmao+|xd+|inside joke|meme del canal|joke of the day)/i;
    if (runningJokeRegex.test(lower)) {
        return {
            type: 'running_joke',
            risk: 'low',
            confidence: clampConfidence(0.7 + confidenceBoost),
            content: message,
            summary: `Potential running joke: ${message}`,
            subject: {
                scope: 'channel'
            },
            source,
            timestamp
        };
    }
    const knownUserFactRegex = /^(i am|i'm|soy|me llamo|my name is)\s+/i;
    if (knownUserFactRegex.test(message)) {
        return {
            type: 'known_user_fact',
            risk: 'medium',
            confidence: clampConfidence(0.73 + confidenceBoost),
            content: message,
            summary: `Known user fact from ${params.username}: ${message}`,
            subject: {
                scope: 'user',
                username: normalizeText(params.username),
                userID: normalizeText(params.userID)
            },
            source,
            timestamp
        };
    }
    return null;
}
