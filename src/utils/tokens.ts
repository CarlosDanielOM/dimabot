import { getDragonflyClient } from "./databases/dragonfly.database.js";
import TwitchStreamers from "../classes/twitch_streamers.class.js";
import UsersSchema, { type IUsers } from "../schemas/users.schema.js";
import { decrypt, encrypt } from "./crypto.js";
import { getTwitchOAuthUrl } from "./links.js";

let count = 0;

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

            const { encryptedToken, encryptedRefreshToken } = await refreshTwitchToken(account.refresh_token);

            if(!encryptedToken || !encryptedRefreshToken) {
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

            account.access_token = decrypt(encryptedToken)!;
            account.refresh_token = decrypt(encryptedRefreshToken)!;

            await cache.hSet(`accounts:twitch:${account.id}:data`, 'refresh_token', account.refresh_token);

            await cache.hSet(`accounts:twitch:${account.id}:data`, 'access_token', account.access_token);

            await UsersSchema.findOneAndUpdate({'accounts.id': account.id}, {$set: {'accounts.$.refresh_token': encryptedRefreshToken, 'accounts.$.access_token': encryptedToken}})
        } catch (error) {
            console.error(`Error refreshing token for ${streamer}: ${error}`);
            return null;
        }
    });
}

export const refreshTwitchToken = async (refresh_token: string, independent = false, userId = null) => {
    if(!userId && independent) {
        console.log({refresh_token, independent, userId});
        return {
            encryptedToken: null,
            encryptedRefreshToken: null
        }
    }

    try {
        const cache = await getDragonflyClient('Tokens');
        const params = new URLSearchParams({
            client_id: process.env.CLIENT_ID!,
            client_secret: process.env.CLIENT_SECRET!,
            grant_type: 'refresh_token',
            refresh_token: refresh_token
        });

        const twitchRefreshResponse = await fetch(getTwitchOAuthUrl('token', params.toString()), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        const refreshTokenData = await twitchRefreshResponse.json();

        if(refreshTokenData.status === 400) {
            console.error(`Error refreshing Twitch token for ${userId}: ${refreshTokenData.message}`);
            return {
                encryptedToken: null,
                encryptedRefreshToken: null
            }
        }
        
        const token = refreshTokenData.access_token;
        const refreshToken = refreshTokenData.refresh_token;

        const encryptedToken = encrypt(token);
        const encryptedRefreshToken = encrypt(refreshToken);
        
        if(independent) {
            let userDoc = await UsersSchema.findOne({'accounts.id': userId}) as IUsers;
            if(!userDoc) {
                console.error(`User not found for ${userId}`);
                return {
                    encryptedToken: null,
                    encryptedRefreshToken: null
                }
            }

            await UsersSchema.findOneAndUpdate({'accounts.id': userId}, {$set: {'accounts.$.refresh_token': encryptedRefreshToken, 'accounts.$.access_token': encryptedToken}});

            cache.hSet(`${userId}:streamer:data`, 'token', token);
            cache.hSet(`${userId}:streamer:data`, 'refresh_token', refreshToken);

            return { token }
        }

        return {
            encryptedToken,
            encryptedRefreshToken
        }
    } catch (error) {
        console.error(`Error refreshing Twitch token for ${userId}: ${error}`);
        return {
            tokenEncrypt: null,
            refreshTokenEncrypt: null
        }
    }
}

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