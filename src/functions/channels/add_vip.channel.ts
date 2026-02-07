import { getTwitchStreamerHeaderById } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';
import { error as logError } from '../../utils/logger.js';

interface AddVipResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

export async function addChannelVIP(channelID: string, userID: string): Promise<AddVipResponse> {
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
            method: 'POST',
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
    } catch (err) {
        await logError({
            function: 'addChannelVIP',
            channelID,
            userID,
            operation: 'add_channel_vip',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            apiEndpoint: 'channels/vips',
            method: 'POST'
        }, { channelId: channelID, destination: 'both' });

        return {
            error: true,
            message: 'Internal server error',
            type: 'error'
        };
    }
}
