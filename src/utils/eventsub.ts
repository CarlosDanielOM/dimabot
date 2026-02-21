import { getTwitchStreamerHeaderById, type TwitchHeaderResult } from './header.js';
import { getTwitchHelixUrl } from './links.js';
import { getAppToken } from './tokens.js';
import TwitchStreamers from '../classes/twitch_streamers.class.js';
import EventsubSchema, { type IEventsub, type ICondition } from '../schemas/eventsub.schema.js';

export interface SubscriptionType {
    type: string;
    version: string;
    condition: ICondition;
    config?: Partial<Pick<IEventsub, 'message' | 'endMessage' | 'endEnabled' | 'clipEnabled' | 'minViewers' | 'delay' | 'cheerTiers'>>;
}

export interface SubscribeTwitchEventResponse {
    _id?: string;
    id: string;
    status: string;
    type: string;
    version: string;
    condition: ICondition;
    created_at: string;
    transport: {
        method: string;
        callback: string;
    };
    cost: number;
    [key: string]: any;
}

export interface SubscribeTwitchEventError {
    error: string;
    message: string;
    status: number;
}

const MOD_ID = '698614112';

export const SUBSCRIPTION_TYPES: SubscriptionType[] = [
    {
        type: 'channel.chat.message',
        version: '1',
        condition: {
            broadcaster_user_id: '698614112',
            user_id: MOD_ID
        }
    },
    {
        type: 'channel.follow',
        version: '2',
        condition: {
            broadcaster_user_id: '698614112',
            moderator_user_id: MOD_ID
        },
        config: {
            message: '$(user) has followed, Welcome to the stream!'
        }
    },
    {
        type: 'stream.online',
        version: '1',
        condition: {
            broadcaster_user_id: '698614112'
        },
        config: {
            message: '$(twitch.channel) is now live! Playing $(twitch.game)'
        }
    },
    {
        type: 'stream.offline',
        version: '1',
        condition: {
            broadcaster_user_id: '698614112'
        },
        config: {
            message: '$(twitch.channel) is now offline!'
        }
    },
    {
        type: 'channel.raid',
        version: '1',
        condition: {
            to_broadcaster_user_id: '698614112'
        },
        config: {
            message: '$(twitch.channel) is raiding with $(raid.viewers) viewers!',
            clipEnabled: true
        }
    },
    {
        type: 'channel.poll.progress',
        version: '1',
        condition: {
            broadcaster_user_id: '698614112'
        }
    },
    {
        type: 'channel.prediction.progress',
        version: '1',
        condition: {
            broadcaster_user_id: '698614112'
        }
    },
    {
        type: 'channel.hype_train.begin',
        version: '2',
        condition: {
            broadcaster_user_id: '698614112'
        },
        config: {
            message: 'Hype train has started! It started at $(hypetrain.progress) and will end at $(hypetrain.end)'
        }
    },
    {
        type: 'channel.hype_train.progress',
        version: '2',
        condition: {
            broadcaster_user_id: '698614112'
        },
        config: {
            message: 'Hype train has progressed to level $(hypetrain.level)!'
        }
    },
    {
        type: 'channel.hype_train.end',
        version: '2',
        condition: {
            broadcaster_user_id: '698614112'
        },
        config: {
            message: 'Hype train has ended! It ended at level $(hypetrain.level) with $(hypetrain.progress)% progress!'
        }
    },
    {
        type: 'channel.shoutout.receive',
        version: '1',
        condition: {
            broadcaster_user_id: '698614112',
            moderator_user_id: MOD_ID
        },
        config: {
            message: '$(shoutout.channel) has sent a shoutout to $(twitch.channel)!'
        }
    },
    {
        type: 'channel.ad_break.begin',
        version: '1',
        condition: {
            broadcaster_user_id: '698614112'
        },
        config: {
            message: '$(ad.time) seconds of ad break has begun!',
            endMessage: 'Ad break has ended!',
            endEnabled: true
        }
    },
    {
        type: 'user.update',
        version: '1',
        condition: {
            user_id: '698614112'
        }
    },
    {
        type: 'channel.cheer',
        version: '1',
        condition: {
            broadcaster_user_id: '698614112'
        },
        config: {
            message: '$(user) cheered $(cheer.amount) bits!'
        }
    },
    {
        type: 'channel.subscribe',
        version: '1',
        condition: {
            broadcaster_user_id: '698614112'
        },
        config: {
            message: '$(user) subscribed with $(sub.tier) for the first time!'
        }
    },
    {
        type: 'channel.subscription.gift',
        version: '1',
        condition: {
            broadcaster_user_id: '698614112'
        },
        config: {
            message: '$(user) gifted a $(sub.tier) subscription to $(gifted.user)!'
        }
    },
    {
        type: 'channel.subscription.message',
        version: '1',
        condition: {
            broadcaster_user_id: '698614112'
        },
        config: {
            message: '$(user) resubscribed with $(sub.tier) for $(sub.months) months on a row!'
        }
    },
    {
        type: 'channel.update',
        version: '1',
        condition: {
            broadcaster_user_id: '698614112'
        }
    },
    {
        type: 'channel.bits.use',
        version: '1',
        condition: {
            broadcaster_user_id: '698614112'
        }
    },
    {
        type: 'automod.message.hold',
        version: '1',
        condition: {
            broadcaster_user_id: '698614112'
        }
    }
];

export async function subscribeTwitchEvent(
    channelID: string,
    type: string,
    version: string,
    condition: ICondition,
    config?: Partial<Pick<IEventsub, 'message' | 'endMessage' | 'endEnabled' | 'clipEnabled' | 'minViewers' | 'delay' | 'cheerTiers'>>
): Promise<SubscribeTwitchEventResponse | SubscribeTwitchEventError> {
    const streamer = await TwitchStreamers.getTwitchAccountById(channelID);
    if (!streamer) {
        return {
            error: 'Streamer not found',
            message: 'Streamer not found',
            status: 404
        };
    }

    const streamerHeaderResult = await getTwitchStreamerHeaderById(channelID);
    if (streamerHeaderResult.error || !streamerHeaderResult.header) {
        return {
            error: 'Failed to get streamer header',
            message: streamerHeaderResult.message,
            status: 500
        };
    }

    const appAccessToken = await getAppToken('twitch');

    if (!appAccessToken) {
        console.error('Error getting app access token');
        return {
            error: 'Error getting app access token',
            message: 'Error getting app access token',
            status: 500
        };
    }

    const headers = {
        ...streamerHeaderResult.header,
        Authorization: `Bearer ${appAccessToken}`
    };

    const response = await fetch(getTwitchHelixUrl('eventsub/subscriptions'), {
        method: 'POST',
        headers: headers as unknown as Record<string, string>,
        body: JSON.stringify({
            type,
            version,
            condition,
            transport: {
                method: 'webhook',
                callback: `https://subscriptions.domdimabot.com/eventsub`,
                secret: process.env.TWITCH_EVENTSUB_SECRET
            }
        })
    });

    const data = await response.json();

    if (data.error) {
        console.error(`Error subscribing to ${type} for ${channelID}: ${data.error}`);
        return data;
    }

    const subscriptionData = data.data[0];

    const newEventSub = new EventsubSchema({
        id: subscriptionData.id,
        status: subscriptionData.status,
        type: subscriptionData.type,
        version: subscriptionData.version,
        condition: subscriptionData.condition,
        created_at: subscriptionData.created_at,
        transport: subscriptionData.transport,
        cost: subscriptionData.cost,
        channel: streamer.name,
        channelID: channelID
    });

    if (config) {
        Object.assign(newEventSub, config);
    }

    await newEventSub.save();

    return {
        _id: newEventSub._id.toString(),
        id: newEventSub.id,
        status: newEventSub.status,
        type: newEventSub.type,
        version: newEventSub.version,
        condition: newEventSub.condition,
        created_at: newEventSub.created_at,
        transport: newEventSub.transport,
        cost: newEventSub.cost,
        channel: newEventSub.channel,
        channelID: newEventSub.channelID,
        enabled: newEventSub.enabled,
        message: newEventSub.message,
        endMessage: newEventSub.endMessage,
        endEnabled: newEventSub.endEnabled,
        minViewers: newEventSub.minViewers,
        temporalBanMessage: newEventSub.temporalBanMessage,
        clipEnabled: newEventSub.clipEnabled,
        delay: newEventSub.delay,
        cheerTiers: newEventSub.cheerTiers,
        todayFollows: newEventSub.todayFollows,
    };
}

export async function getEventsubs(): Promise<any> {
    const appToken = await getAppToken('twitch');

    const headers = {
        'Authorization': `Bearer ${appToken}`,
        'Client-Id': process.env.CLIENT_ID!,
        'Content-Type': 'application/json'
    };

    const response = await fetch(getTwitchHelixUrl('eventsub/subscriptions'), {
        headers: headers as unknown as Record<string, string>
    });

    return await response.json();
}

export async function unsubscribeTwitchEvent(id: string): Promise<Response | any> {
    const appAccessToken = await getAppToken('twitch');

    if (!appAccessToken) {
        console.error('Error getting app access token');
        return {
            error: 'Error getting app access token',
            message: 'Error getting app access token',
            status: 500
        };
    }

    const headers = {
        'Authorization': `Bearer ${appAccessToken}`,
        'Client-Id': process.env.CLIENT_ID!,
        'Content-Type': 'application/json'
    };

    const response = await fetch(getTwitchHelixUrl('eventsub/subscriptions') + `?id=${id}`, {
        method: 'DELETE',
        headers: headers as unknown as Record<string, string>
    });

    if (response.status === 204) {
        await EventsubSchema.deleteOne({ id });
        return response;
    }

    const data = await response.json();

    if (data.error) {
        console.error(`Error unsubscribing to ${id}: ${data.error}`);
        return data;
    }

    return data;
}
