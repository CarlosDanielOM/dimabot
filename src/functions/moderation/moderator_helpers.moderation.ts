import { getDragonflyClient } from '../../utils/databases/dragonfly.database.js';
import { getChannelModerators } from './get_moderators.moderation.js';

interface GetModeratorsIdsResponse {
    error: boolean;
    message: string;
    ids?: string[];
}

interface IsModeratorResponse {
    error: boolean;
    isModerator: boolean;
    message: string;
}

export async function getTwitchModeratorsIds(channelID: string, skip_cache: boolean = false): Promise<GetModeratorsIdsResponse> {
    try {
        if (!skip_cache) {
            const cacheClient = await getDragonflyClient('getTwitchModeratorsIds');
            const idsCacheKey = `twitch:${channelID}:moderators:ids`;

            const cachedIds = await cacheClient.sMembers(idsCacheKey);

            if (cachedIds.length > 0) {
                return {
                    error: false,
                    message: 'Success (from cache)',
                    ids: cachedIds
                };
            }
        }

        const result = await getChannelModerators(channelID, [], true);

        if (result.error) {
            return {
                error: true,
                message: result.message
            };
        }

        return {
            error: false,
            message: 'Success',
            ids: result.ids || []
        };
    } catch (error) {
        console.error(`Error in getTwitchModeratorsIds:`, {
            channelID,
            skip_cache,
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

export async function isTwitchModeratorById(channelID: string, userID: string, skip_cache: boolean = false): Promise<IsModeratorResponse> {
    try {
        if (!skip_cache) {
            const cacheClient = await getDragonflyClient('isTwitchModeratorById');
            const idsCacheKey = `twitch:${channelID}:moderators:ids`;

            const isMember = await cacheClient.sIsMember(idsCacheKey, userID);

            if (isMember) {
                return {
                    error: false,
                    isModerator: true,
                    message: 'User is a moderator'
                };
            }

            const cacheExists = await cacheClient.exists(idsCacheKey);

            if (cacheExists === 1) {
                return {
                    error: false,
                    isModerator: false,
                    message: 'User is not a moderator'
                };
            }
        }

        const result = await getChannelModerators(channelID, [], true);

        if (result.error) {
            return {
                error: true,
                isModerator: false,
                message: result.message
            };
        }

        const isModerator = result.ids?.includes(userID) || false;

        return {
            error: false,
            isModerator,
            message: isModerator ? 'User is a moderator' : 'User is not a moderator'
        };
    } catch (error) {
        console.error(`Error in isTwitchModeratorById:`, {
            channelID,
            userID,
            skip_cache,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });

        return {
            error: true,
            isModerator: false,
            message: 'Internal server error'
        };
    }
}

export async function isTwitchModeratorByLogin(channelID: string, userLogin: string, skip_cache: boolean = false): Promise<IsModeratorResponse> {
    try {
        if (!skip_cache) {
            const cacheClient = await getDragonflyClient('isTwitchModeratorByLogin');
            const loginsCacheKey = `twitch:${channelID}:moderators:logins`;

            const isMember = await cacheClient.sIsMember(loginsCacheKey, userLogin);

            if (isMember) {
                return {
                    error: false,
                    isModerator: true,
                    message: 'User is a moderator'
                };
            }

            const cacheExists = await cacheClient.exists(loginsCacheKey);

            if (cacheExists === 1) {
                return {
                    error: false,
                    isModerator: false,
                    message: 'User is not a moderator'
                };
            }
        }

        const result = await getChannelModerators(channelID, [], true);

        if (result.error) {
            return {
                error: true,
                isModerator: false,
                message: result.message
            };
        }

        const isModerator = result.logins?.includes(userLogin) || false;

        return {
            error: false,
            isModerator,
            message: isModerator ? 'User is a moderator' : 'User is not a moderator'
        };
    } catch (error) {
        console.error(`Error in isTwitchModeratorByLogin:`, {
            channelID,
            userLogin,
            skip_cache,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });

        return {
            error: true,
            isModerator: false,
            message: 'Internal server error'
        };
    }
}
