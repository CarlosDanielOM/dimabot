import { getDragonflyClient } from '../../utils/databases/dragonfly.database.js';
import { getTwitchAppHeader } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';
import { error as logError } from '../../utils/logger.js';

interface GetChannelInformationResponse {
    error: boolean;
    message?: string;
    data?: any;
    status?: number;
}

export async function getChannelInformation(channelID: string, saveToCache: boolean = false): Promise<GetChannelInformationResponse> {
    try {
        const cacheClient = await getDragonflyClient('getChannelInformation');

        const cachedChannel = await cacheClient.get(`channel:data:${channelID}`);
        if (cachedChannel) {
            return {
                error: false,
                data: JSON.parse(cachedChannel)
            };
        }

        const botHeader = await getTwitchAppHeader();

        const params = new URLSearchParams({
            broadcaster_id: channelID
        });

        const response = await fetch(getTwitchHelixUrl('channels', params.toString()), {
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
                message: data.message,
                status: data.status
            };
        }

        const channelData = data.data[0];

        if (saveToCache) {
            await cacheClient.set(`channel:data:${channelID}`, JSON.stringify(channelData), { EX: 60 * 60 * 3 });
        }

        return {
            error: false,
            data: channelData
        };
    } catch (err) {
        await logError({
            function: 'getChannelInformation',
            channelID,
            saveToCache,
            operation: 'get_channel_information',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            apiEndpoint: 'channels',
            method: 'GET',
            cacheKey: `channel:data:${channelID}`
        }, { channelId: channelID, destination: 'both' });

        return {
            error: true,
            message: 'Internal server error'
        };
    }
}
