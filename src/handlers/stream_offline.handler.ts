import { sendTwitchChatMessage, type SendMessageContext } from "../functions/chats/send_message.chat.js";
import type { IEventsub } from "../schemas/eventsub.schema.js";
import type { IStreamOfflineEvent } from "../interfaces/twitch/eventsub.interface.js";
import { resetRedemptionCost } from "../functions/redemptions/resetredemptioncost.redemption.js";
import { clearChannelCache, resetSumimetro } from "../utils/cache.js";
import { clearSpeechFiles } from "../utils/speech.js";
import { decrementSiteAnalytics } from "../utils/siteanalytics.js";
import ChatHistory from "../classes/chat_history.js";
import { getDragonflyClient } from "../utils/databases/dragonfly.database.js";
import { error as logError, info as logInfo } from "../utils/logger.js";
import { recordStreamOfflineEvent } from "../utils/stream_analytics.js";
import { unloadChannelTimersFromCache } from "../utils/timer_cache.js";

interface StreamOfflineHandlerResponse {
    error: boolean;
    message: string;
}

export async function streamOfflineHandler(
    eventData: IStreamOfflineEvent,
    eventsubData: IEventsub,
    chatEnabled: boolean
): Promise<StreamOfflineHandlerResponse> {
    try {
        const { broadcaster_user_id } = eventData;

        if (!chatEnabled) {
            await recordStreamOfflineEvent({ channelID: broadcaster_user_id });
            await unloadChannelTimersFromCache(broadcaster_user_id);
            await resetRedemptionCost(broadcaster_user_id);
            await resetSumimetro(broadcaster_user_id);
            await clearChannelCache(broadcaster_user_id);
            await clearSpeechFiles(broadcaster_user_id);
            await ChatHistory.clearHistory(broadcaster_user_id);
            const cache = await getDragonflyClient('cleanup');
            try {
                await cache.del(`${broadcaster_user_id}:channel:editors`);
            } catch (error) {
                console.log({error: 'Error deleting editors from cache', message: error});
            }
            await decrementSiteAnalytics('live', 1);

            return {
                error: false,
                message: 'Chat is disabled'
            };
        }

        if (eventsubData.message) {
            const context: SendMessageContext = {
                channelID: broadcaster_user_id,
                eventData: eventData
            };

            await sendTwitchChatMessage(broadcaster_user_id, eventsubData.message, null, context);
        }

        await resetRedemptionCost(broadcaster_user_id);

        await recordStreamOfflineEvent({ channelID: broadcaster_user_id });

        await unloadChannelTimersFromCache(broadcaster_user_id);

        await resetSumimetro(broadcaster_user_id);

        await clearChannelCache(broadcaster_user_id);

        await clearSpeechFiles(broadcaster_user_id);

        await ChatHistory.clearHistory(broadcaster_user_id);

        const cache = await getDragonflyClient('cleanup');
        try {
            await cache.del(`${broadcaster_user_id}:channel:editors`);
        } catch (error) {
            console.log({error: 'Error deleting editors from cache', message: error});
        }

        await decrementSiteAnalytics('live', 1);

        await logInfo({
            message: 'Stream went offline',
            channelID: broadcaster_user_id
        }, { channelId: broadcaster_user_id, destination: 'both' });

        return {
            error: false,
            message: 'Stream offline handled'
        };
    } catch (err) {
        await logError({
            function: 'streamOfflineHandler',
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
