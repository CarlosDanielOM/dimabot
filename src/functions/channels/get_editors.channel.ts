import TwitchStreamers from '../../classes/twitch_streamers.class.js';
import { getDragonflyClient } from '../../utils/databases/dragonfly.database.js';
import { getTwitchStreamerHeaderById } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';

interface Editor {
    id: string;
    name: string;
}

interface GetEditorsResponse {
    error: boolean;
    message?: string;
    editors?: Editor[];
}

export async function getChannelEditors(channelID: string, cache: boolean = false): Promise<GetEditorsResponse> {
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

        const editors = data.data;
        const editorList: Editor[] = [];
        let reset = cache ? false : true;

        for (let i = 0; i < editors.length; i++) {
            const editor = editors[i];

            const editorData: Editor = {
                id: editor.user_id,
                name: editor.user_name.toLowerCase(),
            };

            if (cache) {
                if (!reset) {
                    await cacheClient.del(`${channelID}:channel:editors`);
                    reset = true;
                }
                await cacheClient.sAdd(`${channelID}:channel:editors`, editor.user_name.toLowerCase());
                await cacheClient.expire(`${channelID}:channel:editors`, 60 * 60 * 24);
            }

            editorList.push(editorData);
        }

        return {
            error: false,
            editors: editorList
        };
    } catch (error) {
        console.error(`Error in getChannelEditors:`, {
            channelID,
            cache,
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
