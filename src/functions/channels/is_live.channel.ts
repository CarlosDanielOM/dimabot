import TwitchStreamers from '../../classes/twitch_streamers.class.js';
import { getTwitchAppHeader } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';

interface LiveChannelsResponse {
    error: boolean;
    message?: string;
    data?: any[];
    status?: number;
    type?: string;
}

export async function isLive(channelID: string): Promise<LiveChannelsResponse> {
    return {
        error: true,
        message: 'Not implemented yet'
    };
}

export async function liveChannels(): Promise<LiveChannelsResponse> {
    try {
        const streamerIds = await TwitchStreamers.getTwitchStreamers();
        const botHeader = await getTwitchAppHeader();
        const params = new URLSearchParams({
            type: 'live'
        });

        if (streamerIds.length > 0 && streamerIds.length < 100) {
            for (let i = 0; i < streamerIds.length; i++) {
                params.append('user_id', streamerIds[i]);
            }
        } else {
            return {
                error: true,
                message: 'Too many streamers to check',
                status: 400,
                type: 'too_many_streamers'
            };
        }

        const response = await fetch(getTwitchHelixUrl('streams', params.toString()), {
            headers: {
                'Client-Id': botHeader['Client-Id'],
                'Authorization': botHeader.Authorization,
                'Content-Type': botHeader['Content-Type']
            }
        });

        const data = await response.json();

        if (data.error) {
            return {
                error: true,
                message: data.message
            };
        }

        return {
            error: false,
            data: data.data
        };
    } catch (error) {
        console.error(`Error in liveChannels:`, {
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
