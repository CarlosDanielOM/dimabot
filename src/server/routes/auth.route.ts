import express, { type Request, type Response } from "express";
import { getDirname } from "../../utils/pollyfills.js";
import UsersSchema, { type IUsers } from "../../schemas/users.schema.js";
import { CommandsSchema } from "../../schemas/commands.schema.js";
import TwitchStreamers from "../../classes/twitch_streamers.class.js";
import { addModerator } from "../../functions/channels/add_moderator.channel.js";
import { encrypt } from "../../utils/crypto.js";
import { SUBSCRIPTION_TYPES, subscribeTwitchEvent } from "../../utils/eventsub.js";
import JSONCOMMANDS from "../../config/commands/reservedcommands.json" with { type: 'json' };
import { incrementSiteAnalytics } from "../../utils/siteanalytics.js";
import { ingestPolarSHEvent, getPolarShClient } from "../../utils/polarsh.js";
import EventsubSchema from "../../schemas/eventsub.schema.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import type { AuthRequest } from "../../middleware/types.js";

const __dirname = getDirname(import.meta.url);

interface OAuthCallbackRequest {
    code?: string;
    state?: string;
}

interface LoginRequestBody {
    name?: string;
    id?: string;
    email?: string;
}

interface StandardResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    data?: any;
}

async function createReservedCommands(channelID: string, channelName: string): Promise<void> {
    const commands = JSONCOMMANDS.commands;

    for (const command in commands) {
        const commandData = commands[command];

        const exists = await CommandsSchema.exists({
            func: commandData.func,
            channelID: channelID
        });

        if (exists) {
            console.log(`Command ${command} already exists in ${channelID}`);
            continue;
        }

        const newCommand = new CommandsSchema({
            name: commandData.name,
            cmd: commandData.cmd,
            func: commandData.func,
            type: commandData.type,
            channel: channelName,
            channelID: channelID,
            cooldown: commandData.cooldown,
            enabled: commandData.enabled,
            userLevel: commandData.userLevel || 0,
            userLevelName: commandData.userLevelName || 'everyone',
            reserved: commandData.reserved,
            message: '',
            responses: [],
            paused: false,
            platform: 'twitch',
            premiumRequired: false,
            premiumLevelRequired: 0,
            createdAt: new Date()
        });

        await newCommand.save();
    }
}

async function subscribeAllEventSubs(channelID: string): Promise<void> {
    for (const subscription of SUBSCRIPTION_TYPES) {
        const condition = { ...subscription.condition };
        
        if (subscription.type === 'channel.raid') {
            condition.to_broadcaster_user_id = channelID;
        } else {
            condition.broadcaster_user_id = channelID;
        }

        const response = await subscribeTwitchEvent(
            channelID,
            subscription.type,
            subscription.version,
            condition,
            subscription.config
        );

        if (response.error) {
            console.error(`Failed to subscribe to ${subscription.type}:`, response);
        }
    }
}

async function getUserByTwitchID(twitchID: string): Promise<IUsers | null> {
    return await UsersSchema.findOne({
        'accounts.id': twitchID,
        'accounts.type': 'twitch'
    });
}

async function getUserByUsername(username: string): Promise<IUsers | null> {
    return await UsersSchema.findOne({
        'accounts.name': username,
        'accounts.type': 'twitch'
    });
}

async function exchangeOAuthCode(code: string): Promise<{ access_token: string; refresh_token: string; id_token: string; error?: string }> {
    const params = new URLSearchParams({
        client_id: process.env.CLIENT_ID!,
        client_secret: process.env.CLIENT_SECRET!,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: `https://domdimabot.com/login`
    });

    const response = await fetch(`https://id.twitch.tv/oauth2/token?${params}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });

    const data = await response.json();

    if (data.error) {
        return { access_token: '', refresh_token: '', id_token: '', error: data.error };
    }

    return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        id_token: data.id_token
    };
}

async function updateUserDataTokens(userId: string, accessToken: string, refreshToken: string, idToken: string, activate: boolean = false): Promise<IUsers | null> {
    const encryptedToken = encrypt(accessToken);
    const encryptedRefreshToken = encrypt(refreshToken);

    const updateData: any = {
        'accounts.$.access_token': encryptedToken,
        'accounts.$.refresh_token': encryptedRefreshToken,
        'accounts.$.id': idToken
    };

    if (activate) {
        updateData['accounts.$.actived'] = true;
        updateData['accounts.$.chat_enabled'] = true;
        updateData['accounts.$.up_to_date_permissions'] = true;
    }

    return await UsersSchema.findOneAndUpdate(
        { _id: userId },
        { $set: updateData },
        { new: true }
    );
}

export const authRoute = (app: express.Application): void => {

    app.get('/auth/register', async (req: Request<{}, {}, {}, OAuthCallbackRequest>, res: Response) => {
        const token = req.query.code;
        const username = req.query.state;

        if (!token || !username) {
            return res.status(400).send('Missing token or username');
        }

        try {
            const oauthResult = await exchangeOAuthCode(token);

            if (oauthResult.error) {
                console.error('OAuth token exchange error:', oauthResult.error, username);
                return res.status(400).send(oauthResult.error);
            }

            const { access_token, refresh_token, id_token } = oauthResult;

            const user = await getUserByUsername(username);

            if (!user) {
                console.error('User not found:', username);
                return res.status(404).send('User not found');
            }

            const twitchAccountIndex = user.accounts.findIndex(acc => acc.type === 'twitch');
            if (twitchAccountIndex === -1) {
                console.error('Twitch account not found for user:', username);
                return res.status(404).send('Twitch account not found');
            }

            const twitchAccount = user.accounts[twitchAccountIndex];
            const channelID = twitchAccount.id;

            const updatedUser = await updateUserDataTokens(
                user._id.toString(),
                access_token,
                refresh_token,
                id_token,
                true
            );

            if (!updatedUser) {
                console.error('Failed to update user:', username);
                return res.status(500).send('Internal server error');
            }

            if (!twitchAccount.actived && updatedUser.polar_sh_customer_id) {
                const ingestResult = await ingestPolarSHEvent({
                    customerId: updatedUser.polar_sh_customer_id,
                    cost: -25,
                    reason: 'Free benefits',
                    mode: 'immediate'
                });

                if (ingestResult.error) {
                    console.error('PolarSH ingest error:', ingestResult, channelID);
                }
            }

            await TwitchStreamers.updateTwitchAccountsInCache();
            const streamer = await TwitchStreamers.getTwitchAccountById(channelID);

            if (streamer) {
                const addedModerator = await addModerator(channelID, '698614112');

                if (addedModerator.error && addedModerator.message !== 'user is already a mod') {
                    console.error('Add moderator error:', addedModerator, channelID);
                    return res.status(addedModerator.status).json(addedModerator);
                }

                await subscribeAllEventSubs(channelID);
                await createReservedCommands(channelID, streamer.name);
            }

            await incrementSiteAnalytics('active', 1);

            return res.redirect(`https://domdimabot.com/login`);

        } catch (error) {
            console.error('Error in /auth/register:', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString(),
                username
            });

            return res.status(500).send('Internal server error');
        }
    });

    app.get('/auth/reauthenticate', async (req: Request<{}, {}, {}, OAuthCallbackRequest>, res: Response) => {
        const token = req.query.code;
        const username = req.query.state;

        if (!token || !username) {
            return res.status(400).send('Missing token or username');
        }

        try {
            const oauthResult = await exchangeOAuthCode(token);

            if (oauthResult.error) {
                console.error('OAuth token exchange error:', oauthResult.error, username);
                return res.status(400).send(oauthResult.error);
            }

            const { access_token, refresh_token, id_token } = oauthResult;

            const user = await getUserByUsername(username);

            if (!user) {
                console.error('User not found:', username);
                return res.status(404).send('User not found');
            }

            const updatedUser = await updateUserDataTokens(
                user._id.toString(),
                access_token,
                refresh_token,
                id_token,
                true
            );

            if (!updatedUser) {
                console.error('Failed to update user:', username);
                return res.status(500).send('Internal server error');
            }

            await TwitchStreamers.updateTwitchAccountsInCache();
            const twitchAccount = updatedUser.accounts.find(acc => acc.type === 'twitch');

            if (twitchAccount) {
                const streamer = await TwitchStreamers.getTwitchAccountById(twitchAccount.id);
                if (streamer) {
                    console.log(`Reauthenticated user: ${username}, updated cache`);
                }
            }

            return res.redirect(`https://domdimabot.com/login`);

        } catch (error) {
            console.error('Error in /auth/reauthenticate:', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString(),
                username
            });

            return res.status(500).send('Internal server error');
        }
    });

    app.post('/auth/login', async (req: Request, res: Response) => {
        const body = req.body as LoginRequestBody;
        const { name, id, email } = body;

        if (!id) {
            return res.status(400).json({
                error: true,
                message: 'Missing id',
                status: 400
            });
        }

        if (id === '1104868478') {
            return res.status(403).json({
                error: true,
                message: 'You are not allowed to login with this account',
                status: 403,
                type: 'error'
            });
        }

        try {
            const existingUser = await getUserByTwitchID(id);

            if (existingUser) {
                const twitchAccount = existingUser.accounts.find(acc => acc.type === 'twitch');
                if (!twitchAccount) {
                    return res.status(404).json({
                        error: true,
                        message: 'Twitch account not found',
                        status: 404
                    });
                }

                return res.status(200).json({
                    error: false,
                    message: 'User already exists',
                    data: {
                        name: existingUser.name,
                        email: existingUser.email,
                        plan_tier: existingUser.plan_tier,
                        plan_tier_until: existingUser.plan_tier_until,
                        actived: twitchAccount.actived,
                        chat_enabled: twitchAccount.chat_enabled,
                        twitch_user_id: twitchAccount.id,
                        up_to_date_permissions: twitchAccount.up_to_date_permissions
                    }
                });
            }

            if (!name || !email) {
                return res.status(400).json({
                    error: true,
                    message: 'Missing name or email',
                    status: 400
                });
            }

            const encryptedAccessToken = encrypt('');
            const encryptedRefreshToken = encrypt('');

            const newUser = new UsersSchema({
                name: name,
                email: email,
                accounts: [{
                    type: 'twitch',
                    id: id,
                    name: name,
                    email: email,
                    refresh_token: encryptedRefreshToken,
                    access_token: encryptedAccessToken,
                    actived: false,
                    chat_enabled: false,
                    has_permissions: true,
                    up_to_date_permissions: true
                }],
                plan_tier: 'free',
                plan_tier_until: null,
                tokenBalance: 0
            });

            try {
                const polarshClient = await getPolarShClient('auth login');

                const customer = await polarshClient.customers.create({
                    email: newUser.email,
                    externalId: newUser._id.toString(),
                    name: newUser.name,
                    billingAddress: {
                        country: 'US'
                    },
                    metadata: {
                        twitch_user_id: id,
                        twitch_user_name: name
                    }
                });

                newUser.polar_sh_customer_id = customer.id;

                await newUser.save();
                await incrementSiteAnalytics('registered', 1);

                return res.status(201).json({
                    error: false,
                    message: 'User created',
                    data: {
                        name: newUser.name,
                        email: newUser.email,
                        plan_tier: newUser.plan_tier,
                        plan_tier_until: newUser.plan_tier_until,
                        actived: newUser.accounts[0].actived,
                        chat_enabled: newUser.accounts[0].chat_enabled,
                        twitch_user_id: newUser.accounts[0].id,
                        up_to_date_permissions: newUser.accounts[0].up_to_date_permissions
                    }
                });

            } catch (polarshError) {
                console.error('PolarSH customer creation error:', polarshError);
                return res.status(500).json({ error: true, message: 'Internal server error', status: 500 });
            }

        } catch (error) {
            console.error('Error in /auth/login:', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString(),
                id,
                name
            });

            return res.status(500).json({
                error: true,
                message: 'Internal server error',
                status: 500
            });
        }
    });

    app.get('/auth/mock-register', async (req: Request<{}, {}, {}, OAuthCallbackRequest>, res: Response) => {
        const username = req.query.state;

        if (!username) {
            return res.status(400).json({ error: true, message: 'Missing username' });
        }

        try {
            const user = await getUserByUsername(username);

            if (!user) {
                console.error('User not found:', username);
                return res.status(404).json({ error: true, message: 'User not found' });
            }

            const twitchAccount = user.accounts.find(acc => acc.type === 'twitch');
            if (!twitchAccount) {
                console.error('Twitch account not found for user:', username);
                return res.status(404).json({ error: true, message: 'Twitch account not found' });
            }

            const channelID = twitchAccount.id;

            if (!twitchAccount.actived && user.polar_sh_customer_id) {
                const ingestResult = await ingestPolarSHEvent({
                    customerId: user.polar_sh_customer_id,
                    cost: -25,
                    reason: 'Free benefits',
                    mode: 'immediate'
                });

                if (ingestResult.error) {
                    console.error('PolarSH ingest error:', ingestResult, channelID);
                }
            }

            await TwitchStreamers.updateTwitchAccountsInCache();
            const streamer = await TwitchStreamers.getTwitchAccountById(channelID);

            if (streamer) {
                const addedModerator = await addModerator(channelID, '698614112');

                if (addedModerator.error && addedModerator.message !== 'user is already a mod') {
                    console.error('Add moderator error:', addedModerator, channelID);
                    return res.status(addedModerator.status).json(addedModerator);
                }

                await subscribeAllEventSubs(channelID);
                await createReservedCommands(channelID, streamer.name);

                await UsersSchema.updateOne(
                    { _id: user._id },
                    { $set: { 'accounts.$.actived': true, 'accounts.$.chat_enabled': true } }
                );

                await incrementSiteAnalytics('active', 1);
            }

            return res.redirect(`https://domdimabot.com/login`);

        } catch (error) {
            console.error('Error in /auth/mock-register:', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString(),
                username
            });

            return res.status(500).send('Internal server error');
        }
    });

    app.post('/auth/repair', authMiddleware as any, async (req: any, res: Response) => {
        if (!req.user || !req.user.id) {
            return res.status(401).json({
                error: true,
                message: 'Unauthorized',
                status: 401
            });
        }

        try {
            const user = await getUserByTwitchID(req.user.id);

            if (!user) {
                return res.status(404).json({
                    error: true,
                    message: 'User not found',
                    status: 404
                });
            }

            const twitchAccount = user.accounts.find(acc => acc.type === 'twitch');
            if (!twitchAccount) {
                return res.status(404).json({
                    error: true,
                    message: 'Twitch account not found',
                    status: 404
                });
            }

            const channelID = twitchAccount.id;

            const existingEventSubs = await EventsubSchema.find({ channelID }).select('type').lean();
            const existingTypes = existingEventSubs.map(es => es.type);

            const missingSubscriptions = SUBSCRIPTION_TYPES.filter(
                sub => !existingTypes.includes(sub.type)
            );

            let subscribedCount = 0;

            for (const subscription of missingSubscriptions) {
                const condition = { ...subscription.condition };

                if (subscription.type === 'channel.raid') {
                    condition.to_broadcaster_user_id = channelID;
                } else {
                    condition.broadcaster_user_id = channelID;
                }

                const response = await subscribeTwitchEvent(
                    channelID,
                    subscription.type,
                    subscription.version,
                    condition,
                    subscription.config
                );

                if (!response.error) {
                    subscribedCount++;
                } else {
                    console.error(`Failed to subscribe to ${subscription.type}:`, response);
                }
            }

            return res.status(200).json({
                error: false,
                message: `Repaired ${subscribedCount} missing event subscriptions`,
                data: {
                    subscribedCount,
                    totalNeeded: missingSubscriptions.length
                }
            });

        } catch (error) {
            console.error('Error in /auth/repair:', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString(),
                userId: req.user?.id
            });

            return res.status(500).json({
                error: true,
                message: 'Internal server error',
                status: 500
            });
        }
    });

    app.post('/auth/factory-reset', authMiddleware as any, async (req: any, res: Response) => {
        try {
            return res.status(501).json({
                error: true,
                message: 'Factory reset not yet implemented',
                status: 501
            });
        } catch (error) {
            console.error('Error in /auth/factory-reset:', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString()
            });

            return res.status(500).json({
                error: true,
                message: 'Internal server error',
                status: 500
            });
        }
    });
};
