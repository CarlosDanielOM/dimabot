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

        console.log('[AUTH/REGISTER] Request received', { username, timestamp: new Date().toISOString() });

        if (!token || !username) {
            console.log('[AUTH/REGISTER] Missing token or username', { username });
            return res.status(400).send('Missing token or username');
        }

        try {
            console.log('[AUTH/REGISTER] OAuth code exchange started', { username });
            const oauthResult = await exchangeOAuthCode(token);

            if (oauthResult.error) {
                console.error('[AUTH/REGISTER] OAuth token exchange failed', {
                    error: oauthResult.error,
                    username,
                    timestamp: new Date().toISOString()
                });
                return res.status(400).send(oauthResult.error);
            }

            console.log('[AUTH/REGISTER] OAuth code exchange completed', {
                success: true,
                username,
                timestamp: new Date().toISOString()
            });

            const { access_token, refresh_token, id_token } = oauthResult;

            console.log('[AUTH/REGISTER] User lookup by username', { username });
            const user = await getUserByUsername(username);

            if (!user) {
                console.log('[AUTH/REGISTER] User not found', { username });
                return res.status(404).send('User not found');
            }

            console.log('[AUTH/REGISTER] User found', { userId: user._id.toString(), username });

            console.log('[AUTH/REGISTER] Twitch account index lookup', { username });
            const twitchAccountIndex = user.accounts.findIndex(acc => acc.type === 'twitch');
            if (twitchAccountIndex === -1) {
                console.log('[AUTH/REGISTER] Twitch account not found', { username });
                return res.status(404).send('Twitch account not found');
            }

            console.log('[AUTH/REGISTER] Twitch account index found', { index: twitchAccountIndex, username });
            const twitchAccount = user.accounts[twitchAccountIndex];
            const channelID = twitchAccount.id;

            console.log('[AUTH/REGISTER] User tokens update started', {
                userId: user._id.toString(),
                channelID,
                username
            });
            const updatedUser = await updateUserDataTokens(
                user._id.toString(),
                access_token,
                refresh_token,
                id_token,
                true
            );

            if (!updatedUser) {
                console.log('[AUTH/REGISTER] User tokens update failed', { username });
                return res.status(500).send('Internal server error');
            }

            console.log('[AUTH/REGISTER] User tokens update completed', {
                userId: user._id.toString(),
                username
            });

            if (!twitchAccount.actived && updatedUser.polar_sh_customer_id) {
                console.log('[AUTH/REGISTER] PolarSH event ingest started', {
                    customerId: updatedUser.polar_sh_customer_id,
                    channelID
                });
                const ingestResult = await ingestPolarSHEvent({
                    customerId: updatedUser.polar_sh_customer_id,
                    cost: -25,
                    reason: 'Free benefits',
                    mode: 'immediate'
                });

                if (ingestResult.error) {
                    console.error('[AUTH/REGISTER] PolarSH ingest failed', {
                        error: ingestResult,
                        channelID,
                        timestamp: new Date().toISOString()
                    });
                } else {
                    console.log('[AUTH/REGISTER] PolarSH ingest completed', {
                        success: true,
                        channelID
                    });
                }
            }

            console.log('[AUTH/REGISTER] Cache update started', { channelID });
            await TwitchStreamers.updateTwitchAccountsInCache();
            console.log('[AUTH/REGISTER] Cache update completed', { channelID });

            console.log('[AUTH/REGISTER] Streamer lookup by channelID', { channelID });
            const streamer = await TwitchStreamers.getTwitchAccountById(channelID);

            if (streamer) {
                console.log('[AUTH/REGISTER] Streamer found', {
                    channelID,
                    streamerName: streamer.name
                });

                console.log('[AUTH/REGISTER] Add moderator started', { channelID });
                const addedModerator = await addModerator(channelID, '698614112');

                if (addedModerator.error && addedModerator.message !== 'user is already a mod') {
                    console.error('[AUTH/REGISTER] Add moderator failed', {
                        error: addedModerator,
                        channelID,
                        timestamp: new Date().toISOString()
                    });
                    return res.status(addedModerator.status).json(addedModerator);
                }

                console.log('[AUTH/REGISTER] Add moderator completed', {
                    success: true,
                    channelID
                });

                console.log('[AUTH/REGISTER] EventSub subscriptions started', { channelID });
                await subscribeAllEventSubs(channelID);
                console.log('[AUTH/REGISTER] EventSub subscriptions completed', { channelID });

                console.log('[AUTH/REGISTER] Reserved commands creation started', {
                    channelID,
                    streamerName: streamer.name
                });
                await createReservedCommands(channelID, streamer.name);
                console.log('[AUTH/REGISTER] Reserved commands creation completed', { channelID });
            } else {
                console.log('[AUTH/REGISTER] Streamer not found', { channelID });
            }

            console.log('[AUTH/REGISTER] Analytics increment started');
            await incrementSiteAnalytics('active', 1);
            console.log('[AUTH/REGISTER] Analytics increment completed');

            console.log('[AUTH/REGISTER] Redirecting to login', { username });
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

        console.log('[AUTH/REAUTHENTICATE] Request received', { username, timestamp: new Date().toISOString() });

        if (!token || !username) {
            console.log('[AUTH/REAUTHENTICATE] Missing token or username', { username });
            return res.status(400).send('Missing token or username');
        }

        try {
            console.log('[AUTH/REAUTHENTICATE] OAuth code exchange started', { username });
            const oauthResult = await exchangeOAuthCode(token);

            if (oauthResult.error) {
                console.error('[AUTH/REAUTHENTICATE] OAuth token exchange failed', {
                    error: oauthResult.error,
                    username,
                    timestamp: new Date().toISOString()
                });
                return res.status(400).send(oauthResult.error);
            }

            console.log('[AUTH/REAUTHENTICATE] OAuth code exchange completed', {
                success: true,
                username,
                timestamp: new Date().toISOString()
            });

            const { access_token, refresh_token, id_token } = oauthResult;

            console.log('[AUTH/REAUTHENTICATE] User lookup by username', { username });
            const user = await getUserByUsername(username);

            if (!user) {
                console.log('[AUTH/REAUTHENTICATE] User not found', { username });
                return res.status(404).send('User not found');
            }

            console.log('[AUTH/REAUTHENTICATE] User found', { userId: user._id.toString(), username });

            console.log('[AUTH/REAUTHENTICATE] User tokens update started', {
                userId: user._id.toString(),
                username
            });
            const updatedUser = await updateUserDataTokens(
                user._id.toString(),
                access_token,
                refresh_token,
                id_token,
                true
            );

            if (!updatedUser) {
                console.log('[AUTH/REAUTHENTICATE] User tokens update failed', { username });
                return res.status(500).send('Internal server error');
            }

            console.log('[AUTH/REAUTHENTICATE] User tokens update completed', {
                userId: user._id.toString(),
                username
            });

            console.log('[AUTH/REAUTHENTICATE] Cache update started');
            await TwitchStreamers.updateTwitchAccountsInCache();
            console.log('[AUTH/REAUTHENTICATE] Cache update completed');

            console.log('[AUTH/REAUTHENTICATE] Twitch account lookup', {
                userId: user._id.toString(),
                username
            });
            const twitchAccount = updatedUser.accounts.find(acc => acc.type === 'twitch');

            if (twitchAccount) {
                console.log('[AUTH/REAUTHENTICATE] Twitch account found', {
                    channelID: twitchAccount.id,
                    username
                });

                console.log('[AUTH/REAUTHENTICATE] Streamer lookup by channelID', {
                    channelID: twitchAccount.id
                });
                const streamer = await TwitchStreamers.getTwitchAccountById(twitchAccount.id);
                if (streamer) {
                    console.log('[AUTH/REAUTHENTICATE] Streamer found, cache updated', {
                        channelID: twitchAccount.id,
                        username
                    });
                } else {
                    console.log('[AUTH/REAUTHENTICATE] Streamer not found', {
                        channelID: twitchAccount.id
                    });
                }
            } else {
                console.log('[AUTH/REAUTHENTICATE] Twitch account not found', {
                    userId: user._id.toString(),
                    username
                });
            }

            console.log('[AUTH/REAUTHENTICATE] Redirecting to login', { username });
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

        console.log('[AUTH/LOGIN] Request received', {
            id,
            name,
            email,
            timestamp: new Date().toISOString()
        });

        if (!id) {
            console.log('[AUTH/LOGIN] Missing ID');
            return res.status(400).json({
                error: true,
                message: 'Missing id',
                status: 400
            });
        }

        if (id === '1104868478') {
            console.log('[AUTH/LOGIN] Blocked ID attempted login', { id });
            return res.status(403).json({
                error: true,
                message: 'You are not allowed to login with this account',
                status: 403,
                type: 'error'
            });
        }

        try {
            console.log('[AUTH/LOGIN] User lookup by Twitch ID', { id });
            const existingUser = await getUserByTwitchID(id);

            if (existingUser) {
                console.log('[AUTH/LOGIN] Existing user found', {
                    userId: existingUser._id.toString(),
                    username: existingUser.name,
                    id
                });

                console.log('[AUTH/LOGIN] Twitch account lookup', {
                    userId: existingUser._id.toString(),
                    id
                });
                const twitchAccount = existingUser.accounts.find(acc => acc.type === 'twitch');
                if (!twitchAccount) {
                    console.log('[AUTH/LOGIN] Twitch account not found', {
                        userId: existingUser._id.toString(),
                        id
                    });
                    return res.status(404).json({
                        error: true,
                        message: 'Twitch account not found',
                        status: 404
                    });
                }

                console.log('[AUTH/LOGIN] Existing user response sent', {
                    userId: existingUser._id.toString(),
                    username: existingUser.name
                });
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

            console.log('[AUTH/LOGIN] Existing user not found, proceeding with new user creation', { id });

            if (!name || !email) {
                console.log('[AUTH/LOGIN] Missing name or email', { id });
                return res.status(400).json({
                    error: true,
                    message: 'Missing name or email',
                    status: 400
                });
            }

            console.log('[AUTH/LOGIN] New user creation started', { id, name });
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
                console.log('[AUTH/LOGIN] PolarSH client initialization');
                const polarshClient = await getPolarShClient('auth login');

                console.log('[AUTH/LOGIN] PolarSH customer creation started', {
                    email: newUser.email,
                    username: newUser.name,
                    twitchID: id
                });
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

                console.log('[AUTH/LOGIN] PolarSH customer created', {
                    customerId: customer.id,
                    userId: newUser._id.toString()
                });
                newUser.polar_sh_customer_id = customer.id;

                console.log('[AUTH/LOGIN] New user save started', {
                    userId: newUser._id.toString(),
                    username: newUser.name
                });
                await newUser.save();
                console.log('[AUTH/LOGIN] New user save completed', {
                    userId: newUser._id.toString(),
                    username: newUser.name
                });

                console.log('[AUTH/LOGIN] Analytics increment started');
                await incrementSiteAnalytics('registered', 1);
                console.log('[AUTH/LOGIN] Analytics increment completed');

                console.log('[AUTH/LOGIN] New user creation response sent', {
                    userId: newUser._id.toString(),
                    username: newUser.name
                });
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
                console.error('[AUTH/LOGIN] PolarSH customer creation failed', {
                    error: polarshError,
                    timestamp: new Date().toISOString(),
                    id,
                    name
                });
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

        console.log('[AUTH/MOCK-REGISTER] Request received', { username, timestamp: new Date().toISOString() });

        if (!username) {
            console.log('[AUTH/MOCK-REGISTER] Missing username');
            return res.status(400).json({ error: true, message: 'Missing username' });
        }

        try {
            console.log('[AUTH/MOCK-REGISTER] User lookup by username', { username });
            const user = await getUserByUsername(username);

            if (!user) {
                console.log('[AUTH/MOCK-REGISTER] User not found', { username });
                return res.status(404).json({ error: true, message: 'User not found' });
            }

            console.log('[AUTH/MOCK-REGISTER] User found', { userId: user._id.toString(), username });

            console.log('[AUTH/MOCK-REGISTER] Twitch account lookup', { username });
            const twitchAccount = user.accounts.find(acc => acc.type === 'twitch');
            if (!twitchAccount) {
                console.log('[AUTH/MOCK-REGISTER] Twitch account not found', { username });
                return res.status(404).json({ error: true, message: 'Twitch account not found' });
            }

            const channelID = twitchAccount.id;
            console.log('[AUTH/MOCK-REGISTER] ChannelID extracted', { channelID, username });

            if (!twitchAccount.actived && user.polar_sh_customer_id) {
                console.log('[AUTH/MOCK-REGISTER] PolarSH event ingest started', {
                    customerId: user.polar_sh_customer_id,
                    channelID
                });
                const ingestResult = await ingestPolarSHEvent({
                    customerId: user.polar_sh_customer_id,
                    cost: -25,
                    reason: 'Free benefits',
                    mode: 'immediate'
                });

                if (ingestResult.error) {
                    console.error('[AUTH/MOCK-REGISTER] PolarSH ingest failed', {
                        error: ingestResult,
                        channelID,
                        timestamp: new Date().toISOString()
                    });
                } else {
                    console.log('[AUTH/MOCK-REGISTER] PolarSH ingest completed', {
                        success: true,
                        channelID
                    });
                }
            }

            console.log('[AUTH/MOCK-REGISTER] Cache update started', { channelID });
            await TwitchStreamers.updateTwitchAccountsInCache();
            console.log('[AUTH/MOCK-REGISTER] Cache update completed', { channelID });

            console.log('[AUTH/MOCK-REGISTER] Streamer lookup by channelID', { channelID });
            const streamer = await TwitchStreamers.getTwitchAccountById(channelID);

            if (streamer) {
                console.log('[AUTH/MOCK-REGISTER] Streamer found', {
                    channelID,
                    streamerName: streamer.name
                });

                console.log('[AUTH/MOCK-REGISTER] Add moderator started', { channelID });
                const addedModerator = await addModerator(channelID, '698614112');

                if (addedModerator.error && addedModerator.message !== 'user is already a mod') {
                    console.error('[AUTH/MOCK-REGISTER] Add moderator failed', {
                        error: addedModerator,
                        channelID,
                        timestamp: new Date().toISOString()
                    });
                    return res.status(addedModerator.status).json(addedModerator);
                }

                console.log('[AUTH/MOCK-REGISTER] Add moderator completed', {
                    success: true,
                    channelID
                });

                console.log('[AUTH/MOCK-REGISTER] EventSub subscriptions started', { channelID });
                await subscribeAllEventSubs(channelID);
                console.log('[AUTH/MOCK-REGISTER] EventSub subscriptions completed', { channelID });

                console.log('[AUTH/MOCK-REGISTER] Reserved commands creation started', {
                    channelID,
                    streamerName: streamer.name
                });
                await createReservedCommands(channelID, streamer.name);
                console.log('[AUTH/MOCK-REGISTER] Reserved commands creation completed', { channelID });

                console.log('[AUTH/MOCK-REGISTER] User activation update started', {
                    userId: user._id.toString(),
                    channelID
                });
                await UsersSchema.updateOne(
                    { _id: user._id },
                    { $set: { 'accounts.$.actived': true, 'accounts.$.chat_enabled': true } }
                );
                console.log('[AUTH/MOCK-REGISTER] User activation update completed', {
                    userId: user._id.toString()
                });

                console.log('[AUTH/MOCK-REGISTER] Analytics increment started');
                await incrementSiteAnalytics('active', 1);
                console.log('[AUTH/MOCK-REGISTER] Analytics increment completed');
            } else {
                console.log('[AUTH/MOCK-REGISTER] Streamer not found', { channelID });
            }

            console.log('[AUTH/MOCK-REGISTER] Redirecting to login', { username });
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

    app.post('/auth/repair', async (req: any, res: Response) => {
        console.log('[AUTH/REPAIR] Request received', {
            userId: req.user?.id,
            timestamp: new Date().toISOString()
        });

        if (!req.user || !req.user.id) {
            console.log('[AUTH/REPAIR] Unauthorized - missing user or ID');
            return res.status(401).json({
                error: true,
                message: 'Unauthorized',
                status: 401
            });
        }

        console.log('[AUTH/REPAIR] Authorization check passed', {
            userId: req.user.id
        });

        try {
            console.log('[AUTH/REPAIR] User lookup by Twitch ID', {
                userId: req.user.id
            });
            const user = await getUserByTwitchID(req.user.id);

            if (!user) {
                console.log('[AUTH/REPAIR] User not found', {
                    userId: req.user.id
                });
                return res.status(404).json({
                    error: true,
                    message: 'User not found',
                    status: 404
                });
            }

            console.log('[AUTH/REPAIR] User found', {
                userId: user._id.toString(),
                username: user.name
            });

            console.log('[AUTH/REPAIR] Twitch account lookup', {
                userId: user._id.toString()
            });
            const twitchAccount = user.accounts.find(acc => acc.type === 'twitch');
            if (!twitchAccount) {
                console.log('[AUTH/REPAIR] Twitch account not found', {
                    userId: user._id.toString()
                });
                return res.status(404).json({
                    error: true,
                    message: 'Twitch account not found',
                    status: 404
                });
            }

            const channelID = twitchAccount.id;
            console.log('[AUTH/REPAIR] ChannelID extracted', {
                channelID,
                userId: user._id.toString()
            });

            console.log('[AUTH/REPAIR] Existing EventSubs lookup started', { channelID });
            const existingEventSubs = await EventsubSchema.find({ channelID }).select('type').lean();
            const existingTypes = existingEventSubs.map(es => es.type);

            console.log('[AUTH/REPAIR] Existing EventSubs found', {
                channelID,
                count: existingEventSubs.length,
                types: existingTypes
            });

            const missingSubscriptions = SUBSCRIPTION_TYPES.filter(
                sub => !existingTypes.includes(sub.type)
            );

            console.log('[AUTH/REPAIR] Missing subscriptions identified', {
                channelID,
                count: missingSubscriptions.length,
                types: missingSubscriptions.map(s => s.type)
            });

            let subscribedCount = 0;

            console.log('[AUTH/REPAIR] Subscription loop started', {
                channelID,
                totalCount: missingSubscriptions.length
            });
            for (const subscription of missingSubscriptions) {
                const condition = { ...subscription.condition };

                if (subscription.type === 'channel.raid') {
                    condition.to_broadcaster_user_id = channelID;
                } else {
                    condition.broadcaster_user_id = channelID;
                }

                console.log('[AUTH/REPAIR] Subscribing to event', {
                    channelID,
                    subscriptionType: subscription.type,
                    subscriptionVersion: subscription.version
                });
                const response = await subscribeTwitchEvent(
                    channelID,
                    subscription.type,
                    subscription.version,
                    condition,
                    subscription.config
                );

                if (!response.error) {
                    subscribedCount++;
                    console.log('[AUTH/REPAIR] Subscription successful', {
                        channelID,
                        subscriptionType: subscription.type
                    });
                } else {
                    console.error('[AUTH/REPAIR] Subscription failed', {
                        subscriptionType: subscription.type,
                        error: response,
                        channelID,
                        timestamp: new Date().toISOString()
                    });
                }
            }

            console.log('[AUTH/REPAIR] Subscription loop completed', {
                channelID,
                subscribedCount,
                totalNeeded: missingSubscriptions.length
            });

            console.log('[AUTH/REPAIR] Response sent', {
                userId: user._id.toString(),
                channelID,
                subscribedCount,
                totalNeeded: missingSubscriptions.length
            });
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

    app.post('/auth/factory-reset', async (req: any, res: Response) => {
        console.log('[AUTH/FACTORY-RESET] Request received', {
            userId: req.user?.id,
            timestamp: new Date().toISOString()
        });

        try {
            console.log('[AUTH/FACTORY-RESET] Not implemented response sent');
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
