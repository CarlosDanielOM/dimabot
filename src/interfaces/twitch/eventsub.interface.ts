import type { ICondition, ITransport } from "../../schemas/eventsub.schema.js";

export interface IRedemptionReward {
    id: string;
    title: string;
    prompt: string;
    cost: number;
    should_redemptions_skip_request_queue: boolean;
}

export interface IRedemptionEvent {
    id: string;
    broadcaster_user_id: string;
    broadcaster_user_login: string;
    broadcaster_user_name: string;
    user_id: string;
    user_login: string;
    user_name: string;
    reward: IRedemptionReward;
    user_input: string;
    status: string;
    redeemed_at: string;
}

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

export interface IBitUseEvent extends ITwitchEventBase {
    bits: number;
    type: 'cheer' | 'power_up';
    message?: IEventMessage;
    power_up?: IEventPowerUp;
    is_anonymous?: boolean;
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

export interface IRaidEventData extends ITwitchEventBase {
    viewers: number;
    to_broadcaster_user_id: string;
    to_broadcaster_user_login: string;
    to_broadcaster_user_name: string;
    from_broadcaster_user_id: string;
    from_broadcaster_user_login: string;
    from_broadcaster_user_name: string;
}

export interface IFollowEvent {
    user_id: string;
    user_name: string;
    user_login: string;
    broadcaster_user_id: string;
    broadcaster_user_name: string;
    broadcaster_user_login: string;
    followed_at: string;
}

export interface IStreamOnlineEvent {
    broadcaster_user_id: string;
    broadcaster_user_name: string;
    broadcaster_user_login: string;
    started_at: string;
    type: 'live';
    id: string;
}

export interface IStreamOfflineEvent {
    broadcaster_user_id: string;
    broadcaster_user_name: string;
    broadcaster_user_login: string;
}

export interface IAdBreakEvent {
    broadcaster_user_id: string;
    broadcaster_user_name: string;
    broadcaster_user_login: string;
    requester_user_id: string;
    requester_user_name: string;
    requester_user_login: string;
    duration_seconds: number;
    started_at: string;
    is_automatic: boolean;
}

export interface IBanEvent {
    broadcaster_user_id: string;
    broadcaster_user_name: string;
    broadcaster_user_login: string;
    user_id: string;
    user_name: string;
    user_login: string;
    moderator_user_id: string;
    moderator_user_name: string;
    moderator_user_login: string;
    reason: string;
    ends_at: string | null;
    is_permanent: boolean;
}

export type ITwitchEventData =
    | IBitUseEvent
    | IChatMessage
    | IRaidEventData
    | IRedemptionEvent
    | IFollowEvent
    | IStreamOnlineEvent
    | IStreamOfflineEvent
    | IAdBreakEvent
    | IBanEvent;
export type ITwitchSubscriptionData = ITwitchSubscription;