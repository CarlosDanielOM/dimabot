import { registerFunction, type FunctionHandler } from '../evaluator.js';
import * as ChannelFunctions from '../../../functions/channels/index.js';
import * as ChatFunctions from '../../../functions/chats/index.js';
import * as UserFunctions from '../../../functions/users/index.js';
import { searchCategories } from '../../../functions/search/index.js';
import { createPrediction } from '../../../functions/predictions/index.js';
import { createPoll } from '../../../functions/polls/index.js';
import TwitchStreamers from '../../../classes/twitch_streamers.class.js';
import { executeAiCommand } from '../../../utils/ai/openrouter/command.ai.js';
import { formatBadges, type IBadge } from '../../../utils/badges.js';

function parseRawArgument(args: unknown[], fallback?: string): string {
    if (args.length > 0) {
        return args.map(arg => String(arg)).join(' ').trim();
    }
    return String(fallback || '').trim();
}

const raidHandler: FunctionHandler = async (args, ctx) => {
    const raidTarget = (parseRawArgument(args, ctx.argument).split(/\s+/)[0] || '').replace(/^@/, '').toLowerCase();
    if (!raidTarget) return '';

    const raidUserResult = await UserFunctions.getTwitchUserByLogin(raidTarget);
    let targetUserId = raidUserResult.data?.id || '';

    if (!targetUserId) {
        const raidUserData = await TwitchStreamers.getTwitchAccountById(raidTarget);
        if (raidUserData?.id) {
            targetUserId = raidUserData.id;
        }
    }

    if (!targetUserId) {
        return 'User not found';
    }

    const result = await ChannelFunctions.raid(ctx.broadcasterId, targetUserId);
    return result.error || (result.status && result.status >= 400)
        ? (result.message || 'Error raiding channel')
        : '';
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
    const newTitle = parseRawArgument(args, ctx.argument);
    if (!newTitle) {
        return 'Usage: $(set.title new title)';
    }
    const result = await ChannelFunctions.setChannelInformation(ctx.broadcasterId, { title: newTitle });
    if (result.error) {
        return `Error setting title: ${result.message}`;
    }
    await ChatFunctions.sendTwitchChatMessage(ctx.broadcasterId, `Title updated to: ${newTitle}`);
    return '';
};

const setGameHandler: FunctionHandler = async (args, ctx) => {
    const gameQuery = parseRawArgument(args, ctx.argument);
    if (!gameQuery) {
        return 'Usage: $(set.game game name)';
    }

    const gameSearchResult = await searchCategories(gameQuery);
    if (gameSearchResult.error || !gameSearchResult.data || gameSearchResult.data.length === 0) {
        return `Error finding game: ${gameSearchResult.message || 'Game not found'}`;
    }

    const selectedGame = gameSearchResult.data.find(
        game => game.name.toLowerCase() === gameQuery.toLowerCase()
    ) || gameSearchResult.data[0];

    const result = await ChannelFunctions.setChannelInformation(ctx.broadcasterId, { game_id: selectedGame.id });
    if (result.error) {
        return `Error setting game: ${result.message}`;
    }

    await ChatFunctions.sendTwitchChatMessage(ctx.broadcasterId, `Game updated to: ${selectedGame.name}`);
    return '';
};

const startPredictionHandler: FunctionHandler = async (args, ctx) => {
    const rawInput = parseRawArgument(args, ctx.argument);
    if (!rawInput) {
        return 'Usage: $(start.prediction title;option1/option2;seconds)';
    }

    const [title = '', optionsRaw = '', durationRaw = ''] = rawInput.split(';').map(part => part.trim());
    const options = optionsRaw
        .split('/')
        .map(option => option.trim())
        .filter(Boolean)
        .map(option => ({ title: option }));
    const duration = Number(durationRaw);

    if (!title || options.length < 2 || isNaN(duration) || duration <= 0) {
        return 'Invalid prediction format. Use: title;option1/option2;seconds';
    }

    const result = await createPrediction(ctx.broadcasterId, title, options, duration);
    return result.error ? `Error starting prediction: ${result.message}` : '';
};

const startPollHandler: FunctionHandler = async (args, ctx) => {
    const rawInput = parseRawArgument(args, ctx.argument);
    if (!rawInput) {
        return 'Usage: $(start.poll title;option1/option2;seconds)';
    }

    const [title = '', optionsRaw = '', durationRaw = ''] = rawInput.split(';').map(part => part.trim());
    const options = optionsRaw
        .split('/')
        .map(option => option.trim())
        .filter(Boolean)
        .map(option => ({ title: option }));
    const duration = Number(durationRaw);

    if (!title || options.length < 2 || isNaN(duration) || duration <= 0) {
        return 'Invalid poll format. Use: title;option1/option2;seconds';
    }

    const result = await createPoll(ctx.broadcasterId, title, options, duration);
    return result.error ? `Error starting poll: ${result.message}` : '';
};

const adHandler: FunctionHandler = async (_args, ctx) => {
    const eventData = ctx.eventData as Record<string, unknown> | undefined;
    if (eventData?.duration_seconds) {
        return String(eventData.duration_seconds) || '0';
    }
    return '0';
};

const aiHandler: FunctionHandler = async (args, ctx) => {
    const prompt = parseRawArgument(args, ctx.argument);
    if (!prompt) {
        return '[AI: No prompt provided]';
    }

    const streamer = await TwitchStreamers.getTwitchAccountById(ctx.broadcasterId);
    if (!streamer) {
        return '[AI: Streamer context unavailable]';
    }

    const eventData = ctx.eventData as { badges?: IBadge[] } | undefined;
    const badgeFormatting = await formatBadges({
        badges: Array.isArray(eventData?.badges) ? eventData.badges : []
    });

    const result = await executeAiCommand({
        ...streamer,
        user_id: streamer.id
    }, {
        username: ctx.userDisplayName || ctx.userLogin || 'unknown user',
        badges: badgeFormatting.formattedBadges
    }, prompt, 'ast_parser');

    return result.message;
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
