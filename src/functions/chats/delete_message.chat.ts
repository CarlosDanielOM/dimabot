import { getTwitchStreamerHeaderById } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';

interface DeleteMessageResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

export async function deleteMessage(
    messageID: string,
    channelID: string,
    modID: string
): Promise<DeleteMessageResponse> {
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
            getTwitchHelixUrl('moderation/chat', `broadcaster_id=${channelID}&message_id=${messageID}&moderator_id=${modID}`),
            {
                method: 'DELETE',
                headers: streamerHeader as unknown as Record<string, string>
            }
        );

        if (response.status === 204) {
            return {
                error: false,
                message: 'Message deleted'
            };
        }

        const data = await response.json();

        if (data.error) {
            return {
                error: true,
                message: data.error,
                status: response.status
            };
        }

        return {
            error: false,
            message: 'Message deleted'
        };
    } catch (error) {
        console.error(`Error in deleteMessage:`, {
            messageID,
            channelID,
            modID,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });

        return {
            error: true,
            message: 'Internal server error',
            status: 500,
            type: 'error'
        };
    }
}
