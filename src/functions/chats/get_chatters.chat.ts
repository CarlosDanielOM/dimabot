import { getTwitchStreamerHeaderById } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';

interface GetChattersResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    chatters?: any[];
}

export async function getChatters(
    channelID: string,
    moderatorID: string
): Promise<GetChattersResponse> {
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

        const params = new URLSearchParams();
        params.append('broadcaster_id', channelID);
        params.append('moderator_id', moderatorID);

        const response = await fetch(getTwitchHelixUrl('chat/chatters', params.toString()), {
            headers: streamerHeader as unknown as Record<string, string>
        });

        const data = await response.json();

        if (data.error) {
            return {
                error: true,
                message: data.message,
                status: data.status,
                type: data.error
            };
        }

        return {
            error: false,
            message: 'Success',
            chatters: data.data
        };
    } catch (error) {
        console.error(`Error in getChatters:`, {
            channelID,
            moderatorID,
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
