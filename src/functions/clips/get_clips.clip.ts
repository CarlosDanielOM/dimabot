import { getDragonflyClient } from '../../utils/databases/dragonfly.database.js';
import { error as logError } from "../../utils/logger.js";
import { getTwitchAppHeader } from '../../utils/header.js';
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

interface GetChannelClipsResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    data?: TwitchClip[];
}

export async function getChannelClips(channelID: string, amount: number | null = null, skip_cache: boolean = false): Promise<GetChannelClipsResponse> {
    try {
        const cacheClient = await getDragonflyClient('getChannelClips');
        const cacheKey = `twitch:${channelID}:clips`;

        if (!skip_cache) {
            const cachedData = await cacheClient.get(cacheKey);
            if (cachedData) {
                const parsedData = JSON.parse(cachedData);
                return {
                    error: false,
                    message: 'Success (from cache)',
                    data: parsedData
                };
            }
        }

        const appHeader = await getTwitchAppHeader();

        const params = new URLSearchParams();
        params.append('broadcaster_id', channelID);

        if (amount) {
            params.append('first', String(amount));
        }

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

        await cacheClient.set(cacheKey, JSON.stringify(data.data), { EX: 60 * 60 * 3 });
        return {
            error: false,
            message: 'Success',
            data: data.data
        };
    } catch (err) {
        await logError({ function: 'getChannelClips',
            channelID,
            amount,
            skip_cache,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
        }, { channelId: channelID, destination: 'both' });
        return {
            error: true,
            message: 'Internal server error'
        };
    }
}
