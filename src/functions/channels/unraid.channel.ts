import { getTwitchStreamerHeaderById } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';

interface UnraidResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

export async function unraid(channelID: string): Promise<UnraidResponse> {
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

        const response = await fetch(getTwitchHelixUrl('raids', params.toString()), {
            method: 'DELETE',
            headers: {
                'Client-Id': streamerHeader['Client-Id'],
                'Authorization': streamerHeader.Authorization,
                'Content-Type': streamerHeader['Content-Type']
            }
        });

        if (response.status === 204) {
            return { error: false, message: 'Successfully unraided channel!' };
        }

        const data = await response.json();

        return { error: true, message: data.message };
    } catch (error) {
        console.error(`Error in unraid:`, {
            channelID,
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
