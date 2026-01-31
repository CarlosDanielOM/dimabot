import { getTwitchStreamerHeaderById } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';

interface RemoveModeratorResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

export async function removeChannelModerator(channelID: string, userID: string): Promise<RemoveModeratorResponse> {
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

        const params = new URLSearchParams();
        params.append('broadcaster_id', channelID);
        params.append('user_id', userID);

        const response = await fetch(getTwitchHelixUrl('moderation/moderators', params.toString()), {
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
            message: 'Moderator removed',
            status: 200,
            type: 'success'
        };
    } catch (error) {
        console.error(`Error in removeChannelModerator:`, {
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
