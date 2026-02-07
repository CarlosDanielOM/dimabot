import TwitchStreamers from '../../classes/twitch_streamers.class.js';
import { getDragonflyClient } from '../../utils/databases/dragonfly.database.js';
import { getTwitchStreamerHeaderById } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';
import { error as logError } from '../../utils/logger.js';

interface Editor {
    user_id: string;
    user_login: string;
    user_name: string;
}

interface GetEditorsResponse {
    error: boolean;
    message?: string;
    editors?: Editor[];
}

export async function getChannelEditors(channelID: string, cache: boolean = false): Promise<GetEditorsResponse> {
    let editorList: Editor[] = [];
    
    try {
        const cacheClient = await getDragonflyClient('getChannelEditors');
        await TwitchStreamers.getTwitchAccountById(channelID);

        const streamerHeaderResult = await getTwitchStreamerHeaderById(channelID);

        if (streamerHeaderResult.error || !streamerHeaderResult.header) {
            return {
                error: true,
                message: streamerHeaderResult.message
            };
        }

        const streamerHeader = streamerHeaderResult.header;

        const params = new URLSearchParams({
            broadcaster_id: channelID
        });

        const response = await fetch(getTwitchHelixUrl('channels/editors', params.toString()), {
            headers: {
                'Client-Id': streamerHeader['Client-Id'],
                'Authorization': streamerHeader.Authorization,
                'Content-Type': streamerHeader['Content-Type']
            }
        });

        const data = await response.json();

        if (data.error) {
            return {
                error: true,
                message: data.message
            };
         }
        
         editorList = data.data;
         let reset = cache ? false : true;

         for (let i = 0; i < editorList.length; i++) {
             const editor = editorList[i];

             const editorData: Editor = {
                 user_id: editor.user_id,
                 user_login: editor.user_name.toLowerCase(),
                 user_name: editor.user_name
             };

            if (cache) {
                if (!reset) {
                    await cacheClient.del(`twitch:${channelID}:editors`);
                    reset = true;
                }
                await cacheClient.sAdd(`twitch:${channelID}:editors`, editor.user_name.toLowerCase());
                await cacheClient.expire(`twitch:${channelID}:editors`, 60 * 60 * 24);
            }

            editorList.push(editorData);
        }

        return {
            error: false,
            editors: editorList
        };
    } catch (err) {
        await logError({
            function: 'getChannelEditors',
            channelID,
            cache,
            operation: 'get_channel_editors',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            apiEndpoint: 'channels/editors',
            method: 'GET',
            editorsCount: editorList.length
        }, { channelId: channelID, destination: 'both' });

        return {
            error: true,
            message: 'Internal server error'
        };
    }
}
