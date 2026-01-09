const express = require('express');
const { validateEvent, WebhookVerificationError } = require('@polar-sh/sdk/webhooks.js');
const router = express.Router();

router.post("/webhook", express.raw({ type: 'application/json' }), (req, res) => {
    try {
        let event = validateEvent(req.body, req.headers, process.env.POLARSH_WEBHOOK_SECRET);

        console.log(event);

        //? Process event

        res.status(202).send('');
        
    }
    catch(error) {
        if(error instanceof WebhookVerificationError) {
            res.status(403).send('');
        } else {
            res.status(500).send({
                error: true,
                message: 'Internal server error',
                status: 500
            });
        }
    }
});

module.exports = router;