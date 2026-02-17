import type { ExecutionContext, IStreamerData } from '../types.js';
import { registerFunction, type FunctionHandler } from '../evaluator.js';
import * as ChannelFunctions from '../../../functions/channels/index.js';
import * as ChatFunctions from '../../../functions/chats/index.js';
import TwitchStreamers from '../../../classes/twitch_streamers.class.js';

const subsHandler: FunctionHandler = async (_args, ctx) => {
    const result = await ChannelFunctions.getChannelSubscriptions(ctx.broadcasterId);
    if (result.error) {
        return `Error fetching subscribers: ${result.message}`;
    }
    return String(result.total || 0);
};

const titleHandler: FunctionHandler = async (_args, ctx) => {
    const result = await ChannelFunctions.getChannelInformation(ctx.broadcasterId);
    if (result.error) {
        return `Error fetching channel title: ${result.message}`;
    }
    return result.data?.title || 'No title set';
};

const gameHandler: FunctionHandler = async (_args, ctx) => {
    if (ctx.extraContext?.game) {
        return String(ctx.extraContext.game);
    }
    const result = await ChannelFunctions.getChannelInformation(ctx.broadcasterId);
    if (result.error) {
        return `Error fetching game: ${result.message}`;
    }
    return result.data?.game_name || 'No game set';
};

const viewersHandler: FunctionHandler = async (_args, ctx) => {
    if (ctx.extraContext?.viewers !== undefined) {
        return String(ctx.extraContext.viewers);
    }
    const result = await ChatFunctions.getChatters(ctx.broadcasterId, ctx.broadcasterId);
    if (result.error) {
        return result.message;
    }
    return String(result.chatters?.length || 0);
};

const followsHandler: FunctionHandler = async (_args, ctx) => {
    const result = await ChannelFunctions.getTwitchFollowers(ctx.broadcasterId);
    if (result.error) {
        return `Error fetching followers: ${result.message}`;
    }
    return String(result.total || 0);
};

const channelHandler: FunctionHandler = async (_args, ctx) => {
    const extraContext = ctx.extraContext as Record<string, unknown> | undefined;
    
    if (extraContext?.broadcasterName) {
        return String(extraContext.broadcasterName);
    }
    
    let streamer = ctx.streamer;
    if (!streamer) {
        streamer = await TwitchStreamers.getTwitchAccountById(ctx.broadcasterId) as IStreamerData | null;
    }
    
    if (!streamer) {
        const result = await ChannelFunctions.getChannelInformation(ctx.broadcasterId, true);
        if (result.error) {
            return 'Streamer with provided ID does not exist';
        }
        return result.data.broadcaster_name || 'Unknown';
    }
    
    return streamer.name || 'Unknown';
};

export function registerTwitchFunctions(): void {
    registerFunction('twitch.subs', subsHandler);
    registerFunction('twitch.title', titleHandler);
    registerFunction('twitch.game', gameHandler);
    registerFunction('twitch.viewers', viewersHandler);
    registerFunction('twitch.follows', followsHandler);
    registerFunction('twitch.channel', channelHandler);
}
