import express, { type Request, type Response } from "express";
import mongoose from "mongoose";
import EventsubSchema from "../../schemas/eventsub.schema.js";
import UsersSchema from "../../schemas/users.schema.js";
import { EventSchema } from "../../schemas/event.schema.js";
import { subscribeTwitchEvent, unsubscribeTwitchEvent } from "../../utils/eventsub.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";

const router = express.Router();
const NON_DISABLEABLE_EVENT_TYPES = new Set(['stream.online', 'stream.offline']);

type PlanTier = 'free' | 'premium' | 'pro';

const PLAN_RANK: Record<PlanTier, number> = {
    free: 0,
    premium: 1,
    pro: 2
};

function hasPlanAccess(userPlan: PlanTier, requiredPlan: PlanTier): boolean {
    return PLAN_RANK[userPlan] >= PLAN_RANK[requiredPlan];
}

async function getUserPlanTier(twitchUserId: string): Promise<PlanTier> {
    const user = await UsersSchema.findOne(
        { 'accounts.id': twitchUserId, 'accounts.type': 'twitch' },
        { plan_tier: 1 }
    ).lean() as { plan_tier?: PlanTier } | null;

    if (user?.plan_tier === 'premium' || user?.plan_tier === 'pro') {
        return user.plan_tier;
    }

    return 'free';
}

function getTierLimitForPlan(
    tierLimits: { free?: number; premium?: number; pro?: number } | undefined,
    plan: PlanTier
): number {
    if (!tierLimits) {
        return plan === 'free' ? 0 : plan === 'premium' ? 2 : 5;
    }

    if (plan === 'pro') {
        return typeof tierLimits.pro === 'number' ? tierLimits.pro : 5;
    }

    if (plan === 'premium') {
        return typeof tierLimits.premium === 'number' ? tierLimits.premium : 2;
    }

    return typeof tierLimits.free === 'number' ? tierLimits.free : 0;
}

function extractCheerTiers(config: unknown, body: unknown): unknown[] | null {
    if (config && typeof config === 'object' && Array.isArray((config as { cheerTiers?: unknown[] }).cheerTiers)) {
        return (config as { cheerTiers: unknown[] }).cheerTiers;
    }

    if (body && typeof body === 'object' && Array.isArray((body as { cheerTiers?: unknown[] }).cheerTiers)) {
        return (body as { cheerTiers: unknown[] }).cheerTiers;
    }

    return null;
}

router.get('/:channelID', authMiddleware as any, async (req: Request, res: Response) => {
        try {
            const { channelID } = req.params;
            const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
            const query = req.query;
            const type = query.type as string | null;
            const id = query.id as string | null;

            let eventsub;

            if (id) {
                if (!mongoose.isValidObjectId(id)) {
                    return res.status(400).send({
                        error: 'Invalid ID',
                        message: 'ID is not a valid ObjectID',
                        status: 400
                    });
                }
                eventsub = await EventsubSchema.find({ channelID: channelIdStr, _id: id });
            } else if (type) {
                eventsub = await EventsubSchema.find({ channelID: channelIdStr, type });
            } else {
                eventsub = await EventsubSchema.find({ channelID: channelIdStr });
            }

            if (!eventsub || eventsub.length === 0) {
                return res.status(404).send({
                    error: 'Not Found',
                    message: 'No eventsub found',
                    status: 404
                });
            }

            return res.status(200).send({
                error: false,
                data: eventsub,
                total: eventsub.length
            });
        } catch (error) {
            console.error('Error in GET /:channelID:', {
                channelID: req.params.channelID,
                query: req.query,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString()
            });

            res.status(500).send({
                error: true,
                message: 'Internal server error',
                status: 500
            });
        }
    });

    router.post('/:channelID', authMiddleware as any, async (req: Request, res: Response) => {
        try {
            const { channelID } = req.params;
            const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
            const body = req.body;
            const type = body.type as string;
            const version = body.version as string;
            const condition = body.condition;
            const config = body.config ?? null;

            if (!type || !version || !condition) {
                return res.status(400).send({
                    error: 'Bad Request',
                    message: 'Missing type, version or condition',
                    status: 400
                });
            }

            const userPlan = await getUserPlanTier(channelIdStr);

            const eventTemplate = await EventSchema.findOne(
                { type },
                { plan_tier: 1, tierLimits: 1 }
            ).lean() as {
                plan_tier?: PlanTier;
                tierLimits?: { free?: number; premium?: number; pro?: number };
            } | null;

            const requiredPlan: PlanTier =
                eventTemplate?.plan_tier === 'premium' || eventTemplate?.plan_tier === 'pro'
                    ? eventTemplate.plan_tier
                    : 'free';

            if (!hasPlanAccess(userPlan, requiredPlan)) {
                return res.status(403).send({
                    error: true,
                    message: `This event requires ${requiredPlan} plan`,
                    status: 403
                });
            }

            const cheerTiers = extractCheerTiers(config, body);
            if (cheerTiers) {
                const tierLimit = getTierLimitForPlan(eventTemplate?.tierLimits, userPlan);
                if (cheerTiers.length > tierLimit) {
                    return res.status(403).send({
                        error: true,
                        message: `Your ${userPlan} plan allows up to ${tierLimit} cheer tiers`,
                        status: 403
                    });
                }
            }

            const eventsub = await subscribeTwitchEvent(channelIdStr, type, version, condition, config);

            if (!eventsub || (eventsub as any).error) {
                return res.status(400).send({
                    error: 'Bad Request',
                    message: 'Failed to create eventsub',
                    status: 400
                });
            }

            return res.status(201).send({
                error: false,
                data: eventsub
            });
        } catch (error) {
            console.error('Error in POST /:channelID:', {
                channelID: req.params.channelID,
                body: req.body,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString()
            });

            res.status(500).send({
                error: true,
                message: 'Internal server error',
                status: 500
            });
        }
    });

router.delete('/:channelID/:id', authMiddleware as any, async (req: Request, res: Response) => {
        try {
            const { channelID, id } = req.params;
            const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
            const idStr = Array.isArray(id) ? id[0] : id;

            const eventsub = await EventsubSchema.findOne({ channelID: channelIdStr, _id: idStr });

            if (!eventsub) {
                return res.status(404).send({
                    error: 'Not Found',
                    message: 'Eventsub not found',
                    status: 404
                });
            }

            if (NON_DISABLEABLE_EVENT_TYPES.has(eventsub.type)) {
                return res.status(403).send({
                    error: true,
                    message: 'This event cannot be deleted. Clear its message to silence chat output.',
                    status: 403
                });
            }

            const result = await unsubscribeTwitchEvent(eventsub.id);

            if ((result as any).error) {
                return res.status((result as any).status).send({
                    error: (result as any).error,
                    message: (result as any).message,
                    status: (result as any).status
                });
            }

            return res.status(200).send({
                error: false,
                message: 'Eventsub deleted',
                status: 200
            });
        } catch (error) {
            console.error('Error in DELETE /:channelID/:id:', {
                channelID: req.params.channelID,
                id: req.params.id,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString()
            });

            res.status(500).send({
                error: true,
                message: 'Internal server error',
                status: 500
            });
        }
    });

router.patch('/:channelID/:id', authMiddleware as any, async (req: Request, res: Response) => {
        try {
            const { channelID, id } = req.params;
            const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
            const idStr = Array.isArray(id) ? id[0] : id;

            if (!idStr) {
                return res.status(400).send({
                    error: 'Bad Request',
                    message: 'ID is required',
                    status: 400
                });
            } else {
                if (!mongoose.isValidObjectId(idStr)) {
                    return res.status(400).send({
                        error: 'Invalid ID',
                        message: 'ID is not a valid ObjectID',
                        status: 400
                    });
                }
            }

            const eventsub = await EventsubSchema.findOne({ _id: idStr, channelID: channelIdStr });

            if (!eventsub) {
                return res.status(404).send({
                    error: 'Not Found',
                    message: 'Eventsub not found',
                    status: 404
                });
            }

            if (
                NON_DISABLEABLE_EVENT_TYPES.has(eventsub.type) &&
                Object.prototype.hasOwnProperty.call(req.body, 'enabled') &&
                req.body.enabled === false
            ) {
                return res.status(403).send({
                    error: true,
                    message: 'This event cannot be disabled. Clear its message to silence chat output.',
                    status: 403
                });
            }

            const userPlan = await getUserPlanTier(channelIdStr);
            const eventTemplate = await EventSchema.findOne(
                { type: eventsub.type },
                { plan_tier: 1, tierLimits: 1 }
            ).lean() as {
                plan_tier?: PlanTier;
                tierLimits?: { free?: number; premium?: number; pro?: number };
            } | null;

            const requiredPlan: PlanTier =
                eventTemplate?.plan_tier === 'premium' || eventTemplate?.plan_tier === 'pro'
                    ? eventTemplate.plan_tier
                    : 'free';

            if (!hasPlanAccess(userPlan, requiredPlan)) {
                return res.status(403).send({
                    error: true,
                    message: `This event requires ${requiredPlan} plan`,
                    status: 403
                });
            }

            const cheerTiers = extractCheerTiers(undefined, req.body);
            if (cheerTiers) {
                const tierLimit = getTierLimitForPlan(eventTemplate?.tierLimits, userPlan);
                if (cheerTiers.length > tierLimit) {
                    return res.status(403).send({
                        error: true,
                        message: `Your ${userPlan} plan allows up to ${tierLimit} cheer tiers`,
                        status: 403
                    });
                }
            }

            const updatedEventsub = await EventsubSchema.findOneAndUpdate(
                { _id: idStr, channelID: channelIdStr },
                req.body,
                { new: true }
            ).lean();

            if (!updatedEventsub) {
                return res.status(400).send({
                    error: 'Bad Request',
                    message: 'Failed to update eventsub',
                    status: 400
                });
            }

            return res.status(200).send({
                error: false,
                data: updatedEventsub,
                status: 200
            });
        } catch (error) {
            console.error('Error in PATCH /:channelID/:id:', {
                channelID: req.params.channelID,
                id: req.params.id,
                body: req.body,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString()
            });

            res.status(500).send({
                error: true,
                message: 'Internal server error',
                status: 500
            });
        }
    });

export const eventsubRoute = router;
