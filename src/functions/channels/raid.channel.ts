import { getTwitchStreamerHeaderById } from '../../utils/header.js';
import { error as logError } from "../../utils/logger.js";
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
    } catch (err) {
        await logError({ function: 'raid',
            channelID,
            streamerID,
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
