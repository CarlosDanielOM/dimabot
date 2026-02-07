import { getTwitchStreamerHeaderById } from '../../utils/header.js';
import { error as logError } from "../../utils/logger.js";
import { getTwitchHelixUrl } from '../../utils/links.js';

interface SetOnlyEmotesResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    data?: any;
}

export async function setOnlyEmotes(
    channelID: string,
    emotes: boolean = true,
    modID: string = '698614112'
): Promise<SetOnlyEmotesResponse> {
    try {
        const streamerHeaderResult = await getTwitchStreamerHeaderById(channelID);

        if (streamerHeaderResult.error || !streamerHeaderResult.header) {
            return {
                error: true,
                message: streamerHeaderResult.message,
                status: 403,
                type: 'error'
            };
        }

        const streamerHeader = streamerHeaderResult.header;

        const response = await fetch(
            getTwitchHelixUrl('chat/settings', `broadcaster_id=${channelID}&moderator_id=${modID}`),
            {
                method: 'PATCH',
                headers: streamerHeader as unknown as Record<string, string>,
                body: JSON.stringify({
                    emote_mode: emotes
                })
            }
        );

        const data = await response.json();

        if (data.error) {
            return {
                error: true,
                type: data.error,
                message: data.message,
                status: data.status
            };
        }

        const chatSettings = data.data[0];

        return {
            error: false,
            message: 'Success',
            status: 200,
            data: chatSettings
        };
    } catch (err) {
        await logError({ function: 'setOnlyEmotes',
            channelID,
            emotes,
            modID,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
        });

        return {
            error: true,
            message: 'Internal server error',
            status: 500,
            type: 'error'
        };
    }
}
