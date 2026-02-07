import { sendTwitchChatMessage, type SendMessageContext } from "../functions/chats/send_message.chat.js";
import type { IEventsub } from "../schemas/eventsub.schema.js";
import type { IBanEvent } from "../interfaces/twitch/eventsub.interface.js";
import { error as logError, info as logInfo } from "../utils/logger.js";

interface BanHandlerResponse {
    error: boolean;
    message: string;
}

export async function banHandler(
    eventData: IBanEvent,
    eventsubData: IEventsub,
    chatEnabled: boolean
): Promise<BanHandlerResponse> {
    try {
        const { broadcaster_user_id, is_permanent } = eventData;

        if (!chatEnabled) {
            return {
                error: false,
                message: 'Chat is disabled'
            };
        }

        let messageToSend: string;

        if (is_permanent) {
            messageToSend = eventsubData.message;
        } else {
            messageToSend = eventsubData.temporalBanMessage || '';
        }

        if (!messageToSend || messageToSend.trim() === '') {
            return {
                error: false,
                message: 'No message to send'
            };
        }

        const context: SendMessageContext = {
            channelID: broadcaster_user_id,
            eventData: eventData
        };

        await sendTwitchChatMessage(broadcaster_user_id, messageToSend, null, context);

        await logInfo({
            message: 'Ban handled',
            channelID: broadcaster_user_id,
            isPermanent: is_permanent
        }, { channelId: broadcaster_user_id, destination: 'both' });

        return {
            error: false,
            message: 'Ban handled'
        };
    } catch (err) {
        await logError({
            function: 'banHandler',
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
