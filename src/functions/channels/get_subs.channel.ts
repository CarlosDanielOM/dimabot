import { getTwitchStreamerHeaderById } from '../../utils/header.js';
import { error as logError } from "../../utils/logger.js";
import { getTwitchHelixUrl } from '../../utils/links.js';

interface GetSubscriptionsResponse {
    error: boolean;
    message: string;
    data?: any[];
    total?: number;
    points?: number;
    status?: number;
    type?: string;
}

export async function getChannelSubscriptions(channelID: string): Promise<GetSubscriptionsResponse> {
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

        const response = await fetch(getTwitchHelixUrl('subscriptions', params.toString()), {
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
            message: 'Successfully fetched subscriptions',
            data: data.data,
            total: data.total,
            points: data.points
        };
    } catch (err) {
        await logError({ function: 'getChannelSubscriptions',
            channelID,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
        }, { channelId: channelID, destination: 'both' });
        return {
            error: true,
            message: 'Internal server error',
            type: 'error'
        };
    }
}
