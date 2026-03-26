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
import { error as logError, info as logInfo } from "../utils/logger.js";
import {
    recordStreamBitsEvent,
    recordStreamFollowEvent,
    recordStreamSubEvent,
    recordSubscriptionLedgerEnd,
    recordSubscriptionLedgerStart
} from "../utils/stream_analytics.js";
import {
    CANONICAL_BITS_EVENT_TYPE,
    canonicalizeEventsubType,
    getEquivalentEventsubTypes,
    isLegacyBitsEventType,
    migrateLegacyBitsEventsubs
} from "../utils/eventsub.js";
import type { BitsEventsubMigrationResult } from "../utils/eventsub.js";
//* TODO Redeem handler
//* TODO Functions

interface SubscriptionEventData {
    broadcaster_user_id?: string;
    broadcaster_user_login?: string;
    broadcaster_user_name?: string;
    user_id?: string;
    user_login?: string;
    user_name?: string;
    tier?: string;
    sub_tier?: string;
    subscription_tier?: string;
    is_gift?: boolean;
    subscribed_at?: string;
    ended_at?: string;
    total?: number;
}



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
    const canonicalType = canonicalizeEventsubType(type);
    const equivalentTypes = getEquivalentEventsubTypes(type);

    let bitsMigrationResult: BitsEventsubMigrationResult | null = null;
    if (isLegacyBitsEventType(type)) {
        bitsMigrationResult = await migrateLegacyBitsEventsubs(STREAMER.id).catch(async (migrationError) => {
            console.error('Error migrating legacy bits eventsubs:', {
                type,
                channelID: STREAMER.id,
                error: migrationError instanceof Error ? migrationError.message : String(migrationError),
                stack: migrationError instanceof Error ? migrationError.stack : undefined,
                timestamp: new Date().toISOString()
            });

            await logError({
                function: 'eventsubHandler.migrateLegacyBitsEventsubs',
                type,
                channelID: STREAMER.id,
                error: migrationError instanceof Error ? migrationError.message : String(migrationError),
                stack: migrationError instanceof Error ? migrationError.stack : undefined,
                timestamp: new Date().toISOString()
            }, { channelId: STREAMER.id, destination: 'both' });

            return null;
        });
    }

    const shouldSkipLegacyBitsEvent = isLegacyBitsEventType(type)
        && Boolean(bitsMigrationResult?.hadCanonicalBeforeMigration);

    if (shouldSkipLegacyBitsEvent) {
        await logInfo({
            message: 'Skipping legacy bits event because canonical subscription exists',
            type,
            canonicalType,
            channelID: STREAMER.id
        }, { channelId: STREAMER.id, destination: 'both' });
        return;
    }

    let eventsubData: IEventsub | null = null;

    if (canonicalType === CANONICAL_BITS_EVENT_TYPE) {
        eventsubData = bitsMigrationResult?.canonicalEventsub
            || await EventsubSchema.findOne({ channelID: STREAMER.id, type: CANONICAL_BITS_EVENT_TYPE })
            || await EventsubSchema.findOne({ channelID: STREAMER.id, type: { $in: equivalentTypes.filter((eventType) => eventType !== CANONICAL_BITS_EVENT_TYPE) } });
    } else {
        eventsubData = await EventsubSchema.findOne({
            channelID: STREAMER.id,
            type: canonicalType
        });
    }

    if(!eventsubData) {
        eventsubData = {
            id: '',
            status: '',
            type: canonicalType,
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

    const resolveTier = (source: unknown): string | undefined => {
        if (!source || typeof source !== 'object') {
            return undefined;
        }

        const data = source as SubscriptionEventData;
        const rawTier = data.tier ?? data.sub_tier ?? data.subscription_tier;
        return typeof rawTier === 'string' ? rawTier : undefined;
    };

    const resolveGiftQuantity = (source: unknown): number => {
        if (!source || typeof source !== 'object') {
            return 1;
        }

        const data = source as SubscriptionEventData;
        const total = Number(data.total);
        if (Number.isFinite(total) && total > 0) {
            return Math.round(total);
        }
        return 1;
    };

    const trackAnalytics = async (): Promise<void> => {
        const subscriptionEvent = eventData as unknown as SubscriptionEventData;

        switch (type) {
            case CANONICAL_BITS_EVENT_TYPE:
            case 'channel.cheer':
            case 'channel.bit.use': {
                if (type !== CANONICAL_BITS_EVENT_TYPE && bitsMigrationResult?.hadCanonicalBeforeMigration) {
                        break;
                }

                const bits = Number((eventData as IBitUseEvent).bits);
                if (Number.isFinite(bits) && bits > 0) {
                    await recordStreamBitsEvent({
                        channelID: STREAMER.id,
                        bits: Math.round(bits)
                    });
                }
                break;
            }
            case 'channel.follow':
                await recordStreamFollowEvent({ channelID: STREAMER.id });
                break;
            case 'channel.subscribe':
            case 'channel.subscription.message':
                await recordSubscriptionLedgerStart({
                    platform: 'twitch',
                    streamer_id: STREAMER.id,
                    streamer_login: subscriptionEvent.broadcaster_user_login,
                    streamer_name: subscriptionEvent.broadcaster_user_name,
                    user_id: String(subscriptionEvent.user_id || ''),
                    user_login: subscriptionEvent.user_login,
                    user_name: subscriptionEvent.user_name,
                    tier: resolveTier(subscriptionEvent),
                    is_gift: Boolean(subscriptionEvent.is_gift),
                    subbed_at: subscriptionEvent.subscribed_at
                });
                await recordStreamSubEvent({
                    channelID: STREAMER.id,
                    quantity: 1,
                    tier: resolveTier(subscriptionEvent)
                });
                break;
            case 'channel.subscription.gift':
                await recordStreamSubEvent({
                    channelID: STREAMER.id,
                    quantity: resolveGiftQuantity(subscriptionEvent),
                    tier: resolveTier(subscriptionEvent)
                });
                break;
            case 'channel.subscription.end':
                await recordSubscriptionLedgerEnd({
                    platform: 'twitch',
                    streamer_id: STREAMER.id,
                    user_id: String(subscriptionEvent.user_id || ''),
                    ended_at: subscriptionEvent.ended_at
                });
                break;
        }
    };

    await trackAnalytics().catch(async (analyticsError) => {
        console.error('Error in eventsubHandler.trackAnalytics:', {
            type,
            channelID: STREAMER.id,
            error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError),
            stack: analyticsError instanceof Error ? analyticsError.stack : undefined,
            timestamp: new Date().toISOString()
        });

        await logError({
            function: 'eventsubHandler.trackAnalytics',
            type,
            channelID: STREAMER.id,
            error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError),
            stack: analyticsError instanceof Error ? analyticsError.stack : undefined,
            timestamp: new Date().toISOString()
        }, { channelId: STREAMER.id, destination: 'both' });
    });

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
        case CANONICAL_BITS_EVENT_TYPE:
        case 'channel.bit.use':
        case 'channel.cheer':
            await cheerHandler(eventData as IBitUseEvent, eventsubData, chatEnabled);
            break;
        case 'channel.channel_points_custom_reward_redemption.add':
            await redemptionHandler(eventData as IRedemptionEvent, chatEnabled);
            break;
        case 'channel.follow':
            await followHandler(eventData as IFollowEvent, eventsubData, chatEnabled);
            break;
        case 'stream.online':
            await streamOnlineHandler(eventData as IStreamOnlineEvent, eventsubData, chatEnabled);
            break;
        case 'stream.offline':
            await streamOfflineHandler(eventData as IStreamOfflineEvent, eventsubData, chatEnabled);
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
        case 'channel.subscription.end':
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
