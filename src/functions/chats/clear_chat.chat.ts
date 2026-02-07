import { getTwitchStreamerHeaderById } from '../../utils/header.js';
import { error as logError } from "../../utils/logger.js";
import { getTwitchHelixUrl } from '../../utils/links.js';

interface ClearChatResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

export async function clearChat(
    channelID: string,
    modID: string
): Promise<ClearChatResponse> {
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
            getTwitchHelixUrl('moderation/chat', `broadcaster_id=${channelID}&moderator_id=${modID}`),
            {
                method: 'DELETE',
                headers: streamerHeader as unknown as Record<string, string>
            }
        );

        if (response.status === 204) {
            return {
                error: false,
                message: 'Chat cleared',
                status: 200
            };
        }

        const data = await response.json();

        if (data.error) {
            return {
                error: true,
                message: data.message,
                status: 400
            };
        }

        return {
            error: false,
            message: 'Chat cleared',
            status: 200
        };
    } catch (err) {
        await logError({ function: 'clearChat',
            channelID,
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
