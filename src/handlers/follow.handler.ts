import { sendTwitchChatMessage, type SendMessageContext } from "../functions/chats/send_message.chat.js";
import type { IEventsub } from "../schemas/eventsub.schema.js";
import type { IFollowEvent } from "../interfaces/twitch/eventsub.interface.js";
import { getDragonflyClient } from "../utils/databases/dragonfly.database.js";
import { error as logError, info as logInfo } from "../utils/logger.js";

interface FollowHandlerResponse {
    error: boolean;
    message: string;
}

export async function followHandler(
    eventData: IFollowEvent,
    eventsubData: IEventsub,
    chatEnabled: boolean
): Promise<FollowHandlerResponse> {
    try {
        const { broadcaster_user_id, user_name, user_login } = eventData;

        if (!chatEnabled) {
            return {
                error: false,
                message: 'Chat is disabled'
            };
        }

        const cache = await getDragonflyClient('FollowHandler');
        const cacheKey = `${broadcaster_user_id}:follows:count`;
        let followCount = await cache.get(cacheKey) as string | null;

        if (!followCount) {
            followCount = '0';
        }

        const newCount = parseInt(followCount) + 1;
        await cache.set(cacheKey, newCount);

        let messageToSend = eventsubData.message || '';

        if (eventsubData.todayFollows) {
            messageToSend = `${eventsubData.message} (Follow #${newCount})`;
        }

        if (!messageToSend || messageToSend.trim() === '') {
            return {
                error: false,
                message: 'No message to send'
            };
        }

        const context: SendMessageContext = {
            channelID: broadcaster_user_id,
            eventData: eventData,
            variables: {
                user: user_name,
                userLogin: user_login,
                count: String(newCount)
            }
        };

        await sendTwitchChatMessage(broadcaster_user_id, messageToSend, null, context);

        await logInfo({
            message: 'Follow received',
            channelID: broadcaster_user_id,
            user: user_name,
            followCount: newCount,
            showCount: eventsubData.todayFollows
        }, { channelId: broadcaster_user_id, destination: 'both' });

        return {
            error: false,
            message: 'Follow handled'
        };
    } catch (err) {
        await logError({
            function: 'followHandler',
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
