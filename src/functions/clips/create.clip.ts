import { getTwitchBotHeader } from '../../utils/header.js';
import { error as logError } from "../../utils/logger.js";
import { getTwitchHelixUrl } from '../../utils/links.js';

interface TwitchClip {
    id: string;
    url: string;
    embed_url: string;
    broadcaster_id: string;
    creator_id: string;
    video_id: string;
    created_at: string;
    thumbnail_url: string;
    duration: number;
    vod_offset: number | null;
    is_mutable: boolean;
}

interface CreateClipResponse {
    error?: boolean;
    message?: string;
    status?: number;
    type?: string;
    clipID?: string;
}

export async function createClip(channelID: string): Promise<CreateClipResponse> {
    try {
        const botHeaderResult = await getTwitchBotHeader();

        if (botHeaderResult.error || !botHeaderResult.header) {
            return {
                error: true,
                message: botHeaderResult.message,
                status: 403,
                type: 'permission_error'
            };
        }

        const botHeader = botHeaderResult.header;

        const params = new URLSearchParams();
        params.append('broadcaster_id', channelID);

        const response = await fetch(getTwitchHelixUrl('clips', params.toString()), {
            method: 'POST',
            headers: botHeader as unknown as Record<string, string>
        });
        if (response.status === 404) {
            return {
                error: true,
                message: 'Broadcaster must be live to create a clip',
                status: 404,
                type: 'broadcaster_not_live'
            };
        }

        if (response.status !== 202) {
            const errorData = await response.json();
            return {
                error: true,
                message: errorData.message,
                status: response.status,
                type: errorData.error
            };
        }

        const data = await response.json();

        if (!data.data || data.data.length === 0) {
            return {
                error: true,
                message: 'Twitch accepted clip request but did not return a clip ID.',
                status: 500,
                type: 'clip_id_missing'
            };
        }

        return {
            error: false,
            message: 'Clip created',
            status: 202,
            type: 'success',
            clipID: data.data[0].id
        };
    } catch (err) {
        await logError({ function: 'createClip',
            channelID,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
        }, { channelId: channelID, destination: 'both' });
        return {
            error: true,
            message: 'Internal server error',
            type: 'error'
        };
    }
}
