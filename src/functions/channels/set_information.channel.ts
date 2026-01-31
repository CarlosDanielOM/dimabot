import { getTwitchStreamerHeaderById } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';

interface SetChannelInformationResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

interface NewChannelInformation {
    title?: string;
    game_id?: string;
    broadcaster_language?: string;
}

export async function setChannelInformation(channelID: string, newInformation: NewChannelInformation): Promise<SetChannelInformationResponse> {
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

        const response = await fetch(getTwitchHelixUrl('channels', params.toString()), {
            method: 'PATCH',
            headers: {
                'Client-Id': streamerHeader['Client-Id'],
                'Authorization': streamerHeader.Authorization,
                'Content-Type': streamerHeader['Content-Type']
            },
            body: JSON.stringify(newInformation)
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
            message: 'Channel information modified',
            status: 200
        };
    } catch (error) {
        console.error(`Error in setChannelInformation:`, {
            channelID,
            newInformation,
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
