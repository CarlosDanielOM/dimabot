import { getDragonflyClient } from "./databases/dragonfly.database.js";
import TwitchStreamers from "../classes/twitch_streamers.class.js";
import UsersSchema, { type IUsers } from "../schemas/users.schema.js";
import { encrypt } from "./crypto.js";
import { getTwitchOAuthUrl } from "./links.js";

const BOT_USER_ID = '698614112';
let count = 0;

type RefreshFailureKind = 'transient_failure' | 'permanent_failure';

interface RefreshTwitchTokenResult {
    token: string | null;
    refreshToken: string | null;
    expiresIn: number | null;
    kind: 'success' | RefreshFailureKind;
    status?: number;
    message?: string;
}

function getRefreshFailureMessage(payload: unknown): string {
    if (!payload || typeof payload !== 'object') {
        return '';
    }

    const source = payload as Record<string, unknown>;
    const values = [source.message, source.error_description, source.error]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

    return values.join(' | ');
}

function isPermanentRefreshFailure(status: number, payload: unknown): boolean {
    const normalizedMessage = getRefreshFailureMessage(payload).toLowerCase();

    if (!(status === 400 || status === 401)) {
        return false;
    }

    return [
        'invalid refresh token',
        'invalid refresh',
        'invalid grant',
        'authorization grant is invalid',
        'revoked',
        'authorization has been revoked'
    ].some((fragment) => normalizedMessage.includes(fragment));
}

async function invalidateStoredTwitchTokens(userId: string): Promise<void> {
    const cache = await getDragonflyClient('Tokens');
    const nullToken = {
        iv: null,
        content: null
    };

    await UsersSchema.findOneAndUpdate(
        { 'accounts.id': userId },
        {
            $set: {
                'accounts.$.refresh_token': nullToken,
                'accounts.$.access_token': nullToken,
                'accounts.$.has_permissions': false,
                'accounts.$.up_to_date_permissions': false
            }
        }
    );

    await cache.hSet(`accounts:twitch:${userId}:data`, 'access_token', '');
    await cache.hSet(`accounts:twitch:${userId}:data`, 'refresh_token', '');
    await cache.hSet(`accounts:twitch:${userId}:data`, 'expires_at', '');
    await cache.hSet(`accounts:twitch:${userId}:data`, 'has_permissions', 'false');
    await cache.hSet(`accounts:twitch:${userId}:data`, 'up_to_date_permissions', 'false');
}

// @deprecated This function is deprecated. Tokens are now refreshed automatically when needed via smart refresh system.
export const refreshAllTokens = async () => {
    count++;
    const cache = await getDragonflyClient('Tokens');
    await TwitchStreamers.updateTwitchAccountsInCache();
    const twitchStreamers = await TwitchStreamers.getTwitchStreamers();

    const promises = twitchStreamers.map(async streamer => {
        try {
            let account = await TwitchStreamers.getTwitchAccountById(streamer);
            if(!account) return null;

            if(!account.refresh_token) {
                console.log('Refresh token is null for ', {streamer});
                return null;
            }

            const refreshResult = await refreshTwitchToken(account.refresh_token, account.id);

            if(!refreshResult.token) {
                if (refreshResult.kind === 'permanent_failure') {
                    await cache.sRem(`streamers:by:id`, account.id);
                    await cache.sRem(`streamers:by:name`, account.name);
                    await TwitchStreamers.updateTwitchAccountsInCache();
                }

                return console.error(`Error refreshing token for ${account.id} ${account.name}: ${refreshResult.message || refreshResult.kind}`);
            }

            account.access_token = refreshResult.token!;
            account.refresh_token = refreshResult.refreshToken!;

            await cache.hSet(`accounts:twitch:${account.id}:data`, 'refresh_token', account.refresh_token);

            await cache.hSet(`accounts:twitch:${account.id}:data`, 'access_token', account.access_token);

            const encryptedToken = encrypt(account.access_token);
            const encryptedRefreshToken = encrypt(account.refresh_token);

            await UsersSchema.findOneAndUpdate({'accounts.id': account.id}, {$set: {'accounts.$.refresh_token': encryptedRefreshToken, 'accounts.$.access_token': encryptedToken}})
        } catch (error) {
            console.error(`Error refreshing token for ${streamer}: ${error}`);
            return null;
        }
    });
}

export const refreshTwitchToken = async (refresh_token: string, user_id: string): Promise<RefreshTwitchTokenResult> => {
    try {
        const cache = await getDragonflyClient('Tokens');
        
        // URL encode the refresh token to handle special characters
        const params = new URLSearchParams({
            client_id: process.env.CLIENT_ID!,
            client_secret: process.env.CLIENT_SECRET!,
            grant_type: 'refresh_token',
            refresh_token: encodeURIComponent(refresh_token)
        });

        const twitchRefreshResponse = await fetch(getTwitchOAuthUrl('token', params.toString()), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        const responseText = await twitchRefreshResponse.text();
        let refreshTokenData: Record<string, unknown> = {};

        try {
            refreshTokenData = responseText ? JSON.parse(responseText) as Record<string, unknown> : {};
        } catch (parseError) {
            console.error(`Error parsing Twitch token refresh response for ${user_id}:`, {
                error: parseError instanceof Error ? parseError.message : String(parseError),
                status: twitchRefreshResponse.status,
                body: responseText,
                timestamp: new Date().toISOString()
            });

            return {
                token: null,
                refreshToken: null,
                expiresIn: null,
                kind: 'transient_failure',
                status: twitchRefreshResponse.status,
                message: 'Failed to parse Twitch token refresh response'
            };
        }

        const hasOAuthError = !twitchRefreshResponse.ok || Boolean(refreshTokenData.error);
        if (hasOAuthError) {
            const message = getRefreshFailureMessage(refreshTokenData) || `HTTP ${twitchRefreshResponse.status}`;
            const failureKind: RefreshFailureKind = isPermanentRefreshFailure(twitchRefreshResponse.status, refreshTokenData)
                ? 'permanent_failure'
                : 'transient_failure';

            console.error(`Error refreshing Twitch token for ${user_id}: ${message}`, {
                status: twitchRefreshResponse.status,
                failureKind,
                response: refreshTokenData,
                timestamp: new Date().toISOString()
            });

            if (failureKind === 'permanent_failure') {
                await invalidateStoredTwitchTokens(user_id);
            }

            return {
                token: null,
                refreshToken: null,
                expiresIn: null,
                kind: failureKind,
                status: twitchRefreshResponse.status,
                message
            };
        }

        const token = typeof refreshTokenData.access_token === 'string' ? refreshTokenData.access_token : null;
        const refreshToken = typeof refreshTokenData.refresh_token === 'string' ? refreshTokenData.refresh_token : null;
        const expiresIn = typeof refreshTokenData.expires_in === 'number' ? refreshTokenData.expires_in : 7200;

        if (!token || !refreshToken) {
            console.error(`Twitch token refresh returned incomplete payload for ${user_id}`, {
                status: twitchRefreshResponse.status,
                response: refreshTokenData,
                timestamp: new Date().toISOString()
            });

            return {
                token: null,
                refreshToken: null,
                expiresIn: null,
                kind: 'transient_failure',
                status: twitchRefreshResponse.status,
                message: 'Twitch token refresh returned incomplete payload'
            };
        }

        const encryptedToken = encrypt(token);
        const encryptedRefreshToken = encrypt(refreshToken);

        // Update database
        const userDoc = await UsersSchema.findOne({ 'accounts.id': user_id }) as IUsers;
        if (!userDoc) {
            console.error(`User not found for ${user_id}`);
            return {
                token: null,
                refreshToken: null,
                expiresIn: null,
                kind: 'transient_failure',
                message: 'User not found while storing refreshed token'
            };
        }

        await UsersSchema.findOneAndUpdate(
            { 'accounts.id': user_id },
            { 
                $set: { 
                    'accounts.$.refresh_token': encryptedRefreshToken, 
                    'accounts.$.access_token': encryptedToken,
                    'accounts.$.has_permissions': true,
                    'accounts.$.up_to_date_permissions': true
                }
            }
        );

        // Update cache with correct key
        await cache.hSet(`accounts:twitch:${user_id}:data`, 'access_token', token);
        await cache.hSet(`accounts:twitch:${user_id}:data`, 'refresh_token', refreshToken);
        
        // Store expiration timestamp (access_token expires, refresh_token doesn't)
        const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
        await cache.hSet(`accounts:twitch:${user_id}:data`, 'expires_at', String(expiresAt));
        await cache.hSet(`accounts:twitch:${user_id}:data`, 'has_permissions', 'true');
        await cache.hSet(`accounts:twitch:${user_id}:data`, 'up_to_date_permissions', 'true');
        
        return {
            token,
            refreshToken,
            expiresIn,
            kind: 'success'
        };
    } catch (error) {
        console.error(`Error refreshing Twitch token for ${user_id}: ${error}`);
        return {
            token: null,
            refreshToken: null,
            expiresIn: null,
            kind: 'transient_failure',
            message: error instanceof Error ? error.message : String(error)
        };
    }
};

export const getNewTwitchAppToken = async () => {
    try {
        const cache = await getDragonflyClient('Tokens');

        let params = new URLSearchParams({
            client_id: process.env.CLIENT_ID!,
            client_secret: process.env.CLIENT_SECRET!,
            grant_type: 'client_credentials',
        });

        const twitchAppResponse = await fetch(getTwitchOAuthUrl('token', params.toString()), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        const appTokenData = await twitchAppResponse.json();

        if(!appTokenData.access_token) {
            console.error(`Error getting new Twitch app token: ${appTokenData.message}`);
            return null;
        }

        await cache.set('app:twitch:token', String(appTokenData.access_token), {EX: Number(appTokenData.expires_in)});

        return appTokenData;
    } catch (error) {
        console.error(`Error getting new Twitch app token internal error: ${error}`);
        return null;
    }
}

export const getAppToken = async (platform: 'twitch' | 'youtube' | 'kick' | 'tiktok' | 'spotify'): Promise<string | null> => {
    try {
        const cache = await getDragonflyClient('Tokens');
        const token = await cache.get(`app:${platform}:token`);
        if(token) return token;

        const appToken = await getNewTwitchAppToken();
        if(!appToken) return null;

        await cache.set(`app:twitch:token`, String(appToken.access_token), {EX: Number(appToken.expires_in)});
        return appToken.access_token;
    } catch (error) {
        console.error(`Error getting ${platform} app token: ${error}`);
        return null;
    }
}

export const getBotToken = async (): Promise<string | null> => {
    try {
        const token = await TwitchStreamers.getAccountTokenById(BOT_USER_ID, 'twitch');
        
        if (token) {
            const cache = await getDragonflyClient('Tokens');
            await cache.hSet('app:twitch:bot', 'access_token', token);
        }
        
        return token;
    } catch (error) {
        console.error(`Error getting bot token: ${error}`);
        return null;
    }
};
