import type { ICondition, ITransport } from "../../schemas/eventsub.schema.js";

interface ITwitchUser {
    user_id: string;
    user_name: string;
    user_login: string;
}

interface ITwitchBroadcaster {
    broadcaster_user_id: string;
    broadcaster_user_name: string;
    broadcaster_user_login: string;
}

interface ITwitchChatter {
    chatter_user_id: string;
    chatter_user_name: string;
    chatter_user_login: string;
}

interface ITwitchModerator {
    moderator_user_id: string;
    moderator_user_name: string;
    moderator_user_login: string;
}

interface ITwitchRaidBroadcasters {
    to_broadcaster_user_id: string;
    to_broadcaster_user_name: string;
    to_broadcaster_user_login: string;
    from_broadcaster_user_id: string;
    from_broadcaster_user_name: string;
    from_broadcaster_user_login: string;
}

type ITwitchEventBase = Partial<ITwitchUser & ITwitchBroadcaster & ITwitchModerator & ITwitchChatter & ITwitchRaidBroadcasters>;

export interface ITwitchSubscription {
    id: string;
    type: string;
    version: string;
    status: string;
    cost: number;
    condition: ICondition;
    transport: ITransport;
    created_at: string;
}

interface IEventMessage {
    text: string;
    fragments: {
        text: string;
        type: 'text' | 'emote' | 'cheermote' | 'mention';
        emote?: {
            id: string;
            emote_set_id: string;
            owner_id: string;
            format: ('static' | 'animated')[];
        };
        cheermote?: {
            prefix: string;
            bits: number;
            tier: number;
        };
        mention?: {
            user: ITwitchUser;
        }
    }[];
}

interface IEventPowerUp {
    type: 'message_effect' | 'celebration' | 'gigantify_an_emote';
    emote?: {
        id: string;
        name: string;
    };
    message_effect_id?: string;
}

interface IBitUseEvent extends ITwitchEventBase {
    bits: number;
    type: 'cheer' | 'power_up';
    message?: IEventMessage;
    power_up?: IEventPowerUp;
}

interface IBadge {
    set_id: string;
    id: string;
    info: string;
}

interface IReply {
    parent_message_id: string;
    parent_message_body: string;
    parent_user_id: string;
    parent_user_name: string;
    parent_user_login: string;
    thread_user_id: string;
    thread_user_name: string;
    thread_user_login: string;
}

export interface IChatMessage extends ITwitchEventBase {
    message_id: string;
    message: IEventMessage;
    message_type: 'text' | 'channel_points_highlighted' | 'channel_points_sub_only' | 'user_intro' | 'power_ups_message_effect' | 'power_ups_gigantify_emote';
    badges: IBadge[];
    cheer: {
        bits: number;
    };
    color: string;
    reply?: IReply;
    channel_points_custom_reward_id?: string;
    source_broadcaster_user_id?: string;
    source_broadcaster_user_name?: string;
    source_broadcaster_user_login?: string;
    source_message_id?: string;
    source_badges?: IBadge[];
    is_source_only?: boolean;
}

export type ITwitchEventData = IBitUseEvent | IChatMessage;
export type ITwitchSubscriptionData = ITwitchSubscription;