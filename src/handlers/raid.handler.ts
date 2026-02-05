import { handleShoutoutCommand } from '../commands/shoutout.command.js';
import { parseSpecialCommands } from './special_parser.handler.js';
import type { IEventsub } from '../schemas/eventsub.schema.js';

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
            console.log(`Raid skipped - below minimum viewers`, {
                channelID: eventData.to_broadcaster_user_id,
                raidViewers: eventData.viewers,
                minViewers: eventsubData.minViewers
            });

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
            console.error(`Error in raidHandler: Shoutout command failed`, {
                channelID: to_broadcaster_user_id,
                raiderName: from_broadcaster_user_name,
                shoutoutResult
            });

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
    } catch (error) {
        console.error(`Error in raidHandler:`, {
            eventData,
            eventsubData,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });

        return {
            error: true,
            message: 'Internal server error',
            type: 'error'
        };
    }
}
