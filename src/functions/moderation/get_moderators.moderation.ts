import { getDragonflyClient } from '../../utils/databases/dragonfly.database.js';
import { getTwitchStreamerHeaderById } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';

interface TwitchModeratorData {
    user_id: string;
    user_login: string;
    user_name: string;
}

interface GetModeratorsResponse {
    error: boolean;
    message: string;
    status?: number;
    data?: TwitchModeratorData[];
    ids?: string[];
    logins?: string[];
    displayNames?: string[];
}

export async function getChannelModerators(channelID: string, userIDs: string[] = [], cache: boolean = false): Promise<GetModeratorsResponse> {
    try {
        const cacheClient = await getDragonflyClient('getChannelModerators');
        const cacheKey = `twitch:${channelID}:moderators`;

        if (cache) {
            const cachedData = await cacheClient.get(cacheKey);
            if (cachedData) {
                const parsedData = JSON.parse(cachedData);
                return {
                    error: false,
                    message: 'Success (from cache)',
                    data: parsedData.data,
                    ids: parsedData.ids,
                    logins: parsedData.logins,
                    displayNames: parsedData.displayNames
                };
            }
        }

        const streamerHeaderResult = await getTwitchStreamerHeaderById(channelID);

        if (streamerHeaderResult.error || !streamerHeaderResult.header) {
            return {
                error: true,
                message: streamerHeaderResult.message,
                status: 403
            };
        }

        const streamerHeader = streamerHeaderResult.header;

        const params = new URLSearchParams({
            broadcaster_id: channelID
        });

        if (userIDs.length > 0) {
            for (const userID of userIDs) {
                params.append('user_id', userID);
            }
        }

        const response = await fetch(getTwitchHelixUrl('moderation/moderators', params.toString()), {
            headers: streamerHeader as unknown as Record<string, string>
        });

        const data = await response.json();

        if (data.error) {
            return {
                error: true,
                message: data.message,
                status: data.status
            };
        }

        const moderators = data.data;

        if (moderators.length === 0) {
            const emptyResult = {
                error: false,
                message: 'Success',
                data: [],
                ids: [],
                logins: [],
                displayNames: []
            };

            if (cache) {
                await cacheClient.set(cacheKey, JSON.stringify(emptyResult), { EX: 300 });
            }

            return emptyResult;
        }

        const ids: string[] = [];
        const logins: string[] = [];
        const displayNames: string[] = [];

        for (const mod of moderators) {
            ids.push(mod.user_id);
            logins.push(mod.user_login);
            displayNames.push(mod.user_name);
        }

        const result = {
            error: false,
            message: 'Success',
            data: moderators,
            ids,
            logins,
            displayNames
        };

        if (cache) {
            await cacheClient.set(cacheKey, JSON.stringify(result), { EX: 300 });
        }

        return result;
    } catch (error) {
        console.error(`Error in getChannelModerators:`, {
            channelID,
            userIDs,
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
