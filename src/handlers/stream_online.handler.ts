import { sendTwitchChatMessage, type SendMessageContext } from "../functions/chats/send_message.chat.js";
import type { IEventsub } from "../schemas/eventsub.schema.js";
import type { IStreamOnlineEvent } from "../interfaces/twitch/eventsub.interface.js";
import { getChannelEditors } from "../functions/channels/get_editors.channel.js";
import { unVIPExpiredUser } from "../functions/redemptions/unvipexpired.redemption.js";
import { incrementSiteAnalytics } from "../utils/siteanalytics.js";
import TwitchStreamers from "../classes/twitch_streamers.class.js";
import { error as logError, info as logInfo } from "../utils/logger.js";
import { recordStreamOnlineEvent } from "../utils/stream_analytics.js";
import { loadChannelTimersIntoCache } from "../utils/timer_cache.js";
import { getDragonflyClient } from "../utils/databases/dragonfly.database.js";

const STREAM_ONLINE_DEDUPE_TTL_SECONDS = Math.max(60 * 60, Number(process.env.STREAM_ONLINE_DEDUPE_TTL_SECONDS || 60 * 60 * 24));

interface StreamOnlineHandlerResponse {
    error: boolean;
    message: string;
}

export async function streamOnlineHandler(
    eventData: IStreamOnlineEvent,
    eventsubData: IEventsub,
    chatEnabled: boolean
): Promise<StreamOnlineHandlerResponse> {
    try {
        const { broadcaster_user_id, broadcaster_user_login } = eventData;
        const streamID = String(eventData.id || `stream-${broadcaster_user_id}-${eventData.started_at || 'unknown'}`);
        const cache = await getDragonflyClient('streamOnlineHandler');
        const dedupeKey = `twitch:${broadcaster_user_id}:stream.online:${streamID}`;
        const dedupeResult = await cache.set(dedupeKey, String(eventData.started_at || new Date().toISOString()), {
            NX: true,
            EX: STREAM_ONLINE_DEDUPE_TTL_SECONDS
        });

        if (dedupeResult !== 'OK') {
            await logInfo({
                message: 'Duplicate stream.online notification ignored',
                channelID: broadcaster_user_id,
                streamID
            }, { channelId: broadcaster_user_id, destination: 'cache' });

            return {
                error: false,
                message: 'Duplicate stream.online notification ignored'
            };
        }

        if (!chatEnabled) {
            await recordStreamOnlineEvent({
                channelID: broadcaster_user_id,
                channel: broadcaster_user_login,
                streamID,
                startedAt: eventData.started_at
            });
            await loadChannelTimersIntoCache(broadcaster_user_id);
            await getChannelEditors(broadcaster_user_id, true);
            await unVIPExpiredUser(eventData);
            await incrementSiteAnalytics('live', 1);
            return {
                error: false,
                message: 'Chat is disabled'
            };
        }

        const streamer = await TwitchStreamers.getTwitchAccountById(broadcaster_user_id);

        if (streamer && (streamer as any).up_to_date_permissions === "banana") {
            const message = "Por nuevas actualizaciones de Twitch, por favor vuelva a autorizar el bot para que las nuevas funcionalidades esten disponibles y el bot vuelva a estar activo. Gracias";
            await sendTwitchChatMessage(broadcaster_user_id, message);

            await logInfo({
                message: 'Permission warning sent',
                channelID: broadcaster_user_id,
                reason: 'Outdated Twitch permissions'
            }, { channelId: broadcaster_user_id, destination: 'both' });
        }

        if (eventsubData.message) {
            const context: SendMessageContext = {
                channelID: broadcaster_user_id,
                eventData: eventData
            };

            await sendTwitchChatMessage(broadcaster_user_id, eventsubData.message, null, context);
        }

        await getChannelEditors(broadcaster_user_id, true);

        await unVIPExpiredUser(eventData);

        await recordStreamOnlineEvent({
            channelID: broadcaster_user_id,
            channel: broadcaster_user_login,
            streamID,
            startedAt: eventData.started_at
        });

        await loadChannelTimersIntoCache(broadcaster_user_id);

        await incrementSiteAnalytics('live', 1);

        await logInfo({
            message: 'Stream went online',
            channelID: broadcaster_user_id
        }, { channelId: broadcaster_user_id, destination: 'both' });

        return {
            error: false,
            message: 'Stream online handled'
        };
    } catch (err) {
        await logError({
            function: 'streamOnlineHandler',
            eventData,
            eventsubData,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
        }, { channelId: eventData.broadcaster_user_id, destination: 'both' });

        return {
            error: true,
            message: 'Internal server error'
        };
    }
}
