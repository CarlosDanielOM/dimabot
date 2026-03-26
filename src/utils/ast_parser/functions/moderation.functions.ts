import type { ExecutionContext } from '../types.js';
import { registerFunction, type FunctionHandler } from '../evaluator.js';
import * as ChannelFunctions from '../../../functions/channels/index.js';
import * as ChatFunctions from '../../../functions/chats/index.js';
import * as ModerationFunctions from '../../../functions/moderation/index.js';
import * as UserFunctions from '../../../functions/users/index.js';
import TwitchStreamers from '../../../classes/twitch_streamers.class.js';
import { VipSchema } from '../../../schemas/vip.schema.js';
import { TemporaryModeratorSchema } from '../../../schemas/temporary_moderator.schema.js';
import { getDragonflyClient } from '../../../utils/databases/dragonfly.database.js';

const BOT_ID = '698614112';
const MAX_TIMEOUT_SECONDS = 604800;
const MAX_TEMP_ROLE_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;
const REMOD_QUEUE_KEY = 'twitch:moderation:banmod:restore:queue';
const REMOD_DATA_KEY_PREFIX = 'twitch:moderation:banmod:restore:data:';

interface IRestoreModJob {
    jobId: string;
    channelID: string;
    userID: string;
    userLogin: string;
    attempts: number;
    executeAt: number;
}

let restoreWorkerStarted = false;
let restoreWorkerRunning = false;

function parseTimeoutSeconds(raw: unknown): number | null {
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        return null;
    }

    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return NaN;
    }

    if (parsed > MAX_TIMEOUT_SECONDS) {
        return NaN;
    }

    return parsed;
}

function parseBooleanFlag(raw: unknown): boolean | null {
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        return null;
    }

    const normalized = String(raw).trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    return null;
}

function moderationUsageError(reason: string): string {
    return `Usage error: ${reason}. Use $(ban.mod user seconds true|false). Seconds must be a positive integer between 1 and ${MAX_TIMEOUT_SECONDS}.`;
}

function createRestoreJobId(channelID: string, userID: string): string {
    return `${channelID}:${userID}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

async function scheduleRestoreModerator(channelID: string, userID: string, userLogin: string, executeAt: number): Promise<boolean> {
    try {
        const cacheClient = await getDragonflyClient('scheduleRestoreModerator');
        const jobId = createRestoreJobId(channelID, userID);
        const dataKey = `${REMOD_DATA_KEY_PREFIX}${jobId}`;

        const payload: IRestoreModJob = {
            jobId,
            channelID,
            userID,
            userLogin,
            attempts: 0,
            executeAt
        };

        await cacheClient.set(dataKey, JSON.stringify(payload), { EX: MAX_TIMEOUT_SECONDS + 86400 });
        await cacheClient.zAdd(REMOD_QUEUE_KEY, {
            score: executeAt,
            value: jobId
        });

        return true;
    } catch (error) {
        console.error('Error scheduling moderator restore job:', {
            channelID,
            userID,
            userLogin,
            executeAt,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
        return false;
    }
}

async function processRestoreModeratorJobs(): Promise<void> {
    if (restoreWorkerRunning) return;
    restoreWorkerRunning = true;

    try {
        const cacheClient = await getDragonflyClient('processRestoreModeratorJobs');
        const now = Date.now();

        const allDueJobs = await cacheClient.zRangeByScore(REMOD_QUEUE_KEY, 0, now);
        const dueJobs = allDueJobs.slice(0, 25);

        for (const jobId of dueJobs) {
            const removed = await cacheClient.zRem(REMOD_QUEUE_KEY, jobId);
            if (removed === 0) continue;

            const dataKey = `${REMOD_DATA_KEY_PREFIX}${jobId}`;
            const jobRaw = await cacheClient.get(dataKey);
            if (!jobRaw) continue;

            let jobData: IRestoreModJob;
            try {
                jobData = JSON.parse(jobRaw) as IRestoreModJob;
            } catch {
                await cacheClient.del(dataKey);
                continue;
            }

            const modStatus = await ModerationFunctions.isTwitchModeratorById(jobData.channelID, jobData.userID);
            if (!modStatus.error && modStatus.isModerator) {
                await cacheClient.del(dataKey);
                continue;
            }

            const addResult = await ChannelFunctions.addModerator(jobData.channelID, jobData.userID);
            if (addResult.status === 200) {
                await cacheClient.del(dataKey);
                continue;
            }

            const nextAttempts = (jobData.attempts || 0) + 1;
            if (nextAttempts >= 5) {
                console.error('Failed to restore moderator after retries:', {
                    channelID: jobData.channelID,
                    userID: jobData.userID,
                    userLogin: jobData.userLogin,
                    attempts: nextAttempts,
                    message: addResult.message,
                    status: addResult.status,
                    timestamp: new Date().toISOString()
                });
                await cacheClient.del(dataKey);
                continue;
            }

            const retryAt = Date.now() + 30000;
            const retryPayload: IRestoreModJob = {
                ...jobData,
                attempts: nextAttempts,
                executeAt: retryAt
            };

            await cacheClient.set(dataKey, JSON.stringify(retryPayload), { EX: MAX_TIMEOUT_SECONDS + 86400 });
            await cacheClient.zAdd(REMOD_QUEUE_KEY, {
                score: retryAt,
                value: jobId
            });
        }
    } catch (error) {
        console.error('Error processing moderator restore jobs:', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
    } finally {
        restoreWorkerRunning = false;
    }
}

function startRestoreModeratorWorker(): void {
    if (restoreWorkerStarted) return;
    restoreWorkerStarted = true;

    processRestoreModeratorJobs().catch((error) => {
        console.error('Error running restore moderator worker bootstrap:', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
    });
    setInterval(() => {
        processRestoreModeratorJobs().catch((error) => {
            console.error('Error running restore moderator worker interval tick:', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString()
            });
        });
    }, 2000);
}

const USER_LEVEL_REQUIREMENTS: Record<string, number> = {
    'ban': 7,
    'vip': 7,
    'unvip': 7,
    'mod': 8,
    'unmod': 8,
    'clear.chat': 7,
    'emoteonly': 7
};

function checkUserLevel(commandName: string, ctx: ExecutionContext): boolean {
    const requiredLevel = USER_LEVEL_REQUIREMENTS[commandName];
    if (requiredLevel === undefined) return true;
    return ctx.userLevel >= requiredLevel;
}

function normalizeLogin(value: unknown): string {
    return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}

function canUseTemporaryRoles(plan: ExecutionContext['userPlan']): boolean {
    return plan === 'premium' || plan === 'pro';
}

function parseTargetAndDays(args: unknown[], fallback?: string): { user: string; daysRaw?: string } {
    if (args.length > 0) {
        const user = normalizeLogin(args[0]);
        const daysRaw = args[1] === undefined || args[1] === null ? undefined : String(args[1]).trim();
        return { user, daysRaw };
    }

    const parts = String(fallback || '').trim().split(/\s+/).filter(Boolean);
    return {
        user: normalizeLogin(parts[0] || ''),
        daysRaw: parts[1]
    };
}

function parseDurationDays(raw?: string): number | null {
    if (!raw) {
        return null;
    }

    const parsed = Number.parseInt(String(raw).trim(), 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_TEMP_ROLE_DAYS) {
        return NaN;
    }

    return parsed;
}

function buildRoleExpiration(days: number): { expireDate: { day: number; month: number; year: number }; expireTimestamp: Date } {
    const expireTime = Date.now() + (days * DAY_MS);
    const expireTimestamp = new Date(expireTime);

    return {
        expireDate: {
            day: expireTimestamp.getDate(),
            month: expireTimestamp.getMonth(),
            year: expireTimestamp.getFullYear()
        },
        expireTimestamp
    };
}

async function getChannelName(ctx: ExecutionContext): Promise<string> {
    if (ctx.streamer?.name) {
        return String(ctx.streamer.name);
    }

    const streamer = await TwitchStreamers.getTwitchAccountById(ctx.broadcasterId);
    return streamer?.name || '';
}

const vipHandler: FunctionHandler = async (args, ctx) => {
    const { user, daysRaw } = parseTargetAndDays(args, ctx.argument);
    if (!user) return 'Usage: $(add.vip user [days])';

    const userResult = await UserFunctions.getTwitchUserByLogin(user);
    if (userResult.error || !userResult.data) {
        return userResult.message || 'User not found';
    }

    const result = await ChannelFunctions.addChannelVIP(ctx.broadcasterId, userResult.data.id);
    if (result.error) {
        return result.message || 'Error adding VIP';
    }

    if (!daysRaw || !canUseTemporaryRoles(ctx.userPlan)) {
        return '';
    }

    const durationDays = parseDurationDays(daysRaw);
    if (Number.isNaN(durationDays)) {
        return `Invalid days value. Days must be between 1 and ${MAX_TEMP_ROLE_DAYS}.`;
    }

    if (!durationDays) {
        return '';
    }

    const { expireDate, expireTimestamp } = buildRoleExpiration(durationDays);
    const channelName = await getChannelName(ctx);

    await VipSchema.findOneAndUpdate({
        channelID: ctx.broadcasterId,
        userID: userResult.data.id
    }, {
        $set: {
            username: userResult.data.login,
            channel: channelName,
            duration: durationDays,
            vip: true,
            expireDate,
            expireTimestamp,
            date: {
                day: new Date().getDate(),
                month: new Date().getMonth(),
                year: new Date().getFullYear()
            }
        },
        $setOnInsert: {
            createdAt: new Date()
        }
    }, {
        upsert: true,
        setDefaultsOnInsert: true
    });

    return '';
};

const unvipHandler: FunctionHandler = async (args, ctx) => {
    if (!checkUserLevel('unvip', ctx)) return '';
    
    const user = args.join(' ') || ctx.argument;
    if (!user) return '';
    
    const userResult = await UserFunctions.getTwitchUserByLogin(user.toLowerCase());
    if (userResult.error || !userResult.data) return '';
    
    const result = await ChannelFunctions.removeChannelVIP(ctx.broadcasterId, userResult.data.id);
    return result.error ? result.message : '';
};

const banHandler: FunctionHandler = async (args, ctx) => {
    if (!checkUserLevel('ban', ctx)) return '';
    
    const user = String(args[0] || ctx.argument || '');
    const duration = args[1] ? parseInt(String(args[1]), 10) : null;
    
    if (!user) return '';
    
    const userResult = await UserFunctions.getTwitchUserByLogin(user.toLowerCase());
    if (userResult.error || !userResult.data) return '';
    
    const result = await ModerationFunctions.ban(
        ctx.broadcasterId,
        userResult.data.id,
        BOT_ID,
        duration,
        'Special command timeout'
    );
    return result.error ? result.message : '';
};

const banModHandler: FunctionHandler = async (args, ctx) => {
    if (!checkUserLevel('ban', ctx)) return '';

    const user = String(args[0] || ctx.argument || '').trim().replace(/^@/, '').toLowerCase();
    console.log('Executing ban.mod special function', {
        channelID: ctx.broadcasterId,
        args: args.map(arg => String(arg)),
        user,
        userLevel: ctx.userLevel,
        timestamp: new Date().toISOString()
    });

    if (!user) {
        return moderationUsageError('Missing target user');
    }

    const parsedDuration = parseTimeoutSeconds(args[1]);
    if (Number.isNaN(parsedDuration)) {
        console.error('ban.mod validation failed: invalid seconds', {
            channelID: ctx.broadcasterId,
            user,
            seconds: args[1],
            timestamp: new Date().toISOString()
        });
        return moderationUsageError('Invalid seconds value');
    }

    const parsedReturnMod = parseBooleanFlag(args[2]);
    if (args[2] !== undefined && parsedReturnMod === null) {
        console.error('ban.mod validation failed: invalid return_mod', {
            channelID: ctx.broadcasterId,
            user,
            returnMod: args[2],
            timestamp: new Date().toISOString()
        });
        return moderationUsageError('return_mod must be true or false');
    }

    const returnMod = parsedReturnMod === true;
    if (returnMod && !parsedDuration) {
        console.error('ban.mod validation failed: return_mod without valid timeout', {
            channelID: ctx.broadcasterId,
            user,
            seconds: args[1],
            returnMod: args[2],
            timestamp: new Date().toISOString()
        });
        return moderationUsageError('return_mod=true requires a valid timeout seconds value');
    }

    const userResult = await UserFunctions.getTwitchUserByLogin(user);
    if (userResult.error || !userResult.data) {
        return 'User not found';
    }

    const targetUserId = userResult.data.id;
    const targetUserLogin = userResult.data.login || user;

    const modStatus = await ModerationFunctions.isTwitchModeratorById(ctx.broadcasterId, targetUserId);
    if (modStatus.error || modStatus.isModerator) {
        await ChannelFunctions.removeChannelModerator(ctx.broadcasterId, targetUserId);
    }

    const banResult = await ModerationFunctions.ban(
        ctx.broadcasterId,
        targetUserId,
        BOT_ID,
        parsedDuration,
        'Special command timeout'
    );

    if (banResult.error) {
        return banResult.message || 'Error applying ban/timeout';
    }

    if (!returnMod || !parsedDuration) {
        return '';
    }

    const restoreAt = Date.now() + ((parsedDuration + 5) * 1000);
    const scheduled = await scheduleRestoreModerator(ctx.broadcasterId, targetUserId, targetUserLogin, restoreAt);
    if (!scheduled) {
        console.error('Failed to schedule restore mod job after timeout:', {
            channelID: ctx.broadcasterId,
            userID: targetUserId,
            userLogin: targetUserLogin,
            duration: parsedDuration,
            restoreAt,
            timestamp: new Date().toISOString()
        });
        return 'Timeout applied, but failed to schedule moderator restore';
    }

    return '';
};

const modHandler: FunctionHandler = async (args, ctx) => {
    const { user, daysRaw } = parseTargetAndDays(args, ctx.argument);
    if (!user) return 'Usage: $(add.mod user [days])';

    const userResult = await UserFunctions.getTwitchUserByLogin(user.toLowerCase());
    if (userResult.error || !userResult.data) return userResult.message || 'User not found';

    const result = await ChannelFunctions.addModerator(ctx.broadcasterId, userResult.data.id);
    if (result.error || result.status !== 200) {
        return result.message || 'Error adding moderator';
    }

    if (!daysRaw || !canUseTemporaryRoles(ctx.userPlan)) {
        return '';
    }

    const durationDays = parseDurationDays(daysRaw);
    if (Number.isNaN(durationDays)) {
        return `Invalid days value. Days must be between 1 and ${MAX_TEMP_ROLE_DAYS}.`;
    }

    if (!durationDays) {
        return '';
    }

    const { expireTimestamp } = buildRoleExpiration(durationDays);
    const channelName = await getChannelName(ctx);

    await TemporaryModeratorSchema.findOneAndUpdate({
        channelID: ctx.broadcasterId,
        userID: userResult.data.id
    }, {
        $set: {
            username: userResult.data.login,
            channel: channelName,
            durationDays,
            expireTimestamp
        },
        $setOnInsert: {
            createdAt: new Date()
        }
    }, {
        upsert: true,
        setDefaultsOnInsert: true
    });

    return '';
};

const unmodHandler: FunctionHandler = async (args, ctx) => {
    if (!checkUserLevel('unmod', ctx)) return '';
    
    const user = args.join(' ') || ctx.argument;
    if (!user) return '';
    
    const userResult = await UserFunctions.getTwitchUserByLogin(user.toLowerCase());
    if (userResult.error || !userResult.data) return '';
    
    const result = await ChannelFunctions.removeChannelModerator(ctx.broadcasterId, userResult.data.id);
    return result.error ? result.message : '';
};

const clearChatHandler: FunctionHandler = async (_args, ctx) => {
    if (!checkUserLevel('clear.chat', ctx)) return '';
    
    const result = await ChatFunctions.clearChat(ctx.broadcasterId, BOT_ID);
    return result.error ? result.message : '';
};

const emoteonlyHandler: FunctionHandler = async (args, ctx) => {
    if (!checkUserLevel('emoteonly', ctx)) return '';
    
    const duration = args[0] ? parseInt(String(args[0]), 10) : null;
    
    const currentSettings = await ChatFunctions.getOnlyEmotes(ctx.broadcasterId, BOT_ID);
    if (currentSettings.error) return '';
    
    const currentMode = currentSettings.data || false;
    const newMode = !currentMode;
    
    const result = await ChatFunctions.setOnlyEmotes(ctx.broadcasterId, newMode, BOT_ID);
    if (result.error) return '';
    
    if (duration && newMode) {
        setTimeout(async () => {
            await ChatFunctions.setOnlyEmotes(ctx.broadcasterId, false, BOT_ID);
        }, duration * 1000);
    }
    
    return '';
};

export function registerModerationFunctions(): void {
    startRestoreModeratorWorker();

    registerFunction('vip', vipHandler);
    registerFunction('add.vip', vipHandler);
    registerFunction('channel.add.vip', vipHandler);
    registerFunction('twitch.add.vip', vipHandler);
    registerFunction('unvip', unvipHandler);
    registerFunction('ban', banHandler);
    registerFunction('ban.mod', banModHandler);
    registerFunction('mod', modHandler);
    registerFunction('add.mod', modHandler);
    registerFunction('channel.add.mod', modHandler);
    registerFunction('twitch.add.mod', modHandler);
    registerFunction('unmod', unmodHandler);
    registerFunction('clear.chat', clearChatHandler);
    registerFunction('emoteonly', emoteonlyHandler);
}
