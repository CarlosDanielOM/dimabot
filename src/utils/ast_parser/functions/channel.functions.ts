import type { ExecutionContext } from '../types.js';
import { registerFunction, type FunctionHandler } from '../evaluator.js';
import * as ChannelFunctions from '../../../functions/channels/index.js';
import * as ChatFunctions from '../../../functions/chats/index.js';
import TwitchStreamers from '../../../classes/twitch_streamers.class.js';

const raidHandler: FunctionHandler = async (args, ctx) => {
    const raidTarget = String(args[0] || ctx.argument || '');
    if (!raidTarget) return '';
    
    const raidUserData = await TwitchStreamers.getTwitchAccountById(raidTarget);
    if (!raidUserData) {
        return 'User not found';
    }
    
    const result = await ChannelFunctions.raid(ctx.broadcasterId, raidUserData.id || '');
    return result.error ? (result.message || 'Error raiding channel') : '';
};

const unraidHandler: FunctionHandler = async (_args, ctx) => {
    const result = await ChannelFunctions.unraid(ctx.broadcasterId);
    if (result.error) {
        return `Error cancelling raid: ${result.message}`;
    }
    await ChatFunctions.sendTwitchChatMessage(ctx.broadcasterId, 'Raid cancelled!');
    return '';
};

const setTitleHandler: FunctionHandler = async (args, ctx) => {
    const newTitle = args[0] || '';
    if (!newTitle) {
        return 'Usage: $(set.title new title)';
    }
    const result = await ChannelFunctions.setChannelInformation(ctx.broadcasterId, { title: String(newTitle) });
    if (result.error) {
        return `Error setting title: ${result.message}`;
    }
    await ChatFunctions.sendTwitchChatMessage(ctx.broadcasterId, `Title updated to: ${newTitle}`);
    return '';
};

const setGameHandler: FunctionHandler = async (_args, _ctx) => {
    return '⚠️ This feature is being implemented';
};

const startPredictionHandler: FunctionHandler = async (_args, _ctx) => {
    return '⚠️ This feature is being implemented';
};

const startPollHandler: FunctionHandler = async (_args, _ctx) => {
    return '⚠️ This feature is being implemented';
};

const adHandler: FunctionHandler = async (_args, ctx) => {
    const eventData = ctx.eventData as Record<string, unknown> | undefined;
    if (eventData?.duration_seconds) {
        return String(eventData.duration_seconds) || '0';
    }
    return '0';
};

const aiHandler: FunctionHandler = async (_args, _ctx) => {
    return '⚠️ This feature is being implemented';
};

export function registerChannelFunctions(): void {
    registerFunction('raid', raidHandler);
    registerFunction('unraid', unraidHandler);
    registerFunction('set.title', setTitleHandler);
    registerFunction('set.game', setGameHandler);
    registerFunction('start.prediction', startPredictionHandler);
    registerFunction('start.poll', startPollHandler);
    registerFunction('ad', adHandler);
    registerFunction('ad.time', adHandler);
    registerFunction('ai', aiHandler);
}
