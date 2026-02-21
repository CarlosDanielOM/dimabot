import express, { type Request, type Response } from "express";
import { getDirname } from "../../utils/pollyfills.js";
import UsersSchema, { type IUsers } from "../../schemas/users.schema.js";
import { CommandsSchema } from "../../schemas/commands.schema.js";
import TwitchStreamers from "../../classes/twitch_streamers.class.js";
import { addModerator } from "../../functions/channels/add_moderator.channel.js";
import { encrypt } from "../../utils/crypto.js";
import { SUBSCRIPTION_TYPES, subscribeTwitchEvent, unsubscribeTwitchEvent } from "../../utils/eventsub.js";
import JSONCOMMANDS from "../../config/commands/reservedcommands.json" with { type: 'json' };
import { incrementSiteAnalytics } from "../../utils/siteanalytics.js";
import { ingestPolarSHEvent, getPolarShClient } from "../../utils/polarsh.js";
import { applyReferralCode } from "../../utils/referral.js";
import EventsubSchema from "../../schemas/eventsub.schema.js";
import { AdminSchema } from "../../schemas/admin.schema.js";
import { TriggerSchema } from "../../schemas/trigger.schema.js";
import { TriggerFileSchema } from "../../schemas/trigger_file.schema.js";
import { RedemptionRewardSchema } from "../../schemas/redemption_reward.schema.js";
import { ClipDesignSchema } from "../../schemas/clip_design.schema.js";
import { TitleConfigSchema } from "../../schemas/title_config.schema.js";
import { CountdownTimerSchema } from "../../schemas/countdown_timer.schema.js";
import { CountdownTimerConfigSchema } from "../../schemas/countdown_timer_config.schema.js";
import { CommandTimerSchema } from "../../schemas/command_timer.schema.js";
import { ChannelAIPersonalitySchema } from "../../schemas/channel_ai_personality.schema.js";
import { CommandUserVariablesSchema } from "../../schemas/command_user_variables.schema.js";
import type { AuthRequest } from "../../middleware/types.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";

const __dirname = getDirname(import.meta.url);

interface OAuthCallbackRequest {
    code?: string;
    state?: string;
}

interface OAuthAuthorizeRequest {
    state?: string;
    action?: 'activate' | 'reauthenticate' | 'update';
}

interface LoginRequestBody {
    name?: string;
    id?: string;
    email?: string;
    referralCode?: string;
}

interface StandardResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    data?: any;
}

interface AdminChannelSummary {
    channelID: string;
    channelName: string;
}

async function getAdministratingChannels(adminID: string): Promise<AdminChannelSummary[]> {
    const rows = await AdminSchema.find({
        adminID,
        actived: true
    })
        .select('channelID channelName -_id')
        .lean();

    const deduped = new Map<string, AdminChannelSummary>();
    for (const row of rows) {
        if (!row.channelID) {
            continue;
        }

        if (!deduped.has(row.channelID)) {
            deduped.set(row.channelID, {
                channelID: row.channelID,
                channelName: row.channelName || row.channelID
            });
        }
    }

    return Array.from(deduped.values());
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

const TWITCH_AUTH_SCOPES = [
    "analytics:read:extensions", "analytics:read:games", "bits:read", "channel:manage:ads", "channel:read:ads", "channel:manage:broadcast", "channel:read:charity", "channel:edit:commercial", "channel:read:editors", "channel:manage:extensions", "channel:read:goals", "channel:read:guest_star", "channel:manage:guest_star", "channel:read:hype_train", "channel:manage:moderators", "channel:read:polls", "channel:manage:polls", "channel:read:predictions", "channel:manage:predictions", "channel:manage:raids", "channel:read:redemptions", "channel:manage:redemptions", "channel:manage:schedule", "channel:read:subscriptions", "channel:manage:videos", "channel:read:vips", "channel:manage:vips", "clips:edit", "moderation:read", "moderator:manage:announcements", "moderator:manage:automod", "moderator:read:automod_settings", "moderator:manage:automod_settings", "moderator:manage:banned_users", "moderator:read:blocked_terms", "moderator:manage:blocked_terms", "moderator:read:chat_messages", "moderator:manage:chat_messages", "moderator:read:chat_settings", "moderator:manage:chat_settings", "moderator:read:chatters", "moderator:read:followers", "moderator:read:guest_star", "moderator:manage:guest_star", "moderator:read:shield_mode", "moderator:manage:shield_mode", "moderator:read:shoutouts", "moderator:manage:shoutouts", "user:edit", "user:edit:follows", "user:read:blocked_users", "user:manage:blocked_users", "user:read:broadcast", "user:manage:chat_color", "user:read:email", "user:read:follows", "user:read:subscriptions", "user:manage:whispers", "channel:bot", "channel:moderate", "chat:edit", "chat:read", "user:bot", "user:read:chat", "whispers:read", "whispers:edit", "user:write:chat", "channel:manage:clips", "moderator:read:suspicious_users", "moderator:read:unban_requests", "moderator:manage:unban_requests", "moderator:read:warnings", "moderator:manage:warnings"
];

async function exchangeOAuthCode(code: string): Promise<{ access_token: string; refresh_token: string; error?: string }> {
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
        return { access_token: '', refresh_token: '', error: data.error };
    }

    return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
    };
}

async function updateUserDataTokens(userId: string, accessToken: string, refreshToken: string, activate: boolean = false): Promise<IUsers | StandardResponse | null> {
    if (!accessToken || !refreshToken) {
        return {
            error: true,
            message: '[⚠️] Missing access token or refresh token, please try again [/⚠️]',
            status: 400,
            type: 'error'
        };
    }
    
    const encryptedToken = encrypt(accessToken);
    const encryptedRefreshToken = encrypt(refreshToken);

    const updateData: any = {
        'accounts.$.access_token': encryptedToken,
        'accounts.$.refresh_token': encryptedRefreshToken,
    };

    if (activate) {
        updateData['accounts.$.actived'] = true;
        updateData['accounts.$.chat_enabled'] = true;
        updateData['accounts.$.up_to_date_permissions'] = true;
        updateData['accounts.$.has_permissions'] = true;
    }

    return await UsersSchema.findOneAndUpdate(
        { _id: userId, 'accounts.type': 'twitch' },
        { $set: updateData },
        { new: true }
    );
}

const router = express.Router();

router.get('/authorize', async (req: Request<{}, {}, {}, OAuthAuthorizeRequest>, res: Response) => {
        const username = req.query.state;
        const action = req.query.action;

        if (!username) {
            return res.status(400).json({
                error: true,
                message: 'Missing state',
                status: 400
            });
        }

        const endpoint = action === 'activate' ? 'register' : 'reauthenticate';
        const host = req.get('host') || 'api.domdimabot.com';
        const protocol = host.includes('localhost') ? 'http' : 'https';
        const redirectUri = `${protocol}://${host}/auth/${endpoint}`;

        const params = new URLSearchParams({
            response_type: 'code',
            force_verify: 'false',
            client_id: process.env.CLIENT_ID!,
            redirect_uri: redirectUri,
            scope: TWITCH_AUTH_SCOPES.join(' '),
            state: username
        });

        return res.redirect(`https://id.twitch.tv/oauth2/authorize?${params.toString()}`);
    });

router.get('/register', async (req: Request<{}, {}, {}, OAuthCallbackRequest>, res: Response) => {
        const token = req.query.code;
        const username = req.query.state;

        if (!token || !username) {
            return res.status(400).send('Missing token or username');
        }

        try {
            const oauthResult = await exchangeOAuthCode(token);

            if (oauthResult.error) {
                console.error('[AUTH/REGISTER] OAuth token exchange failed', {
                    error: oauthResult.error,
                    username,
                    timestamp: new Date().toISOString()
                });
                return res.status(400).send(oauthResult.error);
            }

            const { access_token, refresh_token } = oauthResult;

            const user = await getUserByUsername(username);

            if (!user) {
                return res.status(404).send('User not found');
            }

            const twitchAccountIndex = user.accounts.findIndex(acc => acc.type === 'twitch');
            if (twitchAccountIndex === -1) {
                return res.status(404).send('Twitch account not found');
            }

            const twitchAccount = user.accounts[twitchAccountIndex];
            const channelID = twitchAccount.id;

            const updatedUser = await updateUserDataTokens(
                user._id.toString(),
                access_token,
                refresh_token,
                true
            );

            if (!updatedUser) {
                return res.status(500).send('Internal server error');
            }

            if (!twitchAccount.actived && (updatedUser as IUsers).polar_sh_customer_id) {
                const ingestResult = await ingestPolarSHEvent({
                    customerId: (updatedUser as IUsers).polar_sh_customer_id,
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
                }
            }

            await TwitchStreamers.updateTwitchAccountsInCache();

            const streamer = await TwitchStreamers.getTwitchAccountById(channelID);

            if (streamer) {
                const addedModerator = await addModerator(channelID, '698614112');

                if (addedModerator.error && addedModerator.message !== 'user is already a mod') {
                    console.error('[AUTH/REGISTER] Add moderator failed', {
                        error: addedModerator,
                        channelID,
                        timestamp: new Date().toISOString()
                    });
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

router.get('/reauthenticate', async (req: Request<{}, {}, {}, OAuthCallbackRequest>, res: Response) => {
        const token = req.query.code;
        const username = req.query.state;

        if (!token || !username) {
            return res.status(400).send('Missing token or username');
        }

        try {
            const oauthResult = await exchangeOAuthCode(token);

            if (oauthResult.error) {
                console.error('[AUTH/REAUTHENTICATE] OAuth token exchange failed', {
                    error: oauthResult.error,
                    username,
                    timestamp: new Date().toISOString()
                });
                return res.status(400).send(oauthResult.error);
            }

            const { access_token, refresh_token } = oauthResult;

            const user = await getUserByUsername(username);

            if (!user) {
                return res.status(404).send('User not found');
            }

            const updatedUser = await updateUserDataTokens(
                user._id.toString(),
                access_token,
                refresh_token,
                true
            );

            if (!updatedUser) {
                return res.status(500).send('Internal server error');
            }

            await TwitchStreamers.updateTwitchAccountsInCache();

            const twitchAccount = (updatedUser as IUsers).accounts.find(acc => acc.type === 'twitch');

            if (twitchAccount) {
                await TwitchStreamers.getTwitchAccountById(twitchAccount.id);
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

router.post('/login', async (req: Request, res: Response) => {
        const body = req.body as LoginRequestBody;
        const { name, id, email, referralCode } = body;

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

                const administrating = await getAdministratingChannels(id);

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
                        has_permissions: twitchAccount.has_permissions,
                        up_to_date_permissions: twitchAccount.up_to_date_permissions,
                        administrating
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
                    has_permissions: false,
                    up_to_date_permissions: false
                }],
                plan_tier: 'free',
                plan_tier_until: null,
                last_app_activity_at: new Date(),
                token_balance: 0
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

                const normalizedReferralCode = String(referralCode || '').trim().toLowerCase();
                if (normalizedReferralCode) {
                    try {
                        await applyReferralCode(newUser._id, normalizedReferralCode);
                    } catch (referralError) {
                        console.error('[AUTH/LOGIN] Failed to apply referral code during user creation', {
                            referralCode: normalizedReferralCode,
                            userId: newUser._id.toString(),
                            error: referralError instanceof Error ? referralError.message : String(referralError),
                            stack: referralError instanceof Error ? referralError.stack : undefined,
                            timestamp: new Date().toISOString()
                        });
                    }
                }

                const administrating = await getAdministratingChannels(id);

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
                        has_permissions: newUser.accounts[0].has_permissions,
                        up_to_date_permissions: newUser.accounts[0].up_to_date_permissions,
                        administrating
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

router.get('/mock-register', async (req: Request<{}, {}, {}, OAuthCallbackRequest>, res: Response) => {
        const username = req.query.state;

        if (!username) {
            return res.status(400).json({ error: true, message: 'Missing username' });
        }

        try {
            const user = await getUserByUsername(username);

            if (!user) {
                return res.status(404).json({ error: true, message: 'User not found' });
            }

            const twitchAccount = user.accounts.find(acc => acc.type === 'twitch');
            if (!twitchAccount) {
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
                    console.error('[AUTH/MOCK-REGISTER] PolarSH ingest failed', {
                        error: ingestResult,
                        channelID,
                        timestamp: new Date().toISOString()
                    });
                }
            }

            await TwitchStreamers.updateTwitchAccountsInCache();

            const streamer = await TwitchStreamers.getTwitchAccountById(channelID);

            if (streamer) {
                const addedModerator = await addModerator(channelID, '698614112');

                if (addedModerator.error && addedModerator.message !== 'user is already a mod') {
                    console.error('[AUTH/MOCK-REGISTER] Add moderator failed', {
                        error: addedModerator,
                        channelID,
                        timestamp: new Date().toISOString()
                    });
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

async function performFactoryReset(channelID: string, channelName: string): Promise<Record<string, number>> {
    const existingEventsubs = await EventsubSchema.find({ channelID }).select('id').lean();
    for (const eventsub of existingEventsubs) {
        if (!eventsub.id) {
            continue;
        }

        const unsubscribeResult = await unsubscribeTwitchEvent(eventsub.id);
        if ((unsubscribeResult as any)?.error) {
            console.error('[AUTH/FACTORY-RESET] Failed to unsubscribe eventsub', {
                channelID,
                eventsubID: eventsub.id,
                unsubscribeResult,
                timestamp: new Date().toISOString()
            });
        }
    }

    const [
        commandsDelete,
        commandVariablesDelete,
        eventsubsDelete,
        rewardsDelete,
        triggersDelete,
        adminsDelete
    ] = await Promise.all([
        CommandsSchema.deleteMany({ channelID }),
        CommandUserVariablesSchema.deleteMany({ channelID }),
        EventsubSchema.deleteMany({ channelID }),
        RedemptionRewardSchema.deleteMany({ channelID }),
        TriggerSchema.deleteMany({ channelID }),
        AdminSchema.deleteMany({ channelID })
    ]);

    await subscribeAllEventSubs(channelID);
    await createReservedCommands(channelID, channelName);

    return {
        commandsDeleted: commandsDelete.deletedCount ?? 0,
        commandVariablesDeleted: commandVariablesDelete.deletedCount ?? 0,
        eventsubsDeleted: eventsubsDelete.deletedCount ?? 0,
        rewardsDeleted: rewardsDelete.deletedCount ?? 0,
        triggersDeleted: triggersDelete.deletedCount ?? 0,
        adminsDeleted: adminsDelete.deletedCount ?? 0
    };
}

router.post('/repair', authMiddleware as any, async (req: any, res: Response) => {
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
                    console.error('[AUTH/REPAIR] Subscription failed', {
                        subscriptionType: subscription.type,
                        error: response,
                        channelID,
                        timestamp: new Date().toISOString()
                    });
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

router.post('/factory-reset', authMiddleware as any, async (req: any, res: Response) => {
        try {
            const channelID = req.user?.id;
            if (!channelID) {
                return res.status(401).json({
                    error: true,
                    message: 'Unauthorized',
                    status: 401
                });
            }

            const user = await getUserByTwitchID(channelID);
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

            const counts = await performFactoryReset(channelID, twitchAccount.name || req.user?.login || channelID);

            return res.status(200).json({
                error: false,
                message: 'Factory reset completed',
                status: 200,
                data: counts
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

router.delete('/account', authMiddleware as any, async (req: any, res: Response) => {
        try {
            const channelID = req.user?.id;
            if (!channelID) {
                return res.status(401).json({
                    error: true,
                    message: 'Unauthorized',
                    status: 401
                });
            }

            const user = await getUserByTwitchID(channelID);
            if (!user) {
                return res.status(404).json({
                    error: true,
                    message: 'User not found',
                    status: 404
                });
            }

            const twitchAccount = user.accounts.find(acc => acc.type === 'twitch');
            const channelName = twitchAccount?.name || req.user?.login || channelID;

            const counts = await performFactoryReset(channelID, channelName);

            const [
                triggerFilesDelete,
                clipDesignsDelete,
                titleConfigsDelete,
                countdownTimersDelete,
                countdownConfigsDelete,
                commandTimersDelete,
                personalitiesDelete
            ] = await Promise.all([
                TriggerFileSchema.deleteMany({ channelID }),
                ClipDesignSchema.deleteMany({ channelID }),
                TitleConfigSchema.deleteMany({ channelID }),
                CountdownTimerSchema.deleteMany({ channelID }),
                CountdownTimerConfigSchema.deleteMany({ channelID }),
                CommandTimerSchema.deleteMany({ channelID }),
                ChannelAIPersonalitySchema.deleteMany({ channelID })
            ]);

            const [adminsAsAdminDelete, userDelete] = await Promise.all([
                AdminSchema.deleteMany({ adminID: channelID }),
                UsersSchema.deleteOne({
                    _id: user._id,
                    'accounts.id': channelID,
                    'accounts.type': 'twitch'
                })
            ]);

            await TwitchStreamers.updateTwitchAccountsInCache();

            return res.status(200).json({
                error: false,
                message: 'Account and related data deleted permanently',
                status: 200,
                data: {
                    ...counts,
                    triggerFilesDeleted: triggerFilesDelete.deletedCount ?? 0,
                    clipDesignsDeleted: clipDesignsDelete.deletedCount ?? 0,
                    titleConfigsDeleted: titleConfigsDelete.deletedCount ?? 0,
                    countdownTimersDeleted: countdownTimersDelete.deletedCount ?? 0,
                    countdownConfigsDeleted: countdownConfigsDelete.deletedCount ?? 0,
                    commandTimersDeleted: commandTimersDelete.deletedCount ?? 0,
                    personalitiesDeleted: personalitiesDelete.deletedCount ?? 0,
                    adminAssignmentsDeleted: adminsAsAdminDelete.deletedCount ?? 0,
                    usersDeleted: userDelete.deletedCount ?? 0
                }
            });
        } catch (error) {
            console.error('Error in DELETE /auth/account:', {
                userID: req.user?.id,
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

export const authRoute = router;
