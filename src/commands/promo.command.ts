import { getChannelInformation } from '../functions/channels/index.js';
import { getChannelClips, showClip } from '../functions/clips/index.js';
import { getTwitchUserByLogin, getTwitchUserById } from '../functions/users/index.js';
import { getDragonflyClient } from '../utils/databases/dragonfly.database.js';

interface PromoResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    where?: string;
    streamerChannelInfo?: any;
    clip?: any;
}

export async function promoCommand(channelID: string, streamerName: string, sendClip: boolean = false): Promise<PromoResponse> {
    try {
        const cacheClient = await getDragonflyClient('promoCommand');

        if (!sendClip) {
            const clipConnected = await cacheClient.get(`${channelID}:clip:connected`);
            if (clipConnected) {
                const queueExists = await cacheClient.exists(`${channelID}:clips:queue`);
                await cacheClient.rPush(`${channelID}:clips:queue`, streamerName);
                if (!queueExists) {
                    const clipPlaying = await cacheClient.exists(`${channelID}:clip:playing`);
                    if (!clipPlaying) {
                        await cacheClient.set(`${channelID}:clip:playing`, "true");
                        await cacheClient.set(`${channelID}:clips:queue:first`, streamerName);
                        await promoCommand(channelID, streamerName, true);
                    }
                }
            }
        }

        const streamerDataResult = await getTwitchUserByLogin(streamerName, true);
        if (streamerDataResult.error || !streamerDataResult.data) {
            return {
                error: true,
                message: streamerDataResult.message || 'Error'
            };
        }

        const broadcasterDataResult = await getTwitchUserById(channelID);
        if (broadcasterDataResult.error) {
            return {
                error: true,
                message: broadcasterDataResult.message || 'Error',
                where: 'promo getUserById'
            };
        }

        const streamerChannelDataResult = await getChannelInformation(streamerDataResult.data.id, true);
        if (streamerChannelDataResult.error) {
            return {
                error: true,
                message: streamerChannelDataResult.message || 'Error',
                where: 'promo getChannelInformation'
            };
        }

        const clipsResult = await getChannelClips(streamerDataResult.data.id, null, true);
        if (clipsResult.error) {
            return {
                error: true,
                message: clipsResult.message || 'Error',
                where: 'promo getChannelClips'
            };
        }

        let clip = null;
        if (sendClip && clipsResult.data) {
            clip = await showClip(channelID, clipsResult.data, streamerDataResult.data, broadcasterDataResult.data);
            if (clip.error) {
                return {
                    error: true,
                    message: clip.message || 'Error showing clip',
                    where: 'promo showClip'
                };
            }
        }

        const streamerChannelData = streamerChannelDataResult.data || {};
        const streamerChannelInfo = {
            game: streamerChannelData.game_name || '',
            title: streamerChannelData.title || '',
            login: streamerChannelData.broadcaster_login || '',
            name: streamerChannelData.broadcaster_name || ''
        };

        return {
            error: false,
            streamerChannelInfo,
            clip: clip,
            message: !sendClip ? `Please, check out ${streamerChannelInfo.name} playing ${streamerChannelInfo.game} with the title "${streamerChannelInfo.title}" at https://twitch.tv/${streamerChannelInfo.login}` : ""
        };
    } catch (error) {
        console.error(`Error in promoCommand:`, {
            channelID,
            streamerName,
            sendClip,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });

        return {
            error: true,
            message: 'Internal server error'
        };
    }
}
