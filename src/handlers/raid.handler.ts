import { handleShoutoutCommand } from '../commands/shoutout.command.js';
import { parseSpecialCommands } from './special_parser.handler.js';
import type { IEventsub } from '../schemas/eventsub.schema.js';
import { info as logInfo, error as logError } from '../utils/logger.js';

interface RaidEventData {
    to_broadcaster_user_id: string;
    to_broadcaster_user_login: string;
    to_broadcaster_user_name: string;
    from_broadcaster_user_id: string;
    from_broadcaster_user_login: string;
    from_broadcaster_user_name: string;
    viewers: number;
}

interface RaidHandlerResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

const modID = '698614112';

export async function raidHandler(
    eventData: RaidEventData,
    eventsubData: IEventsub
): Promise<RaidHandlerResponse> {
    try {
        if (eventsubData.minViewers > eventData.viewers) {
            await logInfo({
                message: 'Raid skipped - below minimum viewers',
                channelID: eventData.to_broadcaster_user_id,
                raidViewers: eventData.viewers,
                minViewers: eventsubData.minViewers
            }, { channelId: eventData.to_broadcaster_user_id, destination: 'both' });

            return {
                error: false,
                message: 'Raid skipped - below minimum viewers'
            };
        }

        const { to_broadcaster_user_id, from_broadcaster_user_name } = eventData;

        // Get raw message template (may contain special commands like $(user), $(twitch.game), etc.)
        const rawMessage = eventsubData.message || `Check out $(user) at https://twitch.tv/$(user) and give them a follow! They were last playing $(twitch.game)`;

        // Parse special commands in the message
        // The parser will auto-extract user info, broadcaster info, and viewers from eventData
        const parsedResult = await parseSpecialCommands(rawMessage, {
            channelID: to_broadcaster_user_id,
            eventData: eventData,
            eventsubData: eventsubData
        });

        const parsedMessage = parsedResult.parsedText;

        // Call the shoutout command with the parsed message
        const shoutoutResult = await handleShoutoutCommand(
            to_broadcaster_user_id,
            from_broadcaster_user_name,
            'purple',
            modID,
            eventsubData.clipEnabled,
            parsedMessage
        );

        if (shoutoutResult.error) {
            await logError({
                function: 'raidHandler.shoutout',
                channelID: to_broadcaster_user_id,
                raiderName: from_broadcaster_user_name,
                shoutoutResult
            }, { channelId: to_broadcaster_user_id, destination: 'both' });

            return {
                error: true,
                message: shoutoutResult.message || 'Failed to handle shoutout',
                status: shoutoutResult.status,
                type: 'error'
            };
        }

        return {
            error: false,
            message: 'Raid handled successfully'
        };
    } catch (err) {
        await logError({
            function: 'raidHandler',
            eventData,
            eventsubData,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
        }, { channelId: eventData.to_broadcaster_user_id, destination: 'both' });

        return {
            error: true,
            message: 'Internal server error',
            type: 'error'
        };
    }
}
