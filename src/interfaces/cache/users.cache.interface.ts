import type { ITwitchAccountCache } from "./twitch_account.cache.interface.js";

export interface IUsersCache extends ITwitchAccountCache {
    plan_tier: 'free' | 'premium' | 'pro';
    plan_tier_until: string | 'null';
}