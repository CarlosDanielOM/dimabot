import { getTwitchStreamerHeaderById } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';

interface RemoveVipResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

export async function removeChannelVIP(channelID: string, userID: string): Promise<RemoveVipResponse> {
    try {
        const streamerHeaderResult = await getTwitchStreamerHeaderById(channelID);

        if (streamerHeaderResult.error || !streamerHeaderResult.header) {
            return {
                error: true,
                message: streamerHeaderResult.message,
                status: 403,
                type: 'permission_error'
            };
        }

        const streamerHeader = streamerHeaderResult.header;

        const params = new URLSearchParams({
            user_id: userID,
            broadcaster_id: channelID
        });

        const response = await fetch(getTwitchHelixUrl('channels/vips', params.toString()), {
            method: 'DELETE',
            headers: {
                'Client-Id': streamerHeader['Client-Id'],
                'Authorization': streamerHeader.Authorization,
                'Content-Type': streamerHeader['Content-Type']
            }
        });

        if (response.status !== 204) {
            const errorData = await response.json();
            return {
                error: true,
                message: errorData.message,
                status: errorData.status,
                type: errorData.error
            };
        }

        return {
            error: false,
            message: 'Success',
            status: 200
        };
    } catch (error) {
        console.error(`Error in removeChannelVIP:`, {
            channelID,
            userID,
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
