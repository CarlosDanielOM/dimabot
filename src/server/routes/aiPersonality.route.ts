import express, { type Request, type Response } from "express";
import { getDirname } from "../../utils/pollyfills.js";
import { ChannelAIPersonalitySchema, type IChannelAIPersonality } from "../../schemas/channel_ai_personality.schema.js";
import UsersSchema from "../../schemas/users.schema.js";
import type { IUsers } from "../../schemas/users.schema.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import type { AuthRequest } from "../../middleware/types.js";

const __dirname = getDirname(import.meta.url);

interface UpdatePersonalityRequest {
    personality?: string;
    rules?: string[];
    knownUsers?: any[];
}

interface AddKnownUserRequest {
    username?: string;
    description?: string;
    relationship?: string;
}

interface StandardResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    data?: any;
}

interface TierLimits {
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

async function getPersonality(channelID: string): Promise<IChannelAIPersonality | null> {
    return await ChannelAIPersonalitySchema.findOne({ channelID: channelID });
}

function getTierLimits(planTier: string | null | undefined): TierInfo {
    const isPro = planTier === 'pro';
    const isPremium = planTier === 'premium';
    
    return {
        isPremiumPlus: isPro,
        isPremium: isPremium,
        limits: {
            rules: isPro ? 'unlimited' : (isPremium ? 5 : 3),
            knownUsers: isPro ? 'unlimited' : (isPremium ? 10 : 5),
            contextWindow: isPro ? 15 : (isPremium ? 7 : 3)
        }
    };
}

function validateTierLimits(planTier: string | null | undefined, rules: string[] | undefined, knownUsers: any[] | undefined): { valid: boolean; message?: string } {
    const isPro = planTier === 'pro';
    const isPremium = planTier === 'premium';
    
    if (!isPro) {
        if (isPremium) {
            if (rules && rules.length > 5) {
                return { valid: false, message: 'Premium channels can only have up to 5 rules' };
            }
            if (knownUsers && knownUsers.length > 10) {
                return { valid: false, message: 'Premium channels can only have up to 10 known users' };
            }
        } else {
            if (rules && rules.length > 3) {
                return { valid: false, message: 'Free channels can only have up to 3 rules' };
            }
            if (knownUsers && knownUsers.length > 5) {
                return { valid: false, message: 'Free channels can only have up to 5 known users' };
            }
        }
    }
    
    return { valid: true };
}

export const aiPersonalityRoute = (app: express.Application): void => {

    app.get('/:channelID', async (req: Request, res: Response) => {
        const channelID = req.params.channelID;

        try {
            const personality = await getPersonality(channelID);
            
            if (!personality) {
                return res.status(404).json({
                    error: true,
                    message: 'Channel personality not found',
                    status: 404
                });
            }

            const user = await getChannelTierInfo(channelID);
            
            if (!user) {
                return res.status(404).json({
                    error: true,
                    message: 'Channel not found',
                    status: 404
                });
            }

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

    app.put('/:channelID', authMiddleware as any, async (req: any, res: Response) => {
        const channelID = req.params.channelID;
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

            const validation = validateTierLimits(user.plan_tier, body.rules, body.knownUsers);
            
            if (!validation.valid) {
                return res.status(400).json({
                    error: true,
                    message: validation.message || 'Tier limit validation failed',
                    status: 400,
                    type: 'tier_limit'
                });
            }

            const personality = await getPersonality(channelID);
            
            if (!personality) {
                return res.status(404).json({
                    error: true,
                    message: 'Channel personality not found',
                    status: 404
                });
            }

            const updateData: any = {
                updatedAt: new Date()
            };

            if (body.personality !== undefined) {
                updateData.personality = body.personality;
            }
            if (body.rules !== undefined) {
                updateData.rules = body.rules;
            }
            if (body.knownUsers !== undefined) {
                updateData.knownUsers = body.knownUsers;
            }

            const contextWindow = user.plan_tier === 'pro' ? 15 : (user.plan_tier === 'premium' ? 7 : 3);
            updateData.contextWindow = contextWindow;

            const updatedPersonality = await ChannelAIPersonalitySchema.findOneAndUpdate(
                { channelID },
                updateData,
                { new: true, upsert: true }
            );

            return res.status(200).json({
                error: false,
                data: updatedPersonality
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

    app.post('/:channelID/known-users', authMiddleware as any, async (req: any, res: Response) => {
        const channelID = req.params.channelID;
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

            const personality = await getPersonality(channelID);
            
            if (!personality) {
                return res.status(404).json({
                    error: true,
                    message: 'Channel personality not found',
                    status: 404
                });
            }

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
                        message: 'Free channels can only have up to 5 known users',
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
};
