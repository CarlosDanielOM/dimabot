import { Schema, model, Types } from "mongoose";
import UsersSchema from "./users.schema.js";

interface IKnownUser {
    username: string;
    description: string;
    lastInteraction: Date;
    relationship: string;
}

interface IVoiceProfile {
    tone: string;
    cadence: string;
    style: string;
    catchphrases: string[];
}

interface IProfile {
    profileID: string;
    name: string;
    personality: string;
    personaMode: 'original' | 'inspired' | 'strict_roleplay';
    personaReference: string;
    tonePreset: 'family_friendly' | 'balanced' | 'dark_humor';
    voiceProfile: IVoiceProfile;
    createdAt: Date;
    updatedAt: Date;
}

interface ILearningConfig {
    enabled: boolean;
    autoConfirmEnabled: boolean;
    autoConfirmThreshold: number;
    minMessageLength: number;
    maxPendingMemories: number;
    maxConfirmedMemories: number;
    postStreamSummaryEnabled: boolean;
    weeklyMaintenanceEnabled: boolean;
    monthlyMaintenanceEnabled: boolean;
    autoApplyCreates: boolean;
    autoApplyEdits: boolean;
    autoApplyArchives: boolean;
    autoApplyPermanentDeletes: boolean;
    summaryMinDurationMinutes: number;
    summaryMinChatMessages: number;
    createMinConfidence: number;
    editMinConfidence: number;
    archiveMinConfidence: number;
    deleteMinConfidence: number;
    maxActionsPerRun: number;
    maxDeletesPerRun: number;
    minMemoryAgeDaysForDelete: number;
    minUnusedDaysForDelete: number;
}

interface IMemoryPolicy {
    prioritizeRecentChat: boolean;
    allowSensitiveMemories: boolean;
    allowUserPreferenceMemories: boolean;
    allowRunningJokes: boolean;
}

export interface IChannelAIPersonality {
    _id: Types.ObjectId;
    channelID: string;
    channel: string;
    profiles: IProfile[];
    activeProfileId: string;
    personality: string;
    personaMode: 'original' | 'inspired' | 'strict_roleplay';
    personaReference: string;
    tonePreset: 'family_friendly' | 'balanced' | 'dark_humor';
    voiceProfile: IVoiceProfile;
    learningConfig: ILearningConfig;
    memoryPolicy: IMemoryPolicy;
    rules: string[];
    knownUsers: IKnownUser[];
    contextWindow: number;
    createdAt: Date;
    updatedAt: Date;
}

const knownUserSchema = new Schema<IKnownUser>({
    username: { type: String, default: '' },
    description: { type: String, default: '' },
    lastInteraction: { type: Date, default: Date.now },
    relationship: { type: String, default: '' }
}, { _id: false });

const voiceProfileSchema = new Schema<IVoiceProfile>({
    tone: { type: String, default: 'friendly and playful' },
    cadence: { type: String, default: 'short and dynamic' },
    style: { type: String, default: 'chat-native and expressive' },
    catchphrases: { type: [String], default: [] }
}, { _id: false });

const profileSchema = new Schema<IProfile>({
    profileID: {
        type: String,
        required: true,
        default: () => new Types.ObjectId().toString()
    },
    name: {
        type: String,
        required: true,
        default: 'Default Personality'
    },
    personality: {
        type: String,
        required: true,
        default: 'You are a friendly Twitch chat moderator who speaks in Spanish by default but can adapt to other languages. You have a good sense of humor and can be playful with chat users.'
    },
    personaMode: {
        type: String,
        enum: ['original', 'inspired', 'strict_roleplay'],
        default: 'original'
    },
    personaReference: {
        type: String,
        default: ''
    },
    tonePreset: {
        type: String,
        enum: ['family_friendly', 'balanced', 'dark_humor'],
        default: 'balanced'
    },
    voiceProfile: {
        type: voiceProfileSchema,
        default: () => ({
            tone: 'friendly and playful',
            cadence: 'short and dynamic',
            style: 'chat-native and expressive',
            catchphrases: []
        })
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { _id: false });

const learningConfigSchema = new Schema<ILearningConfig>({
    enabled: { type: Boolean, default: true },
    autoConfirmEnabled: { type: Boolean, default: true },
    autoConfirmThreshold: { type: Number, default: 0.82 },
    minMessageLength: { type: Number, default: 12 },
    maxPendingMemories: { type: Number, default: 250 },
    maxConfirmedMemories: { type: Number, default: 2000 },
    postStreamSummaryEnabled: { type: Boolean, default: true },
    weeklyMaintenanceEnabled: { type: Boolean, default: true },
    monthlyMaintenanceEnabled: { type: Boolean, default: true },
    autoApplyCreates: { type: Boolean, default: true },
    autoApplyEdits: { type: Boolean, default: true },
    autoApplyArchives: { type: Boolean, default: true },
    autoApplyPermanentDeletes: { type: Boolean, default: true },
    summaryMinDurationMinutes: { type: Number, default: 20 },
    summaryMinChatMessages: { type: Number, default: 30 },
    createMinConfidence: { type: Number, default: 0.72 },
    editMinConfidence: { type: Number, default: 0.74 },
    archiveMinConfidence: { type: Number, default: 0.8 },
    deleteMinConfidence: { type: Number, default: 0.88 },
    maxActionsPerRun: { type: Number, default: 20 },
    maxDeletesPerRun: { type: Number, default: 5 },
    minMemoryAgeDaysForDelete: { type: Number, default: 30 },
    minUnusedDaysForDelete: { type: Number, default: 21 }
}, { _id: false });

const memoryPolicySchema = new Schema<IMemoryPolicy>({
    prioritizeRecentChat: { type: Boolean, default: true },
    allowSensitiveMemories: { type: Boolean, default: false },
    allowUserPreferenceMemories: { type: Boolean, default: true },
    allowRunningJokes: { type: Boolean, default: true }
}, { _id: false });

function getPersonalityLimitForTier(planTier: string | null | undefined): number {
    if (planTier === 'pro')
        return 3;
    if (planTier === 'premium')
        return 2;
    return 1;
}

function buildLegacyProfileFallback(doc: IChannelAIPersonality): IProfile {
    return {
        profileID: new Types.ObjectId().toString(),
        name: 'Default Personality',
        personality: doc.personality || 'You are a friendly Twitch chat moderator who speaks in Spanish by default but can adapt to other languages. You have a good sense of humor and can be playful with chat users.',
        personaMode: doc.personaMode || 'original',
        personaReference: doc.personaReference || '',
        tonePreset: doc.tonePreset || 'balanced',
        voiceProfile: {
            tone: doc.voiceProfile?.tone || 'friendly and playful',
            cadence: doc.voiceProfile?.cadence || 'short and dynamic',
            style: doc.voiceProfile?.style || 'chat-native and expressive',
            catchphrases: Array.isArray(doc.voiceProfile?.catchphrases) ? doc.voiceProfile.catchphrases : []
        },
        createdAt: new Date(),
        updatedAt: new Date()
    };
}

function ensureProfiles(doc: IChannelAIPersonality): void {
    if (!Array.isArray(doc.profiles) || doc.profiles.length === 0) {
        doc.profiles = [buildLegacyProfileFallback(doc)];
    }
    const firstProfile = doc.profiles[0];
    if (!doc.activeProfileId || !doc.profiles.some((profile) => profile.profileID === doc.activeProfileId)) {
        doc.activeProfileId = firstProfile.profileID;
    }
    const activeProfile = doc.profiles.find((profile) => profile.profileID === doc.activeProfileId) || firstProfile;
    doc.personality = activeProfile.personality;
    doc.personaMode = activeProfile.personaMode;
    doc.personaReference = activeProfile.personaReference || '';
    doc.tonePreset = activeProfile.tonePreset || 'balanced';
    doc.voiceProfile = {
        tone: activeProfile.voiceProfile?.tone || 'friendly and playful',
        cadence: activeProfile.voiceProfile?.cadence || 'short and dynamic',
        style: activeProfile.voiceProfile?.style || 'chat-native and expressive',
        catchphrases: Array.isArray(activeProfile.voiceProfile?.catchphrases) ? activeProfile.voiceProfile.catchphrases : []
    };
}

const channelAIPersonalitySchema = new Schema<IChannelAIPersonality>({
    channelID: { type: String, required: true },
    channel: { type: String, required: true },
    profiles: {
        type: [profileSchema],
        default: []
    },
    activeProfileId: {
        type: String,
        default: ''
    },
    personality: {
        type: String,
        required: true,
        default: "You are a friendly Twitch chat moderator who speaks in Spanish by default but can adapt to other languages. You have a good sense of humor and can be playful with chat users."
    },
    personaMode: {
        type: String,
        enum: ['original', 'inspired', 'strict_roleplay'],
        default: 'original'
    },
    personaReference: {
        type: String,
        default: ''
    },
    tonePreset: {
        type: String,
        enum: ['family_friendly', 'balanced', 'dark_humor'],
        default: 'balanced'
    },
    voiceProfile: {
        type: voiceProfileSchema,
        default: () => ({
            tone: 'friendly and playful',
            cadence: 'short and dynamic',
            style: 'chat-native and expressive',
            catchphrases: []
        })
    },
    learningConfig: {
        type: learningConfigSchema,
        default: () => ({
            enabled: true,
            autoConfirmEnabled: true,
            autoConfirmThreshold: 0.82,
            minMessageLength: 12,
            maxPendingMemories: 250,
            maxConfirmedMemories: 2000,
            postStreamSummaryEnabled: true,
            weeklyMaintenanceEnabled: true,
            monthlyMaintenanceEnabled: true,
            autoApplyCreates: true,
            autoApplyEdits: true,
            autoApplyArchives: true,
            autoApplyPermanentDeletes: true,
            summaryMinDurationMinutes: 20,
            summaryMinChatMessages: 30,
            createMinConfidence: 0.72,
            editMinConfidence: 0.74,
            archiveMinConfidence: 0.8,
            deleteMinConfidence: 0.88,
            maxActionsPerRun: 20,
            maxDeletesPerRun: 5,
            minMemoryAgeDaysForDelete: 30,
            minUnusedDaysForDelete: 21
        })
    },
    memoryPolicy: {
        type: memoryPolicySchema,
        default: () => ({
            prioritizeRecentChat: true,
            allowSensitiveMemories: false,
            allowUserPreferenceMemories: true,
            allowRunningJokes: true
        })
    },
    rules: [{
        type: String,
        required: true,
        default: "Be respectful and friendly with users"
    }],
    knownUsers: [knownUserSchema],
    contextWindow: {
        type: Number,
        required: true,
        default: 7
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

channelAIPersonalitySchema.pre('validate', function (next) {
    ensureProfiles(this as any);
    next();
});

channelAIPersonalitySchema.pre('save', async function (next) {
    ensureProfiles(this as any);

    const user = await UsersSchema.findOne({
        'accounts.type': 'twitch',
        'accounts.id': (this as any).channelID
    });

    if (!user) {
        throw new Error('User not found for channel');
    }

    const profileLimit = getPersonalityLimitForTier(user.plan_tier);
    const profiles = (this as any).profiles;

    if (profiles.length > profileLimit) {
        throw new Error(`Current plan allows up to ${profileLimit} personality profile${profileLimit > 1 ? 's' : ''}`);
    }

    if (profiles.length <= 0) {
        throw new Error('At least one personality profile is required');
    }

    const now = new Date();
    this.profiles = profiles.map((profile: IProfile) => {
        const hasCreatedAt = profile.createdAt instanceof Date;
        return {
            ...profile,
            createdAt: hasCreatedAt ? profile.createdAt : now,
            updatedAt: now
        };
    });

    if (user.plan_tier === 'pro') {
        (this as any).contextWindow = 35;
        return next();
    }

    if (user.plan_tier === 'premium') {
        if ((this as any).rules.length > 5) {
            throw new Error('Premium channels can only have up to 5 rules');
        }
        if ((this as any).knownUsers.length > 10) {
            throw new Error('Premium channels can only have up to 10 known users');
        }
        (this as any).contextWindow = 15;
    } else {
        if ((this as any).rules.length > 3) {
            throw new Error('Free channels can only have up to 3 rules');
        }
        if ((this as any).knownUsers.length > 3) {
            throw new Error('Free channels can only have up to 3 known users');
        }
        (this as any).contextWindow = 7;
    }

    next();
});

export const ChannelAIPersonalitySchema = model<IChannelAIPersonality>('ChannelAIPersonality', channelAIPersonalitySchema);
