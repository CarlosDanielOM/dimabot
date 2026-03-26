import { requestTts, type TtsRequestBody } from '../../functions/chats/speech.chat.js';
import { getChannelTtsSettings } from '../../schemas/channel_tts_settings.schema.js';
import {
    buildSpokenUserMessage,
    extractEmoteNames,
    normalizeTtsMessage
} from './normalize_tts_message.util.js';

interface QueueDefaultTtsInput {
    channelID: string;
    rawMessage: string;
    source: 'chat-command' | 'ast' | 'redemption';
    userID?: string;
    userLogin?: string;
    userName?: string;
    userLevel?: number;
    language?: 'en' | 'es';
    emotes?: Record<string, string[]>;
    emoteNames?: string[];
}

interface QueueDefaultTtsResult {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    data?: unknown;
}

function resolveDisplayName(input: QueueDefaultTtsInput): string {
    return String(input.userName || input.userLogin || '').trim();
}

export async function queueDefaultTts(input: QueueDefaultTtsInput): Promise<QueueDefaultTtsResult> {
    const rawMessage = String(input.rawMessage || '').trim();
    if (!rawMessage) {
        return {
            error: true,
            message: 'No message provided',
            status: 400,
            type: 'error'
        };
    }

    const settings = await getChannelTtsSettings(input.channelID);
    if (!settings.enabled) {
        return {
            error: true,
            message: 'TTS is disabled for this channel',
            status: 403,
            type: 'error'
        };
    }

    const emoteNames = input.emoteNames || extractEmoteNames(rawMessage, input.emotes);
    const normalized = normalizeTtsMessage(rawMessage, {
        skipEmotes: settings.filters.skipEmotes,
        stripLinks: settings.filters.stripLinks,
        normalizeWhitespace: settings.filters.normalizeWhitespace,
        maxLength: settings.filters.maxLength,
        emoteNames
    });

    if (normalized.error) {
        return {
            error: true,
            message: normalized.message,
            status: 400,
            type: 'error'
        };
    }

    const language = input.language || settings.defaultLanguage;
    const spokenMessage = buildSpokenUserMessage(resolveDisplayName(input), normalized.text, language);

    const payload: TtsRequestBody = {
        mode: 'speak',
        text: spokenMessage,
        language,
        requestedBy: {
            userID: input.userID,
            userLogin: input.userLogin,
            userName: resolveDisplayName(input),
            userLevel: input.userLevel
        },
        meta: {
            source: input.source,
            originalText: rawMessage,
            skipEmotes: settings.filters.skipEmotes,
            stripLinks: settings.filters.stripLinks
        }
    };

    return await requestTts(input.channelID, payload);
}
