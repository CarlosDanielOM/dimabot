import { getDragonflyClient } from "./databases/dragonfly.database.js";
import TwitchStreamers from "../classes/twitch_streamers.class.js";
import UsersSchema, { type IUsers } from "../schemas/users.schema.js";
import { decrypt, encrypt } from "./crypto.js";
import { getTwitchOAuthUrl } from "./links.js";
import { notifyDevelopers } from "./notifications.js";

const BOT_USER_ID = '698614112';
let count = 0;

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
                let nullToken = {
                    iv: null,
                    content: null
                }

                await UsersSchema.findOneAndUpdate({'accounts.id': account.id}, {$set: {'accounts.$.refresh_token': nullToken, 'accounts.$.access_token': nullToken, 'accounts.$.up_to_date_permissions': false, 'accounts.$.has_permissions': false}});

                await cache.hSet(`accounts:twitch:${account.id}:data`, 'refresh_token', '');
                await cache.hSet(`accounts:twitch:${account.id}:data`, 'access_token', '');
                await cache.hSet(`accounts:twitch:${account.id}:data`, 'up_to_date_permissions', 'false');
                await cache.hSet(`accounts:twitch:${account.id}:data`, 'has_permissions', 'false');

                await cache.sRem(`streamers:by:id`, account.id);
                await cache.sRem(`streamers:by:name`, account.name);

                await TwitchStreamers.updateTwitchAccountsInCache();

                return console.error(`Error refreshing token for ${account.id} ${account.name}, token is null, deactivating channel`);
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

export const refreshTwitchToken = async (refresh_token: string, user_id: string) => {
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

        const refreshTokenData = await twitchRefreshResponse.json();

        if (refreshTokenData.status === 400 || refreshTokenData.error) {
            console.error(`Error refreshing Twitch token for ${user_id}: ${refreshTokenData.message}`);

            // Set tokens to empty in cache
            await cache.hSet(`accounts:twitch:${user_id}:data`, 'access_token', '');
            await cache.hSet(`accounts:twitch:${user_id}:data`, 'refresh_token', '');
            await cache.hSet(`accounts:twitch:${user_id}:data`, 'has_permissions', 'false');
            await cache.hSet(`accounts:twitch:${user_id}:data`, 'up_to_date_permissions', 'false');

            // Set tokens to null in database
            const nullToken = {
                iv: null,
                content: null
            };
            await UsersSchema.findOneAndUpdate(
                { 'accounts.id': user_id },
                { 
                    $set: { 
                        'accounts.$.refresh_token': nullToken,
                        'accounts.$.access_token': nullToken,
                        'accounts.$.has_permissions': false,
                        'accounts.$.up_to_date_permissions': false
                    }
                }
            );

            return {
                token: null,
                refreshToken: null,
                expiresIn: null
            };
        }

        const token = refreshTokenData.access_token;
        const refreshToken = refreshTokenData.refresh_token;
        const expiresIn = refreshTokenData.expires_in || 7200;

        const encryptedToken = encrypt(token);
        const encryptedRefreshToken = encrypt(refreshToken);

        // Update database
        const userDoc = await UsersSchema.findOne({ 'accounts.id': user_id }) as IUsers;
        if (!userDoc) {
            console.error(`User not found for ${user_id}`);
            return {
                token: null,
                refreshToken: null,
                expiresIn: null
            };
        }

        await UsersSchema.findOneAndUpdate(
            { 'accounts.id': user_id },
            { 
                $set: { 
                    'accounts.$.refresh_token': encryptedRefreshToken, 
                    'accounts.$.access_token': encryptedToken 
                }
            }
        );

        // Update cache with correct key
        await cache.hSet(`accounts:twitch:${user_id}:data`, 'access_token', token);
        await cache.hSet(`accounts:twitch:${user_id}:data`, 'refresh_token', refreshToken);
        
        // Store expiration timestamp (access_token expires, refresh_token doesn't)
        const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
        await cache.hSet(`accounts:twitch:${user_id}:data`, 'expires_at', String(expiresAt));
        
        return {
            token,
            refreshToken,
            expiresIn
        };
    } catch (error) {
        console.error(`Error refreshing Twitch token for ${user_id}: ${error}`);
        return {
            token: null,
            refreshToken: null,
            expiresIn: null
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
