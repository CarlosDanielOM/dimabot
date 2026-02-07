import { getTwitchAppHeader } from '../../utils/header.js';
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

interface GetClipResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    data?: TwitchClip;
}

export async function getClip(clipID: string): Promise<GetClipResponse> {
    try {
        const appHeader = await getTwitchAppHeader();

        if (!clipID) {
            return {
                error: true,
                message: 'Clip ID is required',
                status: 400,
                type: 'clip_id_required'
            };
        }

        const params = new URLSearchParams();
        params.append('id', clipID);

        const response = await fetch(getTwitchHelixUrl('clips', params.toString()), {
            headers: appHeader as unknown as Record<string, string>
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

        if (data.data.length === 0) {
            return {
                error: true,
                message: 'Clip not found',
                status: 404,
                type: 'clip_not_found'
            };
        }

        return {
            error: false,
            message: 'Success',
            data: data.data[0]
        };
    } catch (err) {
        await logError({ function: 'getClip',
            clipID,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
        }, { destination: 'both' });
        return {
            error: true,
            message: 'Internal server error'
        };
    }
}
