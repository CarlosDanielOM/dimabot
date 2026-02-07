import { getTwitchStreamerHeaderById } from '../../utils/header.js';
import { error as logError } from "../../utils/logger.js";
import { getTwitchHelixUrl } from '../../utils/links.js';
import { getDragonflyClient } from '../../utils/databases/dragonfly.database.js';

interface RemoveModeratorResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

export async function removeChannelModerator(channelID: string, userID: string): Promise<RemoveModeratorResponse> {
    try {
        const streamerHeaderResult = await getTwitchStreamerHeaderById(channelID);

        if (streamerHeaderResult.error || !streamerHeaderResult.header) {
            return {
                error: true,
                message: streamerHeaderResult.message,
                status: 403,
                type: 'permission_error'
            };
        }

        const streamerHeader = streamerHeaderResult.header;

        const params = new URLSearchParams();
        params.append('broadcaster_id', channelID);
        params.append('user_id', userID);

        const response = await fetch(getTwitchHelixUrl('moderation/moderators', params.toString()), {
            method: 'DELETE',
            headers: {
                'Client-Id': streamerHeader['Client-Id'],
                'Authorization': streamerHeader.Authorization,
                'Content-Type': streamerHeader['Content-Type']
            }
        });

        if (response.status !== 204) {
            const errorData = await response.json();
            return {
                error: true,
                message: errorData.message,
                status: errorData.status,
                type: errorData.error
            };
        }

        const cacheClient = await getDragonflyClient('removeChannelModerator');
        const jsonCacheKey = `twitch:${channelID}:moderators`;
        const idsCacheKey = `twitch:${channelID}:moderators:ids`;
        const loginsCacheKey = `twitch:${channelID}:moderators:logins`;
        const mappingCacheKey = `twitch:${channelID}:moderators:mapping`;

        const cachedJson = await cacheClient.get(jsonCacheKey);

        if (cachedJson) {
            const parsedData = JSON.parse(cachedJson);

            const dataIndex = parsedData.data.findIndex((m: any) => m.user_id === userID);
            const idsIndex = parsedData.ids.indexOf(userID);

            if (dataIndex !== -1) {
                const removedLogin = parsedData.data[dataIndex].user_login;
                const displayNameIndex = parsedData.data[dataIndex].user_login;
                const loginsIndex = parsedData.logins.indexOf(removedLogin);

                parsedData.data.splice(dataIndex, 1);
                parsedData.ids.splice(idsIndex, 1);

                if (loginsIndex !== -1) {
                    parsedData.logins.splice(loginsIndex, 1);
                    parsedData.displayNames.splice(loginsIndex, 1);
                }

                await cacheClient.set(jsonCacheKey, JSON.stringify(parsedData), { EX: 7200 });

                await cacheClient.sRem(idsCacheKey, userID);

                if (removedLogin) {
                    await cacheClient.sRem(loginsCacheKey, removedLogin);
                    await cacheClient.hDel(mappingCacheKey, removedLogin);
                }
            }
        } else {
            await cacheClient.sRem(idsCacheKey, userID);

            const cachedLogins = await cacheClient.sMembers(loginsCacheKey);
            const cachedMapping = await cacheClient.hGetAll(mappingCacheKey);

            for (const [login, id] of Object.entries(cachedMapping)) {
                if (id === userID) {
                    await cacheClient.sRem(loginsCacheKey, login);
                    await cacheClient.hDel(mappingCacheKey, login);
                    break;
                }
            }
        }

        return {
            error: false,
            message: 'Moderator removed',
            status: 200,
            type: 'success'
        };
    } catch (err) {
        await logError({ function: 'removeChannelModerator',
            channelID,
            userID,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
        }, { channelId: channelID, destination: 'both' });
        return {
            error: true,
            message: 'Internal server error',
            type: 'error'
        };
    }
}
