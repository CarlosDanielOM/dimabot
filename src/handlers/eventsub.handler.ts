import ChatHistory from "../classes/chat_history.js";
import TwitchStreamers from "../classes/twitch_streamers.class.js";
import type { IChatMessage, ITwitchEventData, ITwitchSubscriptionData, IRaidEventData } from "../interfaces/twitch/eventsub.interface.js";
import EventsubSchema, { type IEventsub } from "../schemas/eventsub.schema.js";
import { getDragonflyClient } from "../utils/databases/dragonfly.database.js";
import { messageHandler } from "./message.handler.js";
import { raidHandler } from "./raid.handler.js";
import { info as logInfo } from "../utils/logger.js";
//* TODO Redeem handler
//* TODO Functions



export const eventsubHandler = async (subscriptionData: ITwitchSubscriptionData, eventData: ITwitchEventData) => {
    const cache = await getDragonflyClient('Eventsub');
    let chatEnabled = true;
    let STREAMER = await TwitchStreamers.getTwitchAccountById(eventData?.broadcaster_user_id ?? '');
    if(!STREAMER) {
        STREAMER = await TwitchStreamers.getTwitchAccountById(eventData?.to_broadcaster_user_id ?? '');
        if(!STREAMER) {
            console.log({error: 'Streamer not found', user_id: eventData?.broadcaster_user_id ?? eventData?.to_broadcaster_user_id}, `(${eventData?.broadcaster_user_name ?? eventData?.to_broadcaster_user_name})`);
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

    switch(type) {
        case 'channel.chat.message':
            messageHandler(STREAMER.id, eventData as IChatMessage);
            break;
        case 'channel.raid':
            await raidHandler(eventData as IRaidEventData, eventsubData);
            break;
    }
}