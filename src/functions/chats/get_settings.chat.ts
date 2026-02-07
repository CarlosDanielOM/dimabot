import { getTwitchStreamerHeaderById } from '../../utils/header.js';
import { error as logError } from "../../utils/logger.js";
import { getTwitchHelixUrl } from '../../utils/links.js';

interface GetChatSettingsResponse {
    error: boolean;
    message: string;
    data?: any;
    status?: number;
    type?: string;
}

export async function getChatSettings(
    channelID: string,
    modId: string = '698614112'
): Promise<GetChatSettingsResponse> {
    try {
        const streamerHeaderResult = await getTwitchStreamerHeaderById(channelID);

        if (streamerHeaderResult.error || !streamerHeaderResult.header) {
            return {
                error: true,
                message: streamerHeaderResult.message,
                status: 403
            };
        }

        const streamerHeader = streamerHeaderResult.header;

        const response = await fetch(
            getTwitchHelixUrl('chat/settings', `broadcaster_id=${channelID}&moderator_id=${modId}`),
            {
                headers: streamerHeader as unknown as Record<string, string>
            }
        );

        const data = await response.json();

        if (data.error) {
            return {
                error: true,
                data: data,
                status: 400,
                message: "Error getting chat settings"
            };
        }

        const chatSettings = data.data[0];

        return {
            error: false,
            data: chatSettings,
            status: 200,
            message: "success"
        };
    } catch (err) {
        await logError({ function: 'getChatSettings',
            channelID,
            modId,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
        });

        return {
            error: true,
            message: 'Internal server error'
        };
    }
}
