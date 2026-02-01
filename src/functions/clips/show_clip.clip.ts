import { getUserColor } from '../chats/index.js';
import { searchGameById } from '../search/index.js';
import { requestClip, checkClipConnection, generateRandomClipID } from './queue.clip.js';

interface ClipData {
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
    game_id: string;
    title: string;
    user_id: string;
    user_login: string;
    user_name: string;
    profile_image_url: string;
    description: string;
}

interface ShowClipResponse {
    error?: boolean;
    message?: string;
    status?: number;
    type?: string;
}

export async function showClip(channelID: string, clipData: any[], streamerData: any, streamerChannelData: any, sendToQueue: boolean = false): Promise<ShowClipResponse> {
    try {
        if (!clipData || !streamerData || !streamerChannelData) {
            console.error(`Error in showClip: Missing parameters`, {
                channelID
            });

            return {
                error: true,
                message: 'Missing parameters',
                status: 400,
                type: 'missing_parameters'
            };
        }

        const streamerID = streamerData.id;

        const streamerColorResult = await getUserColor(streamerID);

        if (streamerColorResult.error || !streamerColorResult.color) {
            console.error(`Error in showClip: Failed to get streamer color`, {
                channelID,
                streamerID,
                streamerColorResult
            });

            return {
                error: true,
                message: 'Failed to get streamer color',
                status: streamerColorResult.status,
                type: 'error'
            };
        }

        const streamerColor = streamerColorResult.color;

        const randomClipNumber = Math.floor(Math.random() * clipData.length);
        const randomClip = clipData[randomClipNumber];

        if (!randomClip) {
            console.error(`Error in showClip: Clip not found`, {
                channelID
            });

            return {
                error: true,
                message: 'Clip not found',
                status: 404,
                type: 'clip_not_found'
            };
        }

        const duration = randomClip.duration || null;
        const clipUrl = randomClip.url || null;

        if (!duration || !clipUrl) {
            console.error(`Error in showClip: Missing clip duration or URL`, {
                channelID
            });

            return {
                error: true,
                message: 'Missing clip duration or URL',
                status: 400,
                type: 'missing_parameters'
            };
        }

        const clipGameResult = await searchGameById(randomClip.game_id);

        if (clipGameResult.error || !clipGameResult.data) {
            console.error(`Error in showClip: Game data missing`, {
                channelID,
                gameID: randomClip.game_id
            });

            return {
                error: true,
                message: 'Game data missing',
                status: 500,
                type: 'game_data_missing'
            };
        }

        let gameData: any;
        if (clipGameResult.data) {
            gameData = clipGameResult.data;
        } else {
            console.error(`Error in showClip: Game data is undefined`, {
                channelID,
                gameID: randomClip.game_id
            });

            return {
                error: true,
                message: 'Game data is undefined',
                status: 500,
                type: 'game_data_undefined'
            };
        }

        const connectionResult = await checkClipConnection(channelID);

        if (!connectionResult.connected) {
            console.log(`showClip skipped - OBS not connected for channel ${channelID}`);
            return {
                error: false,
                message: 'Skipped - OBS not connected'
            };
        }

        const clipID = generateRandomClipID();

        const clipRequestData = {
            clipID: clipID,
            streamerLogin: streamerData.login,
            duration: duration,
            clipUrl: clipUrl,
            title: streamerChannelData.title,
            game: gameData.name,
            streamer: streamerData.display_name,
            profileImage: streamerData.profile_image_url,
            description: streamerData.description,
            streamerColor: streamerColor,
            timestamp: Date.now()
        };

        await requestClip(channelID, streamerData.login, clipRequestData, sendToQueue);

        return {
            error: false,
            message: sendToQueue ? 'Clip queued and processing' : 'Clip queued'
        };
    } catch (error) {
        console.error(`Error in showClip:`, {
            channelID,
            clipData,
            streamerData,
            streamerChannelData,
            sendToQueue,
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
