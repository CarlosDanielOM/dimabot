import { getDragonflyClient } from '../../utils/databases/dragonfly.database.js';
import { getTwitchUserByLogin } from '../users/index.js';
import { getTwitchUserById } from '../users/index.js';
import { getChannelInformation } from '../channels/index.js';
import { getChannelClips } from '../clips/index.js';
import { showClip } from '../clips/index.js';

interface StreamerChannelInfo {
    game: string;
    title: string;
    login: string;
    name: string;
}

interface PromoResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    data?: {
        streamerChannelInfo?: StreamerChannelInfo;
        clip?: any;
    };
}

export async function promo(
    channelID: string,
    streamerName: string,
    sendClip: boolean = false
): Promise<PromoResponse> {
    try {
        const cacheClient = await getDragonflyClient('promo');

        const streamerDataResult = await getTwitchUserByLogin(streamerName);

        if (streamerDataResult.error || !streamerDataResult.data) {
            console.error(`Error in promo: Failed to get streamer data by login`, {
                channelID,
                streamerName,
                streamerDataResult
            });

            return {
                error: true,
                message: streamerDataResult.message || 'Failed to get streamer data',
                status: streamerDataResult.status,
                type: 'error'
            };
        }

        const streamerData = streamerDataResult.data;

        const broadcasterDataResult = await getTwitchUserById(channelID);

        if (broadcasterDataResult.error || !broadcasterDataResult.data) {
            console.error(`Error in promo: Failed to get broadcaster data`, {
                channelID,
                broadcasterDataResult
            });

            return {
                error: true,
                message: broadcasterDataResult.message || 'Failed to get broadcaster data',
                status: broadcasterDataResult.status,
                type: 'error'
            };
        }

        const broadcasterData = broadcasterDataResult.data;

        const streamerChannelDataResult = await getChannelInformation(streamerData.id, true);

        if (streamerChannelDataResult.error || !streamerChannelDataResult.data) {
            console.error(`Error in promo: Failed to get streamer channel information`, {
                channelID,
                streamerID: streamerData.id,
                streamerChannelDataResult
            });

            return {
                error: true,
                message: streamerChannelDataResult.message || 'Failed to get streamer channel information',
                status: streamerChannelDataResult.status,
                type: 'error'
            };
        }

        const streamerChannelData = streamerChannelDataResult.data;

        const streamerChannelInfo: StreamerChannelInfo = {
            game: streamerChannelData.game_name,
            title: streamerChannelData.title,
            login: streamerChannelData.broadcaster_login,
            name: streamerChannelData.broadcaster_name
        };

        let clipsData = null;
        let clipResult = null;

        if (sendClip) {
            const clipsResult = await getChannelClips(streamerData.id, null, true);

            if (clipsResult.error || !clipsResult.data) {
                console.error(`Error in promo: Failed to get clips`, {
                    channelID,
                    streamerID: streamerData.id,
                    clipsResult
                });

                return {
                    error: true,
                    message: clipsResult.message || 'Failed to get clips',
                    status: clipsResult.status,
                    type: 'error'
                };
            }

            clipsData = clipsResult.data;

            clipResult = await showClip(channelID, clipsData, streamerData, broadcasterData, false);

            if (clipResult.error) {
                console.error(`Error in promo: Failed to show clip`, {
                    channelID,
                    streamerData,
                    broadcasterData,
                    clipResult
                });

                return {
                    error: true,
                    message: clipResult.message || 'Failed to show clip',
                    status: clipResult.status,
                    type: 'error'
                };
            }
        }

        return {
            error: false,
            message: 'Success',
            data: {
                streamerChannelInfo,
                clip: clipResult
            }
        };
    } catch (error) {
        console.error(`Error in promo:`, {
            channelID,
            streamerName,
            sendClip,
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
