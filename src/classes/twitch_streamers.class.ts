import 'dotenv/config';

import { decrypt } from "../utils/crypto.js";
import { getDragonflyClient } from "../utils/databases/dragonfly.database.js";
import UsersSchema, { type IUsers } from '../schemas/users.schema.js';
import type { ITwitchAccountCache } from '../interfaces/cache/twitch_account.cache.interface.js';
import type { IUsersCache } from '../interfaces/cache/users.cache.interface.js';
import { error, info } from "../utils/logger.js";

type DragonflyClient = Awaited<ReturnType<typeof getDragonflyClient>>;

class TwitchStreamers {
    private cachePromise: ReturnType<typeof getDragonflyClient>;

    constructor() {
        this.cachePromise = getDragonflyClient('TwitchStreamers');
    }

    async getTwitchAccountsFromCache(): Promise<IUsersCache[] | null> {
        try {
            const cache = await this.cachePromise;

            const cachedAccounts = await cache.get('twitch:accounts');
            if(cachedAccounts) {
                return JSON.parse(cachedAccounts) as IUsersCache[];
            }
            
            const keys = await cache.keys('accounts:twitch:*:data');
            let accounts: IUsersCache[] = [];
            for(const key of keys) {
                const account = await cache.hGetAll(key) as unknown as IUsersCache;
                accounts.push(account);
            }
            await cache.set('twitch:accounts', JSON.stringify(accounts), { EX: 3600 });
            return accounts;
        } catch (err) {
            await error({ function: 'TwitchStreamers.getTwitchAccountsFromCache', error: err instanceof Error ? err.message : String(err) }, { destination: 'both' });
            return [];
        }
    }

    async getTwitchAccountsFromDB() {
        try {
            const cache = await this.cachePromise;
            
            const result = await UsersSchema.find<IUsers>({ 'accounts.type': 'twitch' }).select('accounts plan_tier polar_sh_customer_id').lean();

            cache.del(`streamers:by:name`);
            await cache.del('twitch:accounts');
            for (const user of result ?? []) {
                const twitchAccount = user.accounts.find((account) => account.type === 'twitch');

                let twitchAccountCache: IUsersCache = {
                    id: twitchAccount?.id ?? '',
                    name: twitchAccount?.name ?? '',
                    email: twitchAccount?.email ?? '',
                    plan_tier: user.plan_tier ?? 'free',
                    plan_tier_until: user.plan_tier_until ? new Date(user.plan_tier_until).toDateString() : "",
                    polar_sh_customer_id: user.polar_sh_customer_id ?? '',
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

            info({ message: 'Accounts added to cache' }, { destination: 'console' });
            return result;
        } catch (err) {
            await error({ function: 'TwitchStreamers.getTwitchAccountsFromDB', error: err instanceof Error ? err.message : String(err) }, { destination: 'both' });
            return null;
        }
    }

    async getTwitchAccountById(id: string): Promise<IUsersCache | null> {
        try {
            const cache = await this.cachePromise;

            let account = await cache.hGetAll(`accounts:twitch:${id}:data`) as unknown as IUsersCache;
            if(!account) return null;

            return account;
        } catch (err) {
            await error({ function: 'TwitchStreamers.getTwitchAccountById', id, error: err instanceof Error ? err.message : String(err) }, { destination: 'both' });
            return null;
        }
    }

    async getTwitchStreamers(): Promise<string[]> {
        try {
            const cache = await this.cachePromise;
            return await cache.sMembers(`streamers:by:id`);
        } catch (err) {
            await error({ function: 'TwitchStreamers.getTwitchStreamers', error: err instanceof Error ? err.message : String(err) }, { destination: 'both' });
            return [];
        }
    }

    async updateTwitchAccountsInCache(): Promise<void | null> {
        try {
            const cache = await this.cachePromise;
            await this.getTwitchAccountsFromDB();
            info({ message: 'Accounts updated in cache' }, { destination: 'console' });
        } catch (err) {
            await error({ function: 'TwitchStreamers.updateTwitchAccountsInCache', error: err instanceof Error ? err.message : String(err) }, { destination: 'both' });
            return null;
        }
    }

    async getAccountTokenById(id: string, account_type: 'twitch' | 'kick'): Promise<string | null> {
        try {
            const cache = await this.cachePromise;
            
            let token = await cache.hGet(`accounts:${account_type}:${id}:data`, 'access_token');
            let expiresAt = await cache.hGet(`accounts:${account_type}:${id}:data`, 'expires_at');
            
            await error({ function: 'TwitchStreamers.getAccountTokenById', id, account_type, hasToken: !!token, hasExpiresAt: !!expiresAt, expiresAt: expiresAt || 'not set' }, { channelId: id, destination: 'cache' });

            if (token && expiresAt) {
                const expiration = parseInt(expiresAt);
                const now = Math.floor(Date.now() / 1000);
                
                if (now < expiration - 300) {
                    await error({ function: 'TwitchStreamers.getAccountTokenById', id, action: 'returning_cached_token', secondsUntilExpiry: expiration - now }, { channelId: id, destination: 'cache' });
                    return token;
                }
                
                await error({ function: 'TwitchStreamers.getAccountTokenById', id, action: 'token_expired_refreshing', secondsSinceExpiry: now - expiration }, { channelId: id, destination: 'cache' });
            }
            
            const refreshToken = await this.getAccountRefreshTokenById(id, account_type);

            if (!refreshToken) {
                await error({ function: 'TwitchStreamers.getAccountTokenById', error: `Refresh token not found for ${account_type}:${id}` }, { channelId: id, destination: 'cache' });
                return null;
            }
            
            if (account_type === 'twitch') {
                const { refreshTwitchToken } = await import('../utils/tokens.js');
                const refreshResult = await refreshTwitchToken(refreshToken, id);

                if (!refreshResult.token) {
                    await error({ function: 'TwitchStreamers.getAccountTokenById', error: `Failed to refresh Twitch token for ${id}` }, { channelId: id, destination: 'cache' });
                    return null;
                }

                await error({ function: 'TwitchStreamers.getAccountTokenById', id, action: 'token_refreshed_successfully' }, { channelId: id, destination: 'cache' });
                return refreshResult.token;
            }

            await error({ function: 'TwitchStreamers.getAccountTokenById', error: `Refresh not implemented for ${account_type}` }, { channelId: id, destination: 'cache' });
            return null;
        } catch (err) {
            await error({ function: 'TwitchStreamers.getAccountTokenById', id, account_type, error: err instanceof Error ? err.message : String(err) }, { channelId: id, destination: 'cache' });
            return null;
        }
    }

    async getAccountRefreshTokenById(id: string, account_type: 'twitch' | 'kick'): Promise<string | null> {
        try {
            const cache = await this.cachePromise;
            let refresh_token = await cache.hGet(`accounts:${account_type}:${id}:data`, 'refresh_token');
            if(!refresh_token) return null;
            return refresh_token;
        } catch (err) {
            await error({ function: 'TwitchStreamers.getAccountRefreshTokenById', id, account_type, error: err instanceof Error ? err.message : String(err) }, { channelId: id, destination: 'both' });
            return null;
        }
    }
}

export default new TwitchStreamers();