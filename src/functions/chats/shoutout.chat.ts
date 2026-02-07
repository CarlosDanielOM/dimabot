import { getTwitchBotHeader } from '../../utils/header.js';
import { error as logError } from "../../utils/logger.js";
import { getTwitchHelixUrl } from '../../utils/links.js';

interface SendShoutoutResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

export async function sendShoutout(
    channelID: string,
    streamerID: string,
    moderatorID: string
): Promise<SendShoutoutResponse> {
    try {
        const botHeaderResult = await getTwitchBotHeader();

        if (botHeaderResult.error || !botHeaderResult.header) {
            return {
                error: true,
                message: botHeaderResult.message,
                status: 403,
                type: 'error'
            };
        }

        const botHeader = botHeaderResult.header;

        const params = new URLSearchParams();
        params.append('from_broadcaster_id', channelID);
        params.append('to_broadcaster_id', streamerID);
        params.append('moderator_id', moderatorID);

        const response = await fetch(getTwitchHelixUrl('chat/shoutouts', params.toString()), {
            method: 'POST',
            headers: botHeader as unknown as Record<string, string>
        });

        if (response.status !== 204) {
            const errorData = await response.json();
            return {
                error: true,
                message: errorData.message || 'Failed to send shoutout',
                status: response.status,
                type: errorData.error
            };
        }

        return {
            error: false,
            message: 'Shoutout sent'
        };
    } catch (err) {
        await logError({ function: 'sendShoutout',
            channelID,
            streamerID,
            moderatorID,
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
