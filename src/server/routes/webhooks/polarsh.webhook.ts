import express, { type Request, type Response } from 'express';
import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks.js';
import { handlePolarSHEvent } from '../../../handlers/polarsh.handler.js';

const router = express.Router();

router.post("/", express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
    try {
        const secret = process.env.POLARSH_WEBHOOK_SECRET;
        if (!secret) {
            return res.status(500).json({
                error: true,
                message: 'POLARSH_WEBHOOK_SECRET not configured',
                status: 500
            });
        }

        const normalizedHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.headers)) {
            if (Array.isArray(value)) {
                normalizedHeaders[key] = value.join(',');
                continue;
            }

            if (typeof value === 'string') {
                normalizedHeaders[key] = value;
            }
        }

        const event = validateEvent(req.body, normalizedHeaders, secret);

        await handlePolarSHEvent(event);

        return res.status(202).send('');

    } catch (error) {
        console.error('PolarSH webhook error:', error);

        if (error instanceof WebhookVerificationError) {
            return res.status(403).send('');
        }
 
        return res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

export const polarshWebhook = router;
