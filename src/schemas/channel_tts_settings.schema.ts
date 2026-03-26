import { Schema, model, type HydratedDocument, type Model, Types } from 'mongoose';

export type TtsLanguage = 'en' | 'es';
export type TtsMode = 'speak' | 'ai' | 'clone';
export type TtsProvider = 'piper';

export interface ChannelTtsSettingsData {
    channelID: string;
    channel: string;
    enabled: boolean;
    provider: TtsProvider;
    defaultLanguage: TtsLanguage;
    voices: {
        en: string;
        es: string;
        aiDefault: string | null;
    };
    filters: {
        skipEmotes: boolean;
        stripLinks: boolean;
        normalizeWhitespace: boolean;
        maxLength: number;
    };
    queue: {
        maxItems: number;
    };
}

export interface IChannelTtsSettings extends ChannelTtsSettingsData {
    _id: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

export type ChannelTtsSettingsDocument = HydratedDocument<IChannelTtsSettings>;

export const DEFAULT_TTS_SETTINGS: Omit<ChannelTtsSettingsData, 'channelID' | 'channel'> = {
    enabled: true,
    provider: 'piper',
    defaultLanguage: 'es',
    voices: {
        en: 'en_US-ryan-medium',
        es: 'es_MX-ald-medium',
        aiDefault: null
    },
    filters: {
        skipEmotes: true,
        stripLinks: true,
        normalizeWhitespace: true,
        maxLength: 280
    },
    queue: {
        maxItems: 5
    }
};

function sanitizeMaxLength(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.max(30, Math.min(500, Math.trunc(parsed)));
}

function sanitizeMaxItems(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.max(1, Math.min(20, Math.trunc(parsed)));
}

export function createDefaultChannelTtsSettings(channelID: string, channel: string = ''): ChannelTtsSettingsData {
    return {
        channelID,
        channel,
        enabled: DEFAULT_TTS_SETTINGS.enabled,
        provider: DEFAULT_TTS_SETTINGS.provider,
        defaultLanguage: DEFAULT_TTS_SETTINGS.defaultLanguage,
        voices: { ...DEFAULT_TTS_SETTINGS.voices },
        filters: { ...DEFAULT_TTS_SETTINGS.filters },
        queue: { ...DEFAULT_TTS_SETTINGS.queue }
    };
}

export function normalizeChannelTtsSettings(
    input: Partial<ChannelTtsSettingsData> | null | undefined,
    channelID: string,
    channel: string = ''
): ChannelTtsSettingsData {
    const defaults = createDefaultChannelTtsSettings(channelID, channel);

    return {
        channelID,
        channel: String(input?.channel || channel || defaults.channel).trim(),
        enabled: input?.enabled ?? defaults.enabled,
        provider: input?.provider === 'piper' ? 'piper' : defaults.provider,
        defaultLanguage: input?.defaultLanguage === 'en' ? 'en' : defaults.defaultLanguage,
        voices: {
            en: String(input?.voices?.en || defaults.voices.en).trim() || defaults.voices.en,
            es: String(input?.voices?.es || defaults.voices.es).trim() || defaults.voices.es,
            aiDefault: typeof input?.voices?.aiDefault === 'string' && input.voices.aiDefault.trim() !== ''
                ? input.voices.aiDefault.trim()
                : defaults.voices.aiDefault
        },
        filters: {
            skipEmotes: input?.filters?.skipEmotes ?? defaults.filters.skipEmotes,
            stripLinks: input?.filters?.stripLinks ?? defaults.filters.stripLinks,
            normalizeWhitespace: input?.filters?.normalizeWhitespace ?? defaults.filters.normalizeWhitespace,
            maxLength: sanitizeMaxLength(input?.filters?.maxLength, defaults.filters.maxLength)
        },
        queue: {
            maxItems: sanitizeMaxItems(input?.queue?.maxItems, defaults.queue.maxItems)
        }
    };
}

const channelTtsSettingsSchema = new Schema<IChannelTtsSettings>({
    channelID: { type: String, required: true, unique: true },
    channel: { type: String, default: '' },
    enabled: { type: Boolean, default: DEFAULT_TTS_SETTINGS.enabled },
    provider: { type: String, enum: ['piper'], default: DEFAULT_TTS_SETTINGS.provider },
    defaultLanguage: { type: String, enum: ['en', 'es'], default: DEFAULT_TTS_SETTINGS.defaultLanguage },
    voices: {
        en: { type: String, default: DEFAULT_TTS_SETTINGS.voices.en },
        es: { type: String, default: DEFAULT_TTS_SETTINGS.voices.es },
        aiDefault: { type: String, default: DEFAULT_TTS_SETTINGS.voices.aiDefault }
    },
    filters: {
        skipEmotes: { type: Boolean, default: DEFAULT_TTS_SETTINGS.filters.skipEmotes },
        stripLinks: { type: Boolean, default: DEFAULT_TTS_SETTINGS.filters.stripLinks },
        normalizeWhitespace: { type: Boolean, default: DEFAULT_TTS_SETTINGS.filters.normalizeWhitespace },
        maxLength: { type: Number, default: DEFAULT_TTS_SETTINGS.filters.maxLength }
    },
    queue: {
        maxItems: { type: Number, default: DEFAULT_TTS_SETTINGS.queue.maxItems }
    }
}, {
    timestamps: true
});

export const ChannelTtsSettingsSchema = model<IChannelTtsSettings>('channel_tts_settings', channelTtsSettingsSchema);

export async function getChannelTtsSettings(channelID: string, channel: string = ''): Promise<ChannelTtsSettingsData> {
    const doc = await ChannelTtsSettingsSchema.findOne({ channelID }).lean<ChannelTtsSettingsData | null>();
    return normalizeChannelTtsSettings(doc, channelID, channel);
}

export async function upsertChannelTtsSettings(
    channelID: string,
    input: Partial<ChannelTtsSettingsData>,
    channel: string = ''
): Promise<ChannelTtsSettingsData> {
    const normalized = normalizeChannelTtsSettings(input, channelID, channel);
    const doc = await ChannelTtsSettingsSchema.findOneAndUpdate(
        { channelID },
        {
            $set: normalized
        },
        {
            new: true,
            upsert: true,
            setDefaultsOnInsert: true
        }
    ).lean<ChannelTtsSettingsData | null>();

    return normalizeChannelTtsSettings(doc, channelID, channel);
}

export function getChannelTtsSettingsModel(): Model<IChannelTtsSettings> {
    return ChannelTtsSettingsSchema;
}
