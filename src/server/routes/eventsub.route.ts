import express, { type Request, type Response } from "express";
import mongoose from "mongoose";
import EventsubSchema from "../../schemas/eventsub.schema.js";
import UsersSchema from "../../schemas/users.schema.js";
import { EventSchema } from "../../schemas/event.schema.js";
import { AdminSchema } from "../../schemas/admin.schema.js";
import {
    CANONICAL_BITS_EVENT_TYPE,
    canonicalizeEventsubType,
    getEquivalentEventsubTypes,
    subscribeTwitchEvent,
    unsubscribeTwitchEvent
} from "../../utils/eventsub.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import type { ICheerTiers } from "../../schemas/eventsub.schema.js";

const router = express.Router();
const NON_DISABLEABLE_EVENT_TYPES = new Set(['stream.online', 'stream.offline']);

interface EventsubRequest extends Request {
    user?: {
        id?: string;
    };
}

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

async function getAccess(requesterID: string, channelID: string): Promise<'owner' | 'admin' | 'none'> {
    if (requesterID === channelID) {
        return 'owner';
    }

    const admin = await AdminSchema.findOne({
        channelID,
        adminID: requesterID,
        actived: true,
        permissions: { $in: ['*', 'dashboard:view', 'settings:view'] }
    }).lean();

    return admin ? 'admin' : 'none';
}

function normalizeCheerTiers(value: unknown): ICheerTiers[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const normalized = value
        .map((tier) => {
            if (!tier || typeof tier !== 'object') {
                return null;
            }

            const candidate = tier as {
                id?: unknown;
                name?: unknown;
                message?: unknown;
                minAmount?: unknown;
                maxAmount?: unknown;
                min_amount?: unknown;
                max_amount?: unknown;
            };

            const minAmount = typeof candidate.min_amount === 'number'
                ? candidate.min_amount
                : candidate.minAmount;
            const maxAmount = typeof candidate.max_amount === 'number'
                ? candidate.max_amount
                : candidate.maxAmount;

            if (
                typeof candidate.id !== 'string'
                || typeof candidate.name !== 'string'
                || typeof candidate.message !== 'string'
                || typeof minAmount !== 'number'
                || !Number.isFinite(minAmount)
                || typeof maxAmount !== 'number'
                || !Number.isFinite(maxAmount)
            ) {
                return null;
            }

            return {
                id: candidate.id,
                name: candidate.name,
                message: candidate.message,
                min_amount: minAmount,
                max_amount: maxAmount
            } satisfies ICheerTiers;
        })
        .filter((tier): tier is ICheerTiers => tier !== null);

    return normalized;
}

function normalizeEventsubPayload<T extends Record<string, unknown>>(payload: T): T {
    const normalizedPayload: Record<string, unknown> = { ...payload };

    if (typeof normalizedPayload.type === 'string') {
        normalizedPayload.type = canonicalizeEventsubType(normalizedPayload.type);
    }

    const cheerTiers = normalizeCheerTiers(normalizedPayload.cheerTiers);
    if (cheerTiers) {
        normalizedPayload.cheerTiers = cheerTiers;
    }

    const config = normalizedPayload.config;
    if (config && typeof config === 'object' && !Array.isArray(config)) {
        const normalizedConfig: Record<string, unknown> = { ...(config as Record<string, unknown>) };
        const configCheerTiers = normalizeCheerTiers(normalizedConfig.cheerTiers);

        if (configCheerTiers) {
            normalizedConfig.cheerTiers = configCheerTiers;
        }

        normalizedPayload.config = normalizedConfig;
    }

    return normalizedPayload as T;
}

async function findEventTemplateByType(type: string) {
    const normalizedType = canonicalizeEventsubType(type);

    const templates = await EventSchema.find(
        { type: { $in: getEquivalentEventsubTypes(normalizedType) } },
        { plan_tier: 1, tierLimits: 1, type: 1 }
    ).lean() as Array<{
        type?: string;
        plan_tier?: PlanTier;
        tierLimits?: { free?: number; premium?: number; pro?: number };
    }>;

    return templates.find((template) => template.type === normalizedType)
        || templates[0]
        || null;
}

function normalizeEventsubResponseType<T extends { type?: string }>(eventsub: T): T {
    if (typeof eventsub.type !== 'string') {
        return eventsub;
    }

    return {
        ...eventsub,
        type: canonicalizeEventsubType(eventsub.type)
    };
}

function getEventsubConfigRichness(eventsub: Record<string, unknown>): number {
    let score = 0;

    if (eventsub.enabled === false) score += 3;
    if (typeof eventsub.message === 'string' && eventsub.message.trim().length > 0) score += 3;
    if (typeof eventsub.endMessage === 'string' && eventsub.endMessage.trim().length > 0) score += 2;
    if (eventsub.endEnabled === true) score += 1;
    if (eventsub.clipEnabled === true) score += 1;
    if (typeof eventsub.minViewers === 'number' && Number.isFinite(eventsub.minViewers) && eventsub.minViewers !== 2) score += 2;
    if (typeof eventsub.delay === 'number' && Number.isFinite(eventsub.delay) && eventsub.delay !== 0) score += 2;
    if (Array.isArray(eventsub.cheerTiers) && eventsub.cheerTiers.length > 0) score += 4;

    return score;
}

function choosePreferredEventsub<T extends { type?: string } & Record<string, unknown>>(current: T | undefined, candidate: T): T {
    if (!current) {
        return candidate;
    }

    const currentType = typeof current.type === 'string' ? current.type : '';
    const candidateType = typeof candidate.type === 'string' ? candidate.type : '';
    const currentCanonicalType = canonicalizeEventsubType(currentType);
    const candidateCanonicalType = canonicalizeEventsubType(candidateType);

    if (currentCanonicalType === CANONICAL_BITS_EVENT_TYPE && candidateCanonicalType === CANONICAL_BITS_EVENT_TYPE) {
        if (candidateType === CANONICAL_BITS_EVENT_TYPE && currentType !== CANONICAL_BITS_EVENT_TYPE) {
            return candidate;
        }

        if (currentType === CANONICAL_BITS_EVENT_TYPE && candidateType !== CANONICAL_BITS_EVENT_TYPE) {
            return current;
        }
    }

    const currentScore = getEventsubConfigRichness(current);
    const candidateScore = getEventsubConfigRichness(candidate);

    if (candidateScore !== currentScore) {
        return candidateScore > currentScore ? candidate : current;
    }

    return candidateType === candidateCanonicalType && currentType !== currentCanonicalType
        ? candidate
        : current;
}

function dedupeNormalizedEventsubs<T extends { type?: string; channelID?: string }>(eventsubs: T[]): T[] {
    const byKey = new Map<string, T>();

    for (const eventsub of eventsubs) {
        const key = `${eventsub.channelID || ''}:${canonicalizeEventsubType(typeof eventsub.type === 'string' ? eventsub.type : '')}`;
        byKey.set(key, choosePreferredEventsub(byKey.get(key), eventsub));
    }

    return Array.from(byKey.values()).map(normalizeEventsubResponseType);
}

router.get('/:channelID', authMiddleware as any, async (req: EventsubRequest, res: Response) => {
        try {
            const { channelID } = req.params;
            const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
            const requesterID = req.user?.id;
            const query = req.query;
            const type = query.type as string | null;
            const id = query.id as string | null;

            if (!requesterID) {
                return res.status(401).json({
                    error: true,
                    message: 'Unauthorized',
                    status: 401
                });
            }

            const access = await getAccess(requesterID, channelIdStr);
            if (access === 'none') {
                return res.status(403).json({
                    error: true,
                    message: 'You do not have permission to view eventsubs for this channel',
                    status: 403
                });
            }

            let eventsub;

            if (id) {
                if (!mongoose.isValidObjectId(id)) {
                    return res.status(400).send({
                        error: 'Invalid ID',
                        message: 'ID is not a valid ObjectID',
                        status: 400
                    });
                }
                eventsub = await EventsubSchema.find({ channelID: channelIdStr, _id: id }).lean();
            } else if (type) {
                eventsub = await EventsubSchema.find({
                    channelID: channelIdStr,
                    type: { $in: getEquivalentEventsubTypes(type) }
                }).lean();
            } else {
                eventsub = await EventsubSchema.find({ channelID: channelIdStr }).lean();
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
                data: id ? eventsub.map(normalizeEventsubResponseType) : dedupeNormalizedEventsubs(eventsub),
                total: id ? eventsub.length : dedupeNormalizedEventsubs(eventsub).length
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

    router.post('/:channelID', authMiddleware as any, async (req: EventsubRequest, res: Response) => {
        try {
            const { channelID } = req.params;
            const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
            const requesterID = req.user?.id;
            const body = normalizeEventsubPayload(req.body as Record<string, unknown>);
            const type = body.type as string;
            const version = body.version as string;
            const condition = body.condition;
            const config = body.config as Record<string, unknown> | undefined;

            if (!requesterID) {
                return res.status(401).json({
                    error: true,
                    message: 'Unauthorized',
                    status: 401
                });
            }

            const access = await getAccess(requesterID, channelIdStr);
            if (access === 'none') {
                return res.status(403).json({
                    error: true,
                    message: 'You do not have permission to manage eventsubs for this channel',
                    status: 403
                });
            }

            if (!type || !version || !condition) {
                return res.status(400).send({
                    error: 'Bad Request',
                    message: 'Missing type, version or condition',
                    status: 400
                });
            }

            const normalizedType = canonicalizeEventsubType(type);

            const userPlan = await getUserPlanTier(channelIdStr);

            const eventTemplate = await findEventTemplateByType(normalizedType);

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

            const eventsub = await subscribeTwitchEvent(channelIdStr, normalizedType, version, condition, config);

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

router.delete('/:channelID/:id', authMiddleware as any, async (req: EventsubRequest, res: Response) => {
        try {
            const { channelID, id } = req.params;
            const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
            const idStr = Array.isArray(id) ? id[0] : id;
            const requesterID = req.user?.id;

            if (!requesterID) {
                return res.status(401).json({
                    error: true,
                    message: 'Unauthorized',
                    status: 401
                });
            }

            const access = await getAccess(requesterID, channelIdStr);
            if (access === 'none') {
                return res.status(403).json({
                    error: true,
                    message: 'You do not have permission to manage eventsubs for this channel',
                    status: 403
                });
            }

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

router.patch('/:channelID/:id', authMiddleware as any, async (req: EventsubRequest, res: Response) => {
        try {
            const { channelID, id } = req.params;
            const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
            const idStr = Array.isArray(id) ? id[0] : id;
            const requesterID = req.user?.id;
            const body = normalizeEventsubPayload(req.body as Record<string, unknown>);

            if (!requesterID) {
                return res.status(401).json({
                    error: true,
                    message: 'Unauthorized',
                    status: 401
                });
            }

            const access = await getAccess(requesterID, channelIdStr);
            if (access === 'none') {
                return res.status(403).json({
                    error: true,
                    message: 'You do not have permission to manage eventsubs for this channel',
                    status: 403
                });
            }

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
                Object.prototype.hasOwnProperty.call(body, 'enabled') &&
                body.enabled === false
            ) {
                return res.status(403).send({
                    error: true,
                    message: 'This event cannot be disabled. Clear its message to silence chat output.',
                    status: 403
                });
            }

            const userPlan = await getUserPlanTier(channelIdStr);
            const eventTemplate = await findEventTemplateByType(eventsub.type);

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

            const cheerTiers = extractCheerTiers(undefined, body);
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
                body,
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
