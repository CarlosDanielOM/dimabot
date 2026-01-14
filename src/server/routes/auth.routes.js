require('dotenv').config();
const express = require('express');
const router = express.Router();

const channelSchema = require('../../../schema/channel');
const commandSchema = require('../../../schema/command');

const STREAMERS = require('../../../class/streamer');
const CHANNEL = require('../../../function/channel');

const logger = require('../../../util/logger');
const { encrypt, decrypt } = require('../../../util/crypto');
const {connectChannel} = require('../../../util/client');
const {subcriptionsTypes, subscribeTwitchEvent} = require('../../../util/eventsub')
const JSONCOMMANDS = require('../../../config/reservedcommands.json')
const { incrementSiteAnalytics } = require('../../../util/siteanalytics');

const auth = require("../../../middleware/auth");
const { ingestPolarSHEvent } = require('../../../util/polarsh');

router.get('/register', async (req, res) => {
    const token = req.query.code;
    const username = req.query.state;

    let updatedChannel = null;

    if(!token || !username) return res.status(400).send('Missing token or username');

    let params = new URLSearchParams();
    params.append('client_id', process.env.CLIENT_ID);
    params.append('client_secret', process.env.CLIENT_SECRET);
    params.append('code', token);
    params.append('grant_type', 'authorization_code');
    params.append('redirect_uri', `https://domdimabot.com/login`);

    let response = await fetch(`https://id.twitch.tv/oauth2/token?${params}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });

    let data = await response.json();

    if(data.error) {
        logger(data, true, username, 'auth_token');
        return res.status(400).send(data.error);
    }

    const { access_token, refresh_token, token_type, expires_in, scope, id_token } = data;

    const encryptedToken = encrypt(access_token);
    const encryptedRefreshToken = encrypt(refresh_token);

    try {

        let dataToUpdate = {
            twitch_user_token: encryptedToken,
            twitch_user_refresh_token: encryptedRefreshToken,
            twitch_user_token_id: id_token,
            actived: true,
            chat_enabled: true,
            up_to_date_twitch_permissions: true,
        }

        updatedChannel = await channelSchema.findOneAndUpdate({name: username}, dataToUpdate);

        if (updatedChannel && !updatedChannel.actived && updatedChannel.polar_sh_customer_id) {
            const ingestResult = await ingestPolarSHEvent({
                customerId: updatedChannel.polar_sh_customer_id,
                cost: -25,
                reason: 'Free benefits',
                mode: 'immediate'
            });

            if(ingestResult.error) {
                logger(ingestResult, true, updatedChannel.twitch_user_id, 'auth_polarsh_ingest');
            }
        }

        await STREAMERS.updateStreamers();
        let streamer = await STREAMERS.getStreamerByName(username);

        let addedModerator = await CHANNEL.addModerator(streamer.user_id);

        if(addedModerator.error) {
            if(addedModerator.message == 'user is already a mod') {
                console.log({error: addedModerator});
            } else {
                logger(addedModerator, true, streamer.user_id, 'auth_moderator');
                return res.status(addedModerator.status).send(addedModerator);
            }
        }

        let eventDataSubscriptions = subcriptionsTypes

        //? Subscribe to all event subscriptions
        for(const subscription of eventDataSubscriptions) {
            if(subscription.type == 'channel.raid') {
                subscription.condition.to_broadcaster_user_id = streamer.user_id;
            } else {
                subscription.condition.broadcaster_user_id = streamer.user_id;
            }

            let response = await subscribeTwitchEvent(streamer.user_id, subscription.type, subscription.version, subscription.condition);

            if(response.error) {
                logger(response, true, streamer.user_id, 'auth_event_sub');
            }
        }

        let jsonCommands = JSONCOMMANDS.commands;

        //? Add all reserved commands to the channel
        for(const command in jsonCommands) {
            let commandExists = await commandSchema.exists({func: jsonCommands[command].func, channelID: streamer.user_id});

            if(commandExists) {
                console.log(`Command ${command} already exists in ${streamer.user_id}`);
                continue;
            }

            let newCommand = new commandSchema({
                name: jsonCommands[command].name,
                cmd: jsonCommands[command].cmd,
                func: jsonCommands[command].func,
                type: jsonCommands[command].type,
                channel: updatedChannel.name,
                channelID: updatedChannel.twitch_user_id,
                cooldown: jsonCommands[command].cooldown,
                enabled: jsonCommands[command].enabled,
                userLevel: jsonCommands[command].userLevel,
                userLevelName: jsonCommands[command].userLevelName,
                reserved: jsonCommands[command].reserved,
            });

            try {
                await newCommand.save();
            } catch (error) {
                logger(error, true, streamer.user_id, 'auth_command');
                return res.status(500).send('Internal server error');
            }
        }

        await connectChannel(streamer.name);

        // Increment active channels count when account is activated
        await incrementSiteAnalytics('active', 1);

        // Return the login.html file (local development)
        // return res.status(200).sendFile(path.join(__dirname, '../../../routes/public/login.html'));

        // Redirect to the login page on the production domain (production environment)
        return res.redirect(`https://domdimabot.com/login`);

    } catch (error) {
        logger(error, true, username, 'auth');
        return res.status(500).send('Internal server error');
    }

});

router.get('/reauthenticate', async (req, res) => {
    const token = req.query.code;
    const username = req.query.state;

    if(!token || !username) return res.status(400).send('Missing token or username');

    let params = new URLSearchParams();
    params.append('client_id', process.env.CLIENT_ID);
    params.append('client_secret', process.env.CLIENT_SECRET);
    params.append('code', token);
    params.append('grant_type', 'authorization_code');
    params.append('redirect_uri', `https://domdimabot.com/login`);

    let response = await fetch(`https://id.twitch.tv/oauth2/token?${params}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });

    let data = await response.json();

    if(data.error) {
        logger(data, true, username, 'auth_token_reauth');
        return res.status(400).send(data.error);
    }

    const { access_token, refresh_token, id_token } = data;

    const encryptedToken = encrypt(access_token);
    const encryptedRefreshToken = encrypt(refresh_token);

    try {
        await channelSchema.findOneAndUpdate({name: username}, {
            twitch_user_token: encryptedToken,
            twitch_user_refresh_token: encryptedRefreshToken,
            twitch_user_token_id: id_token,
            actived: true,
            up_to_date_twitch_permissions: true,
        });

        await STREAMERS.updateStreamers();
        let streamer = await STREAMERS.getStreamerByName(username);

        if (streamer) {
            await connectChannel(streamer.name);
        }

        return res.redirect(`https://domdimabot.com/login`);

    } catch (error) {
        logger(error, true, username, 'reauth');
        return res.status(500).send('Internal server error');
    }

});

router.post('/login', auth, async (req, res) => {
    const {name, id, email} = req.body;

    if(!id) return res.status(400).send({error: true, message: 'Missing id'});

    if(id == '1104868478') {
        return res.status(200).send({
            error: true,
            message: 'You are not allowed to login with this account',
            status: 403,
            type: 'error'
        });
    }

    let exists = await channelSchema.findOne({ twitch_user_id: id });

    if(exists) {
        //? Return user information without sensitive data
        return res.status(200).send({
            error: false,
            message: 'User already exists',
            data: {
                name: exists.name,
                email: exists.email,
                type: exists.type,
                premium: exists.premium,
                premium_plus: exists.premium_plus,
                premium_until: exists.premium_until,
                actived: exists.actived,
                chat_enabled: exists.chat_enabled,
                twitch_user_id: exists.twitch_user_id,
                up_to_date_twitch_permissions: exists.up_to_date_twitch_permissions,
            }
        });
    } else {
        if(!name || !email) return res.status(400).send({error: true, message: 'Missing name or email'});

        let newChannel = new channelSchema({
            name: name,
            email: email,
            twitch_user_id: id,
            type: 'twitch',
            premium: false,
            premium_plus: false,
            premium_until: null,
            actived: false,
            chat_enabled: false,
            up_to_date_twitch_permissions: true,
        });

        try {
            let polarshClient = getPolarShClient();

            let customer = await polarshClient.customers.create({
                email: newChannel.email,
                externalId: newChannel._id.toString(),
                name: newChannel.name,
                billingAddress: {
                    country: 'US'
                },
                metadata: {
                    twitch_user_id: newChannel.twitch_user_id,
                    twitch_user_name: newChannel.name
                }
            });

            newChannel.polar_sh_customer_id = customer.id;


            await newChannel.save();
            // Increment registered channels count
            await incrementSiteAnalytics('registered', 1);
        } catch (error) {
            logger(error, true, id, 'auth_channel');
            return res.status(500).send('Internal server error');
        }
        
        //? Return user information without sensitive data
        return res.status(201).send({
            error: false,
            message: 'User created',
            data: {
                name: newChannel.name,
                email: newChannel.email,
                type: newChannel.type,
                premium: newChannel.premium,
                premium_plus: newChannel.premium_plus,
                premium_until: newChannel.premium_until,
                actived: newChannel.actived,
                chat_enabled: newChannel.chat_enabled,
                twitch_user_id: newChannel.twitch_user_id,
                up_to_date_twitch_permissions: newChannel.up_to_date_twitch_permissions,
            }
        });
    }
})



module.exports = router;