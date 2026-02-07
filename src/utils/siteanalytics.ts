import { getDragonflyClient } from './databases/dragonfly.database.js';
import UsersSchema, { type IUsers } from '../schemas/users.schema.js';
import { liveChannels } from '../functions/channels/is_live.channel.js';

export async function startSiteAnalytics(): Promise<boolean> {
    const cacheClient = await getDragonflyClient('SiteAnalytics');

    const alreadyStarted = await cacheClient.exists('site:analytics:start');
    if (alreadyStarted) {
        return true;
    }

    try {
        const users = await UsersSchema.find({ 'accounts.type': 'twitch' }).select('accounts').lean();

        let channelsCount = 0;
        let activeChannelsCount = 0;
        let liveChannelsCount = 0;

        for (const user of users) {
            if (!user.accounts) continue;

            for (const account of user.accounts) {
                if (account.type === 'twitch') {
                    channelsCount++;
                    if (account.actived) {
                        activeChannelsCount++;
                    }
                }
            }
        }

        const onlineChannelsResult = await liveChannels();
        if (onlineChannelsResult.error) {
            console.error('Error getting online channels: ', onlineChannelsResult.message);
            liveChannelsCount = 0;
        } else {
            liveChannelsCount = onlineChannelsResult.data?.length || 0;
        }

        await cacheClient.hSet('site:analytics:channels', 'registered', String(channelsCount));
        await cacheClient.hSet('site:analytics:channels', 'live', String(liveChannelsCount));
        await cacheClient.hSet('site:analytics:channels', 'active', String(activeChannelsCount));

        await cacheClient.set('site:analytics:start', '1');
        return true;
    } catch (error) {
        console.error('Error starting site analytics: ', error);
        return false;
    }
}

export async function getSiteAnalytics(filter: string | null = null): Promise<string | Record<string, string> | null> {
    const cacheClient = await getDragonflyClient('SiteAnalytics');

    if (filter) {
        const value = await cacheClient.hGet('site:analytics:channels', filter);
        return value;
    }

    const all = await cacheClient.hGetAll('site:analytics:channels');
    return all;
}

export async function incrementSiteAnalytics(filter: string, value: number = 1): Promise<void> {
    const cacheClient = await getDragonflyClient('SiteAnalytics');
    await cacheClient.hIncrBy('site:analytics:channels', filter, value);

    console.log(`Incrementing ${filter} by ${value}`);
}

export async function decrementSiteAnalytics(filter: string, value: number = 1): Promise<void> {
    const cacheClient = await getDragonflyClient('SiteAnalytics');
    await cacheClient.hIncrBy('site:analytics:channels', filter, -value);

    console.log(`Decrementing ${filter} by ${value}`);
}
