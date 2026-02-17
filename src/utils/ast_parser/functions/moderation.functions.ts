import type { ExecutionContext } from '../types.js';
import { registerFunction, type FunctionHandler } from '../evaluator.js';
import * as ChannelFunctions from '../../../functions/channels/index.js';
import * as ChatFunctions from '../../../functions/chats/index.js';
import * as ModerationFunctions from '../../../functions/moderation/index.js';
import * as UserFunctions from '../../../functions/users/index.js';

const BOT_ID = '698614112';

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

const vipHandler: FunctionHandler = async (args, ctx) => {
    if (!checkUserLevel('vip', ctx)) return '';
    
    const user = args.join(' ') || ctx.argument;
    if (!user) return '';
    
    const result = await ChannelFunctions.addChannelVIP(ctx.broadcasterId, user);
    return result.error ? result.message : result.message;
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

const modHandler: FunctionHandler = async (args, ctx) => {
    if (!checkUserLevel('mod', ctx)) return '';
    
    const user = String(args[0] || ctx.argument || '');
    if (!user) return '';
    
    const userResult = await UserFunctions.getTwitchUserByLogin(user.toLowerCase());
    if (userResult.error || !userResult.data) return '';
    
    const result = await ChannelFunctions.addModerator(ctx.broadcasterId, userResult.data.id);
    return result.error || result.status !== 200 ? (result.message || '') : '';
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
    registerFunction('vip', vipHandler);
    registerFunction('unvip', unvipHandler);
    registerFunction('ban', banHandler);
    registerFunction('mod', modHandler);
    registerFunction('unmod', unmodHandler);
    registerFunction('clear.chat', clearChatHandler);
    registerFunction('emoteonly', emoteonlyHandler);
}
