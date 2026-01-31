import 'dotenv/config';

import { decrypt } from "../utils/crypto.js";
import { getDragonflyClient } from "../utils/databases/dragonfly.database.js";
import UsersSchema, { type IUsers } from '../schemas/users.schema.js';
import type { ITwitchAccountCache } from '../interfaces/cache/twitch_account.cache.interface.js';
import type { IUsersCache } from '../interfaces/cache/users.cache.interface.js';

type DragonflyClient = Awaited<ReturnType<typeof getDragonflyClient>>;

class TwitchStreamers {
    private cachePromise: ReturnType<typeof getDragonflyClient>;

    constructor() {
        this.cachePromise = getDragonflyClient('TwitchStreamers');
    }

    async getTwitchAccountsFromDB() {
        try {
            const cache = await this.cachePromise;
            
            const result = await UsersSchema.find<IUsers>({ 'accounts.type': 'twitch' }).select('accounts plan_tier').lean();

            cache.del(`streamers:by:name`);
            for (const user of result ?? []) {
                const twitchAccount = user.accounts.find((account) => account.type === 'twitch');

                let twitchAccountCache: IUsersCache = {
                    id: twitchAccount?.id ?? '',
                    name: twitchAccount?.name ?? '',
                    email: twitchAccount?.email ?? '',
                    plan_tier: user.plan_tier ?? 'free',
                    plan_tier_until: user.plan_tier_until ? new Date(user.plan_tier_until).toDateString() : "",
                    refresh_token: decrypt(twitchAccount!.refresh_token) ?? '',
                    access_token: decrypt(twitchAccount!.access_token) ?? '',
                    actived: twitchAccount?.actived ? 'true' : 'false',
                    chat_enabled: twitchAccount?.chat_enabled ? 'true' : 'false',
                    has_permissions: twitchAccount?.has_permissions ? 'true' : 'false',
                    up_to_date_permissions: twitchAccount?.up_to_date_permissions ? 'true' : 'false',
                };

                cache.hSet(`accounts:${twitchAccount!.type}:${twitchAccount!.id}:data`, twitchAccountCache as Record<string, any>);

                cache.sAdd(`streamers:by:id`, twitchAccount!.id);
            }
            
            console.log('Accounts added to cache');
            return result;
        } catch (error) {
            console.error(`Error getting Twitch accounts from DB: ${error}`);
            return null;
        }
    }

    async getTwitchAccountById(id: string): Promise<IUsersCache | null> {
        try {
            const cache = await this.cachePromise;

            let account = await cache.hGetAll(`accounts:twitch:${id}:data`) as unknown as IUsersCache;
            if(!account) return null;

            return account;
        } catch (error) {
            console.error(`Error getting Twitch account by ID: ${error}`);
            return null;
        }
    }

    async getTwitchStreamers(): Promise<string[]> {
        try {
            const cache = await this.cachePromise;
            return await cache.sMembers(`streamers:by:id`);
        } catch (error) {
            console.error(`Error getting Twitch streamers: ${error}`);
            return [];
        }
    }

    async updateTwitchAccountsInCache(): Promise<void | null> {
        try {
            const cache = await this.cachePromise;
            await this.getTwitchAccountsFromDB();
            console.log('Accounts updated in cache');
        } catch (error) {
            console.error(`Error updating Twitch accounts in cache: ${error}`);
            return null;
        }
    }

    async getAccountTokenById(id: string, account_type: 'twitch' | 'kick'): Promise<string | null> {
        try {
            const cache = await this.cachePromise;
            
            // Get token and expiration from cache
            let token = await cache.hGet(`accounts:${account_type}:${id}:data`, 'access_token');
            let expiresAt = await cache.hGet(`accounts:${account_type}:${id}:data`, 'expires_at');
            
            // Check if token exists and is not expired
            if (token && expiresAt) {
                const expiration = parseInt(expiresAt);
                const now = Math.floor(Date.now() / 1000);
                
                // If token is still valid (with 5 min buffer), return it
                if (now < expiration - 300) {
                    return token;
                }
            }
            
            // Token not in cache or expired, refresh
            const refreshToken = await this.getAccountRefreshTokenById(id, account_type);
            
            if (!refreshToken) {
                console.error(`Refresh token not found for ${account_type}:${id}`);
                return null;
            }
            
            // For Twitch, use the simplified refresh function
            if (account_type === 'twitch') {
                const { refreshTwitchToken } = await import('../utils/tokens.js');
                const refreshResult = await refreshTwitchToken(refreshToken, id);
                
                if (!refreshResult.token) {
                    console.error(`Failed to refresh Twitch token for ${id}`);
                    return null;
                }
                
                return refreshResult.token;
            }
            
            // For other platforms (Kick, etc.), implement refresh logic later
            console.error(`Refresh not implemented for ${account_type}`);
            return null;
        } catch (error) {
            console.error(`Error getting account token by ID: ${error}`);
            return null;
        }
    }

    async getAccountRefreshTokenById(id: string, account_type: 'twitch' | 'kick'): Promise<string | null> {
        try {
            const cache = await this.cachePromise;
            let refresh_token = await cache.hGet(`accounts:${account_type}:${id}:data`, 'refresh_token');
            if(!refresh_token) return null;
            return refresh_token;
        } catch (error) {
            console.error(`Error getting account refresh token by ID: ${error}`);
            return null;
        }
    }
}

export default new TwitchStreamers();