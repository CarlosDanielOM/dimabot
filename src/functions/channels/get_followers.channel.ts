import { getTwitchStreamerHeaderById } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';
import { error as logError } from '../../utils/logger.js';

interface GetFollowersResponse {
    error: boolean;
    message: string;
    data?: any[];
    total?: number;
    status?: number;
    type?: string;
}

export async function getTwitchFollowers(channelID: string, userId: string | null = null): Promise<GetFollowersResponse> {
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
            broadcaster_id: channelID
        });

        const response = await fetch(getTwitchHelixUrl('channels/followers', params.toString()), {
            method: 'GET',
            headers: {
                'Client-Id': streamerHeader['Client-Id'],
                'Authorization': streamerHeader.Authorization,
                'Content-Type': streamerHeader['Content-Type']
            }
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
            message: 'Successfully fetched followers',
            data: data.data ?? [],
            total: data.total ?? 0
        };
    } catch (err) {
        await logError({
            function: 'getTwitchFollowers',
            channelID,
            userId,
            operation: 'get_channel_followers',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            apiEndpoint: 'channels/followers',
            method: 'GET'
        }, { channelId: channelID, destination: 'both' });

        return {
            error: true,
            message: 'Internal server error',
            type: 'error'
        };
    }
}
