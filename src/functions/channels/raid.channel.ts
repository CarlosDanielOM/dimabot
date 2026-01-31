import { getTwitchStreamerHeaderById } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';

interface RaidResponse {
    error?: boolean;
    message?: string;
    status?: number;
    type?: string;
    [key: string]: any;
}

export async function raid(channelID: string, streamerID: string): Promise<RaidResponse> {
    try {
        const params = new URLSearchParams();
        params.append('from_broadcaster_id', channelID);
        params.append('to_broadcaster_id', streamerID);

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

        const response = await fetch(getTwitchHelixUrl('raids', params.toString()), {
            method: 'POST',
            headers: {
                'Client-Id': streamerHeader['Client-Id'],
                'Authorization': streamerHeader.Authorization,
                'Content-Type': streamerHeader['Content-Type']
            }
        });

        const data = await response.json();

        return data;
    } catch (error) {
        console.error(`Error in raid:`, {
            channelID,
            streamerID,
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
