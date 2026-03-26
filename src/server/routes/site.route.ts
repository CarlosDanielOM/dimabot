import express, { type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { EventSchema, type IEvent } from '../../schemas/event.schema.js';
import { getDragonflyClient } from '../../utils/databases/dragonfly.database.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { error } from '../../utils/logger.js';
import { canonicalizeEventsubType, getEquivalentEventsubTypes } from '../../utils/eventsub.js';

const router = express.Router();

function normalizeEventType<T extends { type?: string }>(event: T): T {
    if (typeof event.type !== 'string') {
        return event;
    }

    return {
        ...event,
        type: canonicalizeEventsubType(event.type)
    };
}

function choosePreferredEvent<T extends { type?: string }>(current: T | undefined, candidate: T): T {
    if (!current) {
        return candidate;
    }

    const currentType = typeof current.type === 'string' ? current.type : '';
    const candidateType = typeof candidate.type === 'string' ? candidate.type : '';

    return candidateType === canonicalizeEventsubType(candidateType) && currentType !== canonicalizeEventsubType(currentType)
        ? candidate
        : current;
}

function dedupeEvents<T extends { type?: string }>(events: T[]): T[] {
    const byType = new Map<string, T>();

    for (const event of events) {
        const key = canonicalizeEventsubType(typeof event.type === 'string' ? event.type : '');
        byType.set(key, choosePreferredEvent(byType.get(key), event));
    }

    return Array.from(byType.values()).map(normalizeEventType);
}

router.get('/', authMiddleware as any, async (req: Request, res: Response) => {
    try {
        const cacheClient = await getDragonflyClient();
        return res.status(200).json({});
    } catch (err) {
        await error({
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

        res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.post('/events', authMiddleware as any, async (req: Request, res: Response) => {
    try {
        const eventData = req.body;
        const eventType = canonicalizeEventsubType(eventData.type);
        eventData.type = eventType;

        const requiredFields: Array<string> = [
            'name',
            'type',
            'icon',
            'color',
            'textColor',
            'description',
            'config',
            'plan_tier'
        ];
        for (const field of requiredFields) {
            if (!eventData[field]) {
                return res.status(400).json({
                    error: true,
                    message: `Missing required field: ${field}`,
                    status: 400
                });
            }
        }

        if (!eventData.description.EN || !eventData.description.ES) {
            return res.status(400).json({
                error: true,
                message: 'Description must include both EN and ES translations',
                status: 400
            });
        }

        if (!Array.isArray(eventData.config) || eventData.config.length === 0) {
            return res.status(400).json({
                error: true,
                message: 'Config must be a non-empty array',
                status: 400
            });
        }

        if (!['free', 'premium', 'pro'].includes(eventData.plan_tier)) {
            return res.status(400).json({
                error: true,
                message: 'plan_tier must be one of: free, premium, pro',
                status: 400
            });
        }

        for (const configItem of eventData.config) {
            if (!configItem.id || !configItem.label || !configItem.type || configItem.value === undefined) {
                return res.status(400).json({
                    error: true,
                    message: 'Each config item must have id, label, type, and value',
                    status: 400
                });
            }

            if (!configItem.label.EN || !configItem.label.ES) {
                return res.status(400).json({
                    error: true,
                    message: 'Each config label must include both EN and ES translations',
                    status: 400
                });
            }
        }

        const existingEvent = await EventSchema.findOne({ type: { $in: getEquivalentEventsubTypes(eventType) } });
        if (existingEvent) {
            return res.status(409).json({
                error: true,
                message: `Event with type '${eventType}' already exists`,
                status: 409
            });
        }

        const newEvent = new EventSchema(eventData);
        const savedEvent = await newEvent.save();

        return res.status(201).json({
            error: false,
            message: 'Event created successfully',
            data: normalizeEventType(savedEvent.toObject())
        });
    } catch (err) {
        await error({
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            body: req.body,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

        res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.get('/events', authMiddleware as any, async (req: Request, res: Response) => {
    try {
        const events = await EventSchema.find().sort({ createdAt: -1 }).lean();

        return res.status(200).json({
            error: false,
            data: dedupeEvents(events)
        });
    } catch (err) {
        await error({
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

        res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.get('/events/:type', authMiddleware as any, async (req: Request, res: Response) => {
    try {
        const { type } = req.params;
        const typeStr = canonicalizeEventsubType(Array.isArray(type) ? type[0] : type);
        const events = await EventSchema.find({ type: { $in: getEquivalentEventsubTypes(typeStr) } }).lean();
        const event = events.find((candidate) => candidate.type === typeStr) || events[0];

        if (!event) {
            return res.status(404).json({
                error: true,
                message: 'Event not found',
                status: 404
            });
        }

        return res.status(200).json({
            error: false,
            data: normalizeEventType(event)
        });
    } catch (err) {
        await error({
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            type: req.params.type,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

        res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.patch('/events/:id', authMiddleware as any, async (req: Request, res: Response) => {
    let event;
    try {
        const { id } = req.params;
        const idStr = Array.isArray(id) ? id[0] : id;
        const body = { ...req.body } as Record<string, unknown>;

        if (typeof body.type === 'string') {
            body.type = canonicalizeEventsubType(body.type);
        }

        if (!mongoose.Types.ObjectId.isValid(idStr)) {
            return res.status(400).json({
                error: true,
                message: 'Invalid ID',
                status: 400
            });
        }

        event = await EventSchema.findByIdAndUpdate(idStr, body, { new: true }).lean();

        if (!event) {
            return res.status(404).json({
                error: true,
                message: 'Event not found',
                status: 404
            });
        }

        return res.status(200).json({
            error: false,
            message: 'Event updated successfully',
            data: normalizeEventType(event)
        });
    } catch (err) {
        await error({
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            id: req.params.id,
            body: req.body,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

        if (err instanceof Error && err.name === 'CastError') {
            return res.status(400).json({
                error: true,
                message: 'Invalid ID',
                status: 400
            });
        }

        res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

export const siteRoute = router;
