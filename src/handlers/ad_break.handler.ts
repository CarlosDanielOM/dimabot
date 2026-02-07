import { sendTwitchChatMessage, type SendMessageContext } from "../functions/chats/send_message.chat.js";
import type { IEventsub } from "../schemas/eventsub.schema.js";
import type { IAdBreakEvent } from "../interfaces/twitch/eventsub.interface.js";
import { error as logError, info as logInfo } from "../utils/logger.js";

interface AdBreakHandlerResponse {
    error: boolean;
    message: string;
}

export async function adBreakHandler(
    eventData: IAdBreakEvent,
    eventsubData: IEventsub,
    chatEnabled: boolean
): Promise<AdBreakHandlerResponse> {
    try {
        const { broadcaster_user_id, duration_seconds } = eventData;

        if (!chatEnabled) {
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

        if (eventsubData.endEnabled) {
            setTimeout(async () => {
                if (eventsubData.endMessage) {
                    const context: SendMessageContext = {
                        channelID: broadcaster_user_id,
                        eventData: eventData
                    };

                    await sendTwitchChatMessage(broadcaster_user_id, eventsubData.endMessage, null, context);
                }
            }, duration_seconds * 1000);
        }

        await logInfo({
            message: 'Ad break started',
            channelID: broadcaster_user_id,
            duration: duration_seconds,
            endEnabled: eventsubData.endEnabled
        }, { channelId: broadcaster_user_id, destination: 'both' });

        return {
            error: false,
            message: 'Ad break handled'
        };
    } catch (err) {
        await logError({
            function: 'adBreakHandler',
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
