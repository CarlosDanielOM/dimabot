import { commandHandler } from '../handlers/commands.handler.js';

const TIMER_REFERENCE_PATTERN = /#\(([\w]+)(?:\s+([^)]*))?\)/g;

export interface ITimerReferenceResolveResult {
    parsedMessage: string;
    hadReferences: boolean;
}

interface IFakeEventData extends Record<string, unknown> {
    chatter_user_id: string;
    chatter_user_login: string;
    chatter_user_name: string;
    badges: unknown[];
}

async function replaceAsync(
    str: string,
    regex: RegExp,
    replacerFn: (match: string, ...args: string[]) => Promise<string>
): Promise<string> {
    const promises: Promise<string>[] = [];

    str.replace(regex, (match, ...args) => {
        const extracted = args.slice(0, -2) as string[];
        promises.push(replacerFn(match, ...extracted));
        return match;
    });

    const results = await Promise.all(promises);
    let index = 0;
    return str.replace(regex, () => results[index++] || '');
}

export async function resolveTimerReferences(
    message: string,
    channelID: string,
    streamerName: string
): Promise<ITimerReferenceResolveResult> {
    let hadReferences = false;

    const parsedMessage = await replaceAsync(message, TIMER_REFERENCE_PATTERN, async (_match, commandName, args) => {
        hadReferences = true;

        try {
            const trimmedCommand = String(commandName || '').trim().toLowerCase();
            const trimmedArgs = String(args || '').trim();

            const fakeEventData: IFakeEventData = {
                chatter_user_id: channelID,
                chatter_user_login: streamerName.toLowerCase(),
                chatter_user_name: streamerName,
                badges: []
            };

            const result = await commandHandler(
                channelID,
                fakeEventData,
                trimmedCommand,
                trimmedArgs || undefined
            );

            if (result.error || !result.message) {
                return '';
            }

            return result.message;
        } catch (error) {
            console.error('Error resolving timer reference:', {
                channelID,
                commandName,
                args,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString()
            });
            return '';
        }
    });

    const cleanedMessage = parsedMessage
        .replace(/\s+/g, ' ')
        .trim();

    return {
        parsedMessage: cleanedMessage,
        hadReferences
    };
}

export function getTierFrequencyLimits(tier: string): { min: number; max: number } {
    switch (tier) {
        case 'pro':
            return { min: 1, max: 288 };
        case 'premium':
            return { min: 1, max: 72 };
        case 'free':
        default:
            return { min: 1, max: 12 };
    }
}

export function getTierTimerLimit(tier: string): number {
    switch (tier) {
        case 'pro':
            return 50;
        case 'premium':
            return 15;
        case 'free':
        default:
            return 5;
    }
}

export function frequencyToMinutes(frequency: number): number {
    return frequency * 5;
}

export function minutesToFrequency(minutes: number): number {
    return Math.round(minutes / 5);
}
