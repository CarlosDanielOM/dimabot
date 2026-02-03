import { getTwitchUserByLogin } from '../functions/users/index.js';
import { getChannelInformation } from '../functions/channels/index.js';
import { promo } from '../functions/promo/index.js';
import { sendAnnouncement } from '../functions/chats/index.js';
import { sendShoutout } from '../functions/chats/index.js';
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

        const streamerDataResult = await getTwitchUserByLogin(from_broadcaster_user_name);

        if (streamerDataResult.error || !streamerDataResult.data) {
            console.error(`Error in raidHandler: Failed to get raider data`, {
                channelID: to_broadcaster_user_id,
                raiderName: from_broadcaster_user_name,
                streamerDataResult
            });

            return {
                error: true,
                message: streamerDataResult.message || 'Failed to get raider data',
                status: streamerDataResult.status,
                type: 'error'
            };
        }

        const streamerData = streamerDataResult.data;

        const raiderChannelDataResult = await getChannelInformation(streamerData.id, true);

        if (raiderChannelDataResult.error || !raiderChannelDataResult.data) {
            console.error(`Error in raidHandler: Failed to get raider channel information`, {
                channelID: to_broadcaster_user_id,
                raiderID: streamerData.id,
                raiderChannelDataResult
            });

            return {
                error: true,
                message: raiderChannelDataResult.message || 'Failed to get raider channel information',
                status: raiderChannelDataResult.status,
                type: 'error'
            };
        }

        const raiderChannelData = raiderChannelDataResult.data;

        const raiderChannel = {
            name: raiderChannelData.broadcaster_name,
            login: raiderChannelData.broadcaster_login,
            game: raiderChannelData.game_name
        };

        const promoResult = await promo(
            to_broadcaster_user_id,
            from_broadcaster_user_name,
            eventsubData.clipEnabled
        );

        if (promoResult.error) {
            console.error(`Error in raidHandler: Promo failed`, {
                channelID: to_broadcaster_user_id,
                raiderName: from_broadcaster_user_name,
                promoResult
            });

            return {
                error: true,
                message: promoResult.message || 'Failed to process promo',
                status: promoResult.status,
                type: 'error'
            };
        }

        // Get raw message template (may contain special commands like $(user), $(twitch.game), etc.)
        const rawMessage = eventsubData.message || `Check out ${raiderChannel.name} at https://twitch.tv/${raiderChannel.login} and give them a follow! They were last playing ${raiderChannel.game}`;

        // Parse special commands in the message
        // The parser will auto-extract user info, broadcaster info, and viewers from eventData
        // We only need to pass game in extraContext since it comes from an API call
        const parsedResult = await parseSpecialCommands(rawMessage, {
            channelID: to_broadcaster_user_id,
            eventData: eventData,
            eventsubData: eventsubData,
            extraContext: {
                game: raiderChannel.game
            }
        });

        const message = parsedResult.parsedText;

        const announcementResult = await sendAnnouncement(
            to_broadcaster_user_id,
            modID,
            message,
            'purple'
        );

        if (announcementResult.error) {
            console.error(`Error in raidHandler: Failed to send announcement`, {
                channelID: to_broadcaster_user_id,
                message,
                announcementResult
            });

            return {
                error: true,
                message: message || 'Failed to send announcement',
                status: announcementResult.status,
                type: 'error'
            };
        }

        const shoutoutResult = await sendShoutout(
            to_broadcaster_user_id,
            streamerData.id,
            modID
        );

        if (shoutoutResult.error) {
            console.error(`Error in raidHandler: Failed to send shoutout`, {
                channelID: to_broadcaster_user_id,
                streamerID: streamerData.id,
                shoutoutResult
            });

            return {           
                error: true,
                message: shoutoutResult.message || 'Failed to send shoutout',
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
