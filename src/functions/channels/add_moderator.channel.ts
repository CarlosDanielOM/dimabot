import { getTwitchStreamerHeaderById } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';
import { getDragonflyClient } from '../../utils/databases/dragonfly.database.js';
import { getTwitchUserById } from '../users/index.js';

interface AddModeratorResponse {
    status: number;
    message: string;
    error?: string;
    type?: string;
}

export async function addModerator(channelID: string, userID: string = '698614112'): Promise<AddModeratorResponse> {
    try {
        const streamerHeaderResult = await getTwitchStreamerHeaderById(channelID);

        if (streamerHeaderResult.error || !streamerHeaderResult.header) {
            return {
                status: 403,
                message: streamerHeaderResult.message,
                error: 'permission_error',
                type: 'error'
            };
        }

        const streamerHeader = streamerHeaderResult.header;

        const params = new URLSearchParams();
        params.append('broadcaster_id', channelID);
        params.append('user_id', userID);

        const headers: Record<string, string> = {
            'Client-Id': streamerHeader['Client-Id'],
            'Authorization': streamerHeader.Authorization,
            'Content-Type': streamerHeader['Content-Type']
        };

        const response = await fetch(getTwitchHelixUrl('moderation/moderators', params.toString()), {
            method: 'POST',
            headers: headers,
        });

        if (response.status !== 204) {
            const errorData = await response.json();
            return {
                status: response.status,
                message: errorData.message || 'Failed to add moderator',
                error: errorData.error,
                type: 'error'
            };
        }

        const userInfo = await getTwitchUserById(userID);

        if (!userInfo.error && userInfo.data) {
            const cacheClient = await getDragonflyClient('addModerator');
            const jsonCacheKey = `twitch:${channelID}:moderators`;
            const idsCacheKey = `twitch:${channelID}:moderators:ids`;
            const loginsCacheKey = `twitch:${channelID}:moderators:logins`;
            const mappingCacheKey = `twitch:${channelID}:moderators:mapping`;

            const cachedJson = await cacheClient.get(jsonCacheKey);

            if (cachedJson) {
                const parsedData = JSON.parse(cachedJson);

                const newMod = {
                    user_id: userInfo.data.id,
                    user_login: userInfo.data.login,
                    user_name: userInfo.data.display_name
                };

                parsedData.data.push(newMod);
                parsedData.ids.push(userInfo.data.id);
                parsedData.logins.push(userInfo.data.login);
                parsedData.displayNames.push(userInfo.data.display_name);

                await cacheClient.set(jsonCacheKey, JSON.stringify(parsedData), { EX: 7200 });

                await cacheClient.sAdd(idsCacheKey, userInfo.data.id);
                await cacheClient.expire(idsCacheKey, 7200);

                await cacheClient.sAdd(loginsCacheKey, userInfo.data.login);
                await cacheClient.expire(loginsCacheKey, 7200);

                await cacheClient.hSet(mappingCacheKey, { [userInfo.data.login]: userInfo.data.id });
                await cacheClient.expire(mappingCacheKey, 7200);
            }
        }

        return {
            status: 200,
            message: 'Success'
        };
    } catch (error) {
        console.error(`Error in addModerator:`, {
            channelID,
            userID,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });

        return {
            status: 500,
            message: 'Internal server error',
            error: String(error),
            type: 'error'
        };
    }
}
