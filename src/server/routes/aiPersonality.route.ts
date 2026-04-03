import express, { type Request, type Response } from "express";
import { Types } from "mongoose";
import { ChannelAIPersonalitySchema, type IChannelAIPersonality } from "../../schemas/channel_ai_personality.schema.js";
import UsersSchema from "../../schemas/users.schema.js";
import type { IUsers } from "../../schemas/users.schema.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";

interface UpdatePersonalityRequest {
    enabled?: boolean;
    profiles?: Array<{
        profileID?: string;
        name?: string;
        personality?: string;
        personaMode?: 'original' | 'inspired' | 'strict_roleplay';
        personaReference?: string;
        tonePreset?: 'family_friendly' | 'balanced' | 'dark_humor';
        voiceProfile?: {
            tone?: string;
            cadence?: string;
            style?: string;
            catchphrases?: string[];
        };
        createdAt?: Date | string;
        updatedAt?: Date | string;
    }>;
    activeProfileId?: string;
    personality?: string;
    personaMode?: 'original' | 'inspired' | 'strict_roleplay';
    personaReference?: string;
    tonePreset?: 'family_friendly' | 'balanced' | 'dark_humor';
    voiceProfile?: {
        tone?: string;
        cadence?: string;
        style?: string;
        catchphrases?: string[];
    };
    learningConfig?: {
        enabled?: boolean;
        autoConfirmEnabled?: boolean;
        autoConfirmThreshold?: number;
        minMessageLength?: number;
        maxPendingMemories?: number;
        maxConfirmedMemories?: number;
        postStreamSummaryEnabled?: boolean;
        weeklyMaintenanceEnabled?: boolean;
        monthlyMaintenanceEnabled?: boolean;
        autoApplyCreates?: boolean;
        autoApplyEdits?: boolean;
        autoApplyArchives?: boolean;
        autoApplyPermanentDeletes?: boolean;
        summaryMinDurationMinutes?: number;
        summaryMinChatMessages?: number;
        createMinConfidence?: number;
        editMinConfidence?: number;
        archiveMinConfidence?: number;
        deleteMinConfidence?: number;
        maxActionsPerRun?: number;
        maxDeletesPerRun?: number;
        minMemoryAgeDaysForDelete?: number;
        minUnusedDaysForDelete?: number;
    };
    memoryPolicy?: {
        prioritizeRecentChat?: boolean;
        allowSensitiveMemories?: boolean;
        allowUserPreferenceMemories?: boolean;
        allowRunningJokes?: boolean;
    };
    rules?: string[];
    knownUsers?: Array<{
        username?: string;
        description?: string;
        relationship?: string;
        lastInteraction?: Date | string;
    }>;
}

interface AddKnownUserRequest {
    username?: string;
    description?: string;
    relationship?: string;
}

interface TierLimits {
    profiles: number;
    rules: number | string;
    knownUsers: number | string;
    contextWindow: number;
}

interface TierInfo {
    isPremiumPlus: boolean;
    isPremium: boolean;
    limits: TierLimits;
}

async function getChannelTierInfo(channelID: string): Promise<IUsers | null> {
    return await UsersSchema.findOne({
        'accounts.type': 'twitch',
        'accounts.id': channelID
    }) as IUsers | null;
}

function getTierLimits(planTier: string | null | undefined): TierInfo {
    const isPro = planTier === 'pro';
    const isPremium = planTier === 'premium';
    
    const profileLimit = isPro ? 3 : (isPremium ? 2 : 1);
    const rulesLimit = isPro ? 'unlimited' : (isPremium ? 5 : 3);
    const knownUsersLimit = isPro ? 'unlimited' : (isPremium ? 10 : 3);
    const contextWindowValue = isPro ? 35 : (isPremium ? 15 : 7);
    
    return {
        isPremiumPlus: isPro,
        isPremium: isPremium,
        limits: {
            profiles: profileLimit,
            rules: rulesLimit,
            knownUsers: knownUsersLimit,
            contextWindow: contextWindowValue
        }
    };
}

function buildDefaultPersonality(channelID: string, user: IUsers): Partial<IChannelAIPersonality> {
    const twitchAccount = user.accounts.find((account) => account.type === 'twitch' && account.id === channelID);
    const channelName = twitchAccount?.name || user.name || 'Unknown';
    const tierInfo = getTierLimits(user.plan_tier);

    return {
        channelID,
        channel: channelName,
        contextWindow: tierInfo.limits.contextWindow,
        personality: `You are a friendly and playful Twitch chat moderator for ${channelName}. You speak in Spanish by default but can adapt to other languages. You have a good sense of humor and enjoy interacting with chat users. You maintain a fun and engaging atmosphere while still being able to moderate when necessary.`,
        rules: ['Be respectful and friendly with users'],
        knownUsers: [
            {
                username: 'cdom201',
                description: 'Creator, Owner and Developer of you, bot',
                relationship: 'professional',
                lastInteraction: new Date()
            }
        ]
    };
}

async function getOrCreatePersonality(channelID: string, user: IUsers): Promise<IChannelAIPersonality> {
    const personality = await ChannelAIPersonalitySchema.findOne({ channelID });
    if (personality) {
        return personality;
    }

    return await ChannelAIPersonalitySchema.create(buildDefaultPersonality(channelID, user));
}

function sanitizeRules(rules: string[] | undefined): string[] | undefined {
    if (!Array.isArray(rules)) {
        return undefined;
    }

    return rules
        .map((rule) => String(rule || '').trim())
        .filter(Boolean);
}

function sanitizeKnownUsers(knownUsers: UpdatePersonalityRequest['knownUsers']): IChannelAIPersonality['knownUsers'] | undefined {
    if (!Array.isArray(knownUsers)) {
        return undefined;
    }

    return knownUsers
        .map((knownUser) => ({
            username: String(knownUser?.username || '').trim(),
            description: String(knownUser?.description || '').trim(),
            relationship: String(knownUser?.relationship || '').trim(),
            lastInteraction: knownUser?.lastInteraction ? new Date(knownUser.lastInteraction) : new Date()
        }))
        .filter((knownUser) => Boolean(knownUser.username));
}

function sanitizeProfiles(profiles: UpdatePersonalityRequest['profiles']): IChannelAIPersonality['profiles'] | undefined {
    if (!Array.isArray(profiles)) {
        return undefined;
    }

    return profiles
        .map((profile) => ({
            profileID: String(profile?.profileID || new Types.ObjectId().toString()).trim(),
            name: String(profile?.name || 'Default Personality').trim() || 'Default Personality',
            personality: String(profile?.personality || '').trim(),
            personaMode: profile?.personaMode || 'original',
            personaReference: String(profile?.personaReference || '').trim(),
            tonePreset: profile?.tonePreset || 'balanced',
            voiceProfile: {
                tone: String(profile?.voiceProfile?.tone || 'friendly and playful').trim(),
                cadence: String(profile?.voiceProfile?.cadence || 'short and dynamic').trim(),
                style: String(profile?.voiceProfile?.style || 'chat-native and expressive').trim(),
                catchphrases: Array.isArray(profile?.voiceProfile?.catchphrases)
                    ? profile.voiceProfile.catchphrases.map((catchphrase) => String(catchphrase || '').trim()).filter(Boolean)
                    : []
            },
            createdAt: profile?.createdAt ? new Date(profile.createdAt) : new Date(),
            updatedAt: new Date()
        }))
        .filter((profile) => Boolean(profile.personality));
}

function sanitizeLearningConfig(
    learningConfig: UpdatePersonalityRequest['learningConfig'],
    currentLearningConfig: IChannelAIPersonality['learningConfig']
): IChannelAIPersonality['learningConfig'] | undefined {
    if (!learningConfig) {
        return undefined;
    }

    const numberValue = (value: number | undefined, fallback: number, min?: number, max?: number): number => {
        const normalized = Number.isFinite(value) ? Number(value) : fallback;
        const withMin = min !== undefined ? Math.max(min, normalized) : normalized;
        return max !== undefined ? Math.min(max, withMin) : withMin;
    };

    return {
        enabled: typeof learningConfig.enabled === 'boolean' ? learningConfig.enabled : currentLearningConfig.enabled,
        autoConfirmEnabled:
            typeof learningConfig.autoConfirmEnabled === 'boolean'
                ? learningConfig.autoConfirmEnabled
                : currentLearningConfig.autoConfirmEnabled,
        autoConfirmThreshold: numberValue(
            learningConfig.autoConfirmThreshold,
            currentLearningConfig.autoConfirmThreshold,
            0,
            1
        ),
        minMessageLength: numberValue(learningConfig.minMessageLength, currentLearningConfig.minMessageLength, 1, 1000),
        maxPendingMemories: numberValue(learningConfig.maxPendingMemories, currentLearningConfig.maxPendingMemories, 1, 10000),
        maxConfirmedMemories: numberValue(
            learningConfig.maxConfirmedMemories,
            currentLearningConfig.maxConfirmedMemories,
            1,
            100000
        ),
        postStreamSummaryEnabled:
            typeof learningConfig.postStreamSummaryEnabled === 'boolean'
                ? learningConfig.postStreamSummaryEnabled
                : currentLearningConfig.postStreamSummaryEnabled,
        weeklyMaintenanceEnabled:
            typeof learningConfig.weeklyMaintenanceEnabled === 'boolean'
                ? learningConfig.weeklyMaintenanceEnabled
                : currentLearningConfig.weeklyMaintenanceEnabled,
        monthlyMaintenanceEnabled:
            typeof learningConfig.monthlyMaintenanceEnabled === 'boolean'
                ? learningConfig.monthlyMaintenanceEnabled
                : currentLearningConfig.monthlyMaintenanceEnabled,
        autoApplyCreates:
            typeof learningConfig.autoApplyCreates === 'boolean'
                ? learningConfig.autoApplyCreates
                : currentLearningConfig.autoApplyCreates,
        autoApplyEdits:
            typeof learningConfig.autoApplyEdits === 'boolean'
                ? learningConfig.autoApplyEdits
                : currentLearningConfig.autoApplyEdits,
        autoApplyArchives:
            typeof learningConfig.autoApplyArchives === 'boolean'
                ? learningConfig.autoApplyArchives
                : currentLearningConfig.autoApplyArchives,
        autoApplyPermanentDeletes:
            typeof learningConfig.autoApplyPermanentDeletes === 'boolean'
                ? learningConfig.autoApplyPermanentDeletes
                : currentLearningConfig.autoApplyPermanentDeletes,
        summaryMinDurationMinutes: numberValue(
            learningConfig.summaryMinDurationMinutes,
            currentLearningConfig.summaryMinDurationMinutes,
            1,
            1440
        ),
        summaryMinChatMessages: numberValue(
            learningConfig.summaryMinChatMessages,
            currentLearningConfig.summaryMinChatMessages,
            1,
            100000
        ),
        createMinConfidence: numberValue(learningConfig.createMinConfidence, currentLearningConfig.createMinConfidence, 0, 1),
        editMinConfidence: numberValue(learningConfig.editMinConfidence, currentLearningConfig.editMinConfidence, 0, 1),
        archiveMinConfidence: numberValue(
            learningConfig.archiveMinConfidence,
            currentLearningConfig.archiveMinConfidence,
            0,
            1
        ),
        deleteMinConfidence: numberValue(learningConfig.deleteMinConfidence, currentLearningConfig.deleteMinConfidence, 0, 1),
        maxActionsPerRun: numberValue(learningConfig.maxActionsPerRun, currentLearningConfig.maxActionsPerRun, 1, 1000),
        maxDeletesPerRun: numberValue(learningConfig.maxDeletesPerRun, currentLearningConfig.maxDeletesPerRun, 0, 1000),
        minMemoryAgeDaysForDelete: numberValue(
            learningConfig.minMemoryAgeDaysForDelete,
            currentLearningConfig.minMemoryAgeDaysForDelete,
            0,
            3650
        ),
        minUnusedDaysForDelete: numberValue(
            learningConfig.minUnusedDaysForDelete,
            currentLearningConfig.minUnusedDaysForDelete,
            0,
            3650
        )
    };
}

function sanitizeMemoryPolicy(
    memoryPolicy: UpdatePersonalityRequest['memoryPolicy'],
    currentMemoryPolicy: IChannelAIPersonality['memoryPolicy']
): IChannelAIPersonality['memoryPolicy'] | undefined {
    if (!memoryPolicy) {
        return undefined;
    }

    return {
        prioritizeRecentChat:
            typeof memoryPolicy.prioritizeRecentChat === 'boolean'
                ? memoryPolicy.prioritizeRecentChat
                : currentMemoryPolicy.prioritizeRecentChat,
        allowSensitiveMemories:
            typeof memoryPolicy.allowSensitiveMemories === 'boolean'
                ? memoryPolicy.allowSensitiveMemories
                : currentMemoryPolicy.allowSensitiveMemories,
        allowUserPreferenceMemories:
            typeof memoryPolicy.allowUserPreferenceMemories === 'boolean'
                ? memoryPolicy.allowUserPreferenceMemories
                : currentMemoryPolicy.allowUserPreferenceMemories,
        allowRunningJokes:
            typeof memoryPolicy.allowRunningJokes === 'boolean'
                ? memoryPolicy.allowRunningJokes
                : currentMemoryPolicy.allowRunningJokes
    };
}

const router = express.Router();

router.get('/:channelID', async (req: Request, res: Response) => {
        const channelID = Array.isArray(req.params.channelID) ? req.params.channelID[0] : req.params.channelID;

        try {
            const user = await getChannelTierInfo(channelID);
            
            if (!user) {
                return res.status(404).json({
                    error: true,
                    message: 'Channel not found',
                    status: 404
                });
            }

            const personality = await getOrCreatePersonality(channelID, user);
            const tierInfo = getTierLimits(user.plan_tier as string | undefined);
            const response = (personality as any).toObject();
            (response as any).tier = tierInfo;

            return res.status(200).json({
                error: false,
                data: response
            });

        } catch (error) {
            console.error('Error in GET /:channelID:', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString(),
                channelID
            });

            return res.status(500).json({
                error: true,
                message: 'Error fetching channel personality',
                status: 500
            });
        }
    });

router.put('/:channelID', authMiddleware as any, async (req: any, res: Response) => {
        const channelID = Array.isArray(req.params.channelID) ? req.params.channelID[0] : req.params.channelID;
        const body = req.body as UpdatePersonalityRequest;

        try {
            const user = await getChannelTierInfo(channelID);
            
            if (!user) {
                return res.status(404).json({
                    error: true,
                    message: 'Channel not found',
                    status: 404
                });
            }

            const personality = await getOrCreatePersonality(channelID, user);
            const tierInfo = getTierLimits(user.plan_tier);

            const sanitizedEnabled = typeof body.enabled === 'boolean' ? body.enabled : personality.enabled;
            const sanitizedProfiles = sanitizeProfiles(body.profiles);
            const sanitizedRules = sanitizeRules(body.rules);
            const sanitizedKnownUsers = sanitizeKnownUsers(body.knownUsers);
            const sanitizedLearningConfig = sanitizeLearningConfig(body.learningConfig, personality.learningConfig);
            const sanitizedMemoryPolicy = sanitizeMemoryPolicy(body.memoryPolicy, personality.memoryPolicy);

            if (body.enabled !== undefined) {
                (personality as any).enabled = sanitizedEnabled;
            }

            if (sanitizedProfiles !== undefined) {
                (personality as any).profiles = sanitizedProfiles;
            }

            if (body.activeProfileId !== undefined) {
                (personality as any).activeProfileId = String(body.activeProfileId || '').trim();
            }

            if (body.personality !== undefined) {
                (personality as any).personality = String(body.personality || '').trim();
            }

            if (body.personaMode !== undefined) {
                (personality as any).personaMode = body.personaMode;
            }

            if (body.personaReference !== undefined) {
                (personality as any).personaReference = String(body.personaReference || '').trim();
            }

            if (body.tonePreset !== undefined) {
                (personality as any).tonePreset = body.tonePreset;
            }

            if (body.voiceProfile !== undefined) {
                (personality as any).voiceProfile = {
                    tone: String(body.voiceProfile?.tone || '').trim(),
                    cadence: String(body.voiceProfile?.cadence || '').trim(),
                    style: String(body.voiceProfile?.style || '').trim(),
                    catchphrases: Array.isArray(body.voiceProfile?.catchphrases)
                        ? body.voiceProfile.catchphrases.map((catchphrase) => String(catchphrase || '').trim()).filter(Boolean)
                        : []
                };
            }

            if (sanitizedRules !== undefined) {
                (personality as any).rules = sanitizedRules;
            }

            if (sanitizedKnownUsers !== undefined) {
                (personality as any).knownUsers = sanitizedKnownUsers;
            }

            if (sanitizedLearningConfig !== undefined) {
                (personality as any).learningConfig = sanitizedLearningConfig;
            }

            if (sanitizedMemoryPolicy !== undefined) {
                (personality as any).memoryPolicy = sanitizedMemoryPolicy;
            }

            (personality as any).contextWindow = tierInfo.limits.contextWindow;
            (personality as any).updatedAt = new Date();

            await (personality as any).save();

            const updatedPersonality = await ChannelAIPersonalitySchema.findOne({ channelID });
            const response = (updatedPersonality as any)?.toObject ? (updatedPersonality as any).toObject() : updatedPersonality;

            if (response) {
                (response as any).tier = tierInfo;
            }

            return res.status(200).json({
                error: false,
                data: response
            });

        } catch (error) {
            console.error('Error in PUT /:channelID:', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString(),
                channelID
            });

            return res.status(500).json({
                error: true,
                message: error instanceof Error ? error.message : 'Error updating channel personality',
                status: 500
            });
        }
    });

router.post('/:channelID/known-users', authMiddleware as any, async (req: any, res: Response) => {
        const channelID = Array.isArray(req.params.channelID) ? req.params.channelID[0] : req.params.channelID;
        const body = req.body as AddKnownUserRequest;

        if (!body.username) {
            return res.status(400).json({
                error: true,
                message: 'Username is required',
                status: 400
            });
        }

        try {
            const user = await getChannelTierInfo(channelID);
            
            if (!user) {
                return res.status(404).json({
                    error: true,
                    message: 'Channel not found',
                    status: 404
                });
            }

            const personality = await getOrCreatePersonality(channelID, user);

            const currentCount = personality.knownUsers ? personality.knownUsers.length : 0;
            
            if (user.plan_tier !== 'pro') {
                if (user.plan_tier === 'premium' && currentCount >= 10) {
                    return res.status(400).json({
                        error: true,
                        message: 'Premium channels can only have up to 10 known users',
                        status: 400,
                        type: 'tier_limit'
                    });
                }
                
                if (user.plan_tier !== 'premium' && currentCount >= 3) {
                    return res.status(400).json({
                        error: true,
                        message: 'Free channels can only have up to 3 known users',
                        status: 400,
                        type: 'tier_limit'
                    });
                }
            }

            const knownUsersArray = (personality as any).knownUsers || [];
            const existingIndex = knownUsersArray.findIndex((u: any) => u.username === body.username);
            
            if (existingIndex >= 0) {
                knownUsersArray[existingIndex] = {
                    username: body.username,
                    description: body.description || '',
                    relationship: body.relationship || '',
                    lastInteraction: new Date()
                };
            } else {
                knownUsersArray.push({
                    username: body.username,
                    description: body.description || '',
                    relationship: body.relationship || '',
                    lastInteraction: new Date()
                });
            }

            (personality as any).knownUsers = knownUsersArray;
            (personality as any).updatedAt = new Date();
            await (personality as any).save();

            return res.status(200).json({
                error: false,
                data: personality
            });

        } catch (error) {
            console.error('Error in POST /:channelID/known-users:', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString(),
                channelID
            });

            return res.status(500).json({
                error: true,
                message: error instanceof Error ? error.message : 'Error updating known user',
                status: 500
            });
        }
    });

export const aiPersonalityRoute = router;
