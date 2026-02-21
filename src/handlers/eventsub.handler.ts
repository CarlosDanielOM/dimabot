import ChatHistory from "../classes/chat_history.js";
import TwitchStreamers from "../classes/twitch_streamers.class.js";
import type { IChatMessage, ITwitchEventData, ITwitchSubscriptionData, IRaidEventData, IBitUseEvent, IRedemptionEvent, IFollowEvent, IStreamOnlineEvent, IStreamOfflineEvent, IAdBreakEvent, IBanEvent } from "../interfaces/twitch/eventsub.interface.js";
import EventsubSchema, { type IEventsub } from "../schemas/eventsub.schema.js";
import { getDragonflyClient } from "../utils/databases/dragonfly.database.js";
import { messageHandler } from "./message.handler.js";
import { raidHandler } from "./raid.handler.js";
import { cheerHandler } from "./cheer.handler.js";
import { sendTwitchChatMessage } from "../functions/chats/send_message.chat.js";
import { redemptionHandler } from "./redemption.handler.js";
import { followHandler } from "./follow.handler.js";
import { streamOnlineHandler } from "./stream_online.handler.js";
import { streamOfflineHandler } from "./stream_offline.handler.js";
import { adBreakHandler } from "./ad_break.handler.js";
import { banHandler } from "./ban.handler.js";
import { info as logInfo } from "../utils/logger.js";
//* TODO Redeem handler
//* TODO Functions



export const eventsubHandler = async (subscriptionData: ITwitchSubscriptionData, eventData: ITwitchEventData) => {
    const cache = await getDragonflyClient('Eventsub');
    let chatEnabled = true;
    let STREAMER = await TwitchStreamers.getTwitchAccountById(eventData?.broadcaster_user_id ?? '');
    if(!STREAMER) {
        STREAMER = await TwitchStreamers.getTwitchAccountById((eventData as IRaidEventData)?.to_broadcaster_user_id ?? '');
        if(!STREAMER) {
            console.log({error: 'Streamer not found', user_id: eventData?.broadcaster_user_id ?? (eventData as IRaidEventData)?.to_broadcaster_user_id}, `(${eventData?.broadcaster_user_name ?? (eventData as IRaidEventData)?.to_broadcaster_user_name})`);
            return;
        }
    }

    if(STREAMER.chat_enabled == 'false') chatEnabled = false

    const {type} = subscriptionData;

    let eventsubData: IEventsub | null = await EventsubSchema.findOne({type, channelID: STREAMER.id});
    if(!eventsubData) {
        eventsubData = {
            id: '',
            status: '',
            type: '',
            version: '',
            condition: {},
            created_at: '',
            transport: {
                method: '',
                callback: ''
            },
            cost: 0,
            channel: '',
            channelID: '',
            enabled: true,
            message: '',
            endMessage: '',
            endEnabled: false,
            minViewers: 0,
            temporalBanMessage: '',
            clipEnabled: false,
            delay: 0,
            cheerTiers: []
        }
        await logInfo({
            message: 'No data found for eventsub',
            type,
            condition: subscriptionData.condition
        }, { channelId: STREAMER.id, destination: 'both' });
        // logger({channelID: STREAMER.id, channel: STREAMER.name, error: 'No data found', type, condition: subscriptionData.condition}, true, STREAMER.id, 'eventsub not found');
        console.log({error: 'No data found', type, condition: subscriptionData.condition});
    }

    if(!eventsubData.enabled) return;

    const handleMessageOnlyEvent = async () => {
        if (!chatEnabled) return;

        const event = eventData as unknown as Record<string, unknown>;
        const channelID = String(
            event.broadcaster_user_id ||
            event.to_broadcaster_user_id ||
            STREAMER.id
        );

        if (!channelID || !eventsubData?.message) return;

        await sendTwitchChatMessage(channelID, eventsubData.message, null, {
            channelID,
            eventData,
            eventsubData
        });
    };

    switch(type) {
        case 'channel.chat.message':
            messageHandler(STREAMER.id, eventData as IChatMessage);
            break;
        case 'channel.raid':
            await raidHandler(eventData as IRaidEventData, eventsubData);
            break;
        case 'channel.bit.use':
        case 'channel.bits.use':
        case 'channel.cheer':
            await cheerHandler(eventData as IBitUseEvent, eventsubData, chatEnabled);
            break;
        case 'channel.channel_points_custom_reward_redemption.add':
            await redemptionHandler(eventData as IRedemptionEvent, chatEnabled);
            break;
        case 'channel.follow':
            followHandler(eventData as IFollowEvent, eventsubData, chatEnabled);
            break;
        case 'stream.online':
            streamOnlineHandler(eventData as IStreamOnlineEvent, eventsubData, chatEnabled);
            break;
        case 'stream.offline':
            streamOfflineHandler(eventData as IStreamOfflineEvent, eventsubData, chatEnabled);
            break;
        case 'channel.ad_break.begin':
            adBreakHandler(eventData as IAdBreakEvent, eventsubData, chatEnabled);
            break;
        case 'channel.ban':
            banHandler(eventData as IBanEvent, eventsubData, chatEnabled);
            break;
        case 'channel.subscribe':
        case 'channel.subscription.gift':
        case 'channel.subscription.message':
        case 'channel.shoutout.receive':
        case 'channel.hype_train.begin':
        case 'channel.hype_train.progress':
        case 'channel.hype_train.end':
        case 'channel.poll.progress':
        case 'channel.prediction.progress':
        case 'channel.update':
        case 'user.update':
        case 'automod.message.hold':
            await handleMessageOnlyEvent();
            break;
    }
}
