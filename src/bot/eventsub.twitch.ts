import crypto from 'crypto';
import express from 'express';
import { eventsubHandler } from '../handlers/eventsub.handler.js';
import { revocationHandler } from '../handlers/revocation.handler.js';
import type { ITwitchEventData, ITwitchSubscriptionData } from '../interfaces/twitch/eventsub.interface.js';
import { getDragonflyClient } from '../utils/databases/dragonfly.database.js';
import { endEventsubHandlerMetric, observeEventsubNotification, startEventsubHandlerMetric } from '../utils/observability/bot_runtime_metrics.js';

const EVENTSUB_MESSAGE_DEDUPE_TTL_SECONDS = Math.max(300, Number(process.env.TWITCH_EVENTSUB_MESSAGE_TTL_SECONDS || 600));

export const twitchEventsub = () => {
    const app = express();
    const port = 3333;

    const TWITCH_MESSAGE_ID = 'Twitch-Eventsub-Message-Id'.toLocaleLowerCase();
    const TWITCH_MESSAGE_TIMESTAMP = 'Twitch-Eventsub-Message-Timestamp'.toLocaleLowerCase();
    const TWITCH_MESSAGE_SIGNATURE = 'Twitch-Eventsub-Message-Signature'.toLocaleLowerCase();
    const MESSAGE_TYPE = 'Twitch-Eventsub-Message-Type'.toLocaleLowerCase();

    //? Notification message types
    const MESSAGE_TYPE_VERIFICATION = 'webhook_callback_verification';
    const MESSAGE_TYPE_NOTIFICATION = 'notification';
    const MESSAGE_TYPE_REVOCATION = 'revocation';

    //? Prepend this string to the HMAC that's created from the message
    const HMAC_PREFIX = 'sha256=';
    const HMAC_DIGEST = 'hex';

    app.use(express.raw({ type: 'application/json' }));

    async function claimEventsubMessage(messageId: string): Promise<boolean> {
        if (!messageId) {
            return true;
        }

        try {
            const cache = await getDragonflyClient('TwitchEventsubWebhook');
            const dedupeKey = `twitch:eventsub:message:${messageId}`;
            const result = await cache.set(dedupeKey, new Date().toISOString(), {
                NX: true,
                EX: EVENTSUB_MESSAGE_DEDUPE_TTL_SECONDS
            });

            return result === 'OK';
        } catch (error) {
            console.error('Failed to claim EventSub message dedupe key:', {
                messageId,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString()
            });

            return true;
        }
    }

    app.post('/eventsub', async (req, res) => {
        let secret = getSecret();
        let message = getHmacMessage(req);
        let hmac = HMAC_PREFIX + getHmac(secret, message);

        if (true === verifyMessage(hmac, req.headers[TWITCH_MESSAGE_SIGNATURE])) {
            // console.log('Message verified');

            //GET JSON object from body
            let notification = JSON.parse(req.body.toString('utf8'));
            const eventType = String(notification?.subscription?.type || 'unknown');
            const messageId = String(req.headers[TWITCH_MESSAGE_ID] || '');
            const payloadBytes = Buffer.isBuffer(req.body)
                ? req.body.length
                : Buffer.byteLength(String(req.body || ''));
            observeEventsubNotification(eventType, payloadBytes);

            if (MESSAGE_TYPE_NOTIFICATION === req.headers[MESSAGE_TYPE]) {
                const claimed = await claimEventsubMessage(messageId);
                if (!claimed) {
                    res.sendStatus(204);
                    return;
                }

                const tracker = startEventsubHandlerMetric(eventType);
                res.sendStatus(204);
                void eventsubHandler(notification.subscription as ITwitchSubscriptionData, notification.event as ITwitchEventData)
                    .then(() => {
                        endEventsubHandlerMetric(tracker, false);
                    })
                    .catch((handlerError) => {
                        endEventsubHandlerMetric(tracker, true);
                        console.error('Error handling EventSub notification:', {
                            eventType,
                            messageId,
                            error: handlerError instanceof Error ? handlerError.message : String(handlerError),
                            stack: handlerError instanceof Error ? handlerError.stack : undefined,
                            timestamp: new Date().toISOString()
                        });
                    });
            } else if (MESSAGE_TYPE_VERIFICATION === req.headers[MESSAGE_TYPE]) {
                res.set('Content-Type', 'text/plain').status(200).send(notification.challenge);
            } else if (MESSAGE_TYPE_REVOCATION === req.headers[MESSAGE_TYPE]) {
                res.sendStatus(204);
                void Promise.resolve(revocationHandler(notification.subscription as ITwitchSubscriptionData)).catch((handlerError) => {
                    console.error('Error handling EventSub revocation:', {
                        error: handlerError instanceof Error ? handlerError.message : String(handlerError),
                        stack: handlerError instanceof Error ? handlerError.stack : undefined,
                        timestamp: new Date().toISOString()
                    });
                });
            } else {
                res.sendStatus(204);
                console.log(`Unkonwn message type: ${req.headers[MESSAGE_TYPE]}`)
            }
        } else {
            console.log('Message verification failed');
            console.log('403 Forbidden')
            res.sendStatus(403);
        }

    })

    app.listen(port, () => {
        console.log(`App listening on port ${port}`)
    });
    function getSecret() {
        return process.env.TWITCH_EVENTSUB_SECRET;
    }

    function getHmacMessage(req: any) {
        return (req.headers[TWITCH_MESSAGE_ID] + req.headers[TWITCH_MESSAGE_TIMESTAMP] + req.body);
    }

    function getHmac(secret: any, message: any) {
        return crypto.createHmac('sha256', secret).update(message).digest(HMAC_DIGEST);
    }

    function verifyMessage(hmac: any, verifySignature: any) {
        return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(verifySignature));
    }
}
