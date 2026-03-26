import { getChannelTtsSettings } from '../../../schemas/channel_tts_settings.schema.js';
import { requestTts } from '../../../functions/chats/speech.chat.js';
import { queueDefaultTts } from '../../../utils/tts/queue_default_tts.util.js';
import { registerFunction, type FunctionHandler } from '../evaluator.js';

function parseRawArgument(args: unknown[], fallback?: string): string {
    if (args.length > 0) {
        return args.map((arg) => String(arg)).join(' ').trim();
    }

    return String(fallback || '').trim();
}

function parseCloneArgument(args: unknown[], fallback?: string): { cloneName: string; message: string } {
    if (args.length > 1) {
        return {
            cloneName: String(args[0] || '').trim(),
            message: args.slice(1).map((arg) => String(arg)).join(' ').trim()
        };
    }

    const raw = String(fallback || '').trim();
    if (!raw) {
        return { cloneName: '', message: '' };
    }

    const [cloneName, ...messageParts] = raw.split(/\s+/).filter(Boolean);
    return {
        cloneName: String(cloneName || '').trim(),
        message: messageParts.join(' ').trim()
    };
}

function isModeAllowed(mode: 'speak' | 'ai' | 'clone', userPlan: 'free' | 'premium' | 'pro'): boolean {
    if (mode === 'speak') {
        return true;
    }

    if (mode === 'ai') {
        return userPlan === 'premium' || userPlan === 'pro';
    }

    return userPlan === 'pro';
}

async function queueTts(
    mode: 'speak' | 'ai' | 'clone',
    message: string,
    ctx: Parameters<FunctionHandler>[1],
    cloneName?: string
): Promise<string> {
    if (mode === 'speak') {
        const result = await queueDefaultTts({
            channelID: ctx.broadcasterId,
            rawMessage: message,
            source: 'ast',
            userID: ctx.userId,
            userLogin: ctx.userLogin,
            userName: ctx.userDisplayName,
            userLevel: ctx.userLevel
        });

        return result.error ? result.message : '';
    }

    const settings = await getChannelTtsSettings(ctx.broadcasterId);

    if (!settings.enabled) {
        return 'TTS is disabled for this channel';
    }

    if (!isModeAllowed(mode, ctx.userPlan)) {
        return 'Your plan does not include this TTS mode';
    }

    const result = await requestTts(ctx.broadcasterId, {
        mode,
        text: message,
        language: settings.defaultLanguage,
        cloneName,
        requestedBy: {
            userID: ctx.userId,
            userLogin: ctx.userLogin,
            userName: ctx.userDisplayName,
            userLevel: ctx.userLevel
        },
        meta: {
            source: 'ast',
            originalText: message,
            skipEmotes: settings.filters.skipEmotes,
            stripLinks: settings.filters.stripLinks
        }
    });

    return result.error ? result.message : '';
}

const ttsSpeakHandler: FunctionHandler = async (args, ctx) => {
    const message = parseRawArgument(args, ctx.argument);
    if (!message) {
        return 'Usage: $(tts message)';
    }

    return await queueTts('speak', message, ctx);
};

const ttsAiHandler: FunctionHandler = async (args, ctx) => {
    const message = parseRawArgument(args, ctx.argument);
    if (!message) {
        return 'Usage: $(tts.ai message)';
    }

    return await queueTts('ai', message, ctx);
};

const ttsCloneHandler: FunctionHandler = async (args, ctx) => {
    const { cloneName, message } = parseCloneArgument(args, ctx.argument);

    if (!cloneName || !message) {
        return 'Usage: $(tts.clone clone_name message)';
    }

    return await queueTts('clone', message, ctx, cloneName);
};

export function registerTtsFunctions(): void {
    registerFunction('tts', ttsSpeakHandler);
    registerFunction('tts.speak', ttsSpeakHandler);
    registerFunction('tts.ai', ttsAiHandler);
    registerFunction('tts.clone', ttsCloneHandler);
}
