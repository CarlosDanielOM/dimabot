import crypto from 'crypto';
import express from 'express';
import { eventsubHandler } from '../handlers/eventsub.handler.js';
import type { ITwitchEventData, ITwitchSubscriptionData } from '../interfaces/twitch/eventsub.interface.js';

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

    app.post('/eventsub', (req, res) => {
        let secret = getSecret();
        let message = getHmacMessage(req);
        let hmac = HMAC_PREFIX + getHmac(secret, message);

        if (true === verifyMessage(hmac, req.headers[TWITCH_MESSAGE_SIGNATURE])) {
            // console.log('Message verified');

            //GET JSON object from body
            let notification = JSON.parse(req.body);

            if (MESSAGE_TYPE_NOTIFICATION === req.headers[MESSAGE_TYPE]) {
                //* TODO: Add eventsub handler
                eventsubHandler(notification.subscription as ITwitchSubscriptionData, notification.event as ITwitchEventData);

                res.sendStatus(204);
            } else if (MESSAGE_TYPE_VERIFICATION === req.headers[MESSAGE_TYPE]) {
                res.set('Content-Type', 'text/plain').status(200).send(notification.challenge);
            } else if (MESSAGE_TYPE_REVOCATION === req.headers[MESSAGE_TYPE]) {
                res.sendStatus(204);

                console.log(`condition: ${JSON.stringify(notification, null, 4)}`);
                //* TODO: Add eventsub revocation handler
                // eventsubRevocationHandler(notification.subscription);

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