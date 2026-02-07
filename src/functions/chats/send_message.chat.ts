import { error as logError, warn as logWarn } from "../../utils/logger.js";
import { getTwitchHelixUrl } from "../../utils/links.js";
import { getAppToken } from "../../utils/tokens.js";
import { parseSpecialCommands } from "../../handlers/special_parser.handler.js";
import type { ITwitchEventData } from "../../interfaces/twitch/eventsub.interface.js";
import type { IEventsub } from "../../schemas/eventsub.schema.js";

const MODERATOR_ID = '698614112';

export interface SendMessageContext {
    channelID: string;
    eventData?: ITwitchEventData | any;
    eventsubData?: IEventsub | any;
    argument?: string;
    variables?: Record<string, string>;
    userPlan?: 'free' | 'premium' | 'pro';
}

export const sendTwitchChatMessage = async (
    channelID: string,
    message: string,
    replyToMessageId: string | null = null,
    context?: SendMessageContext
) => {
    try {
        const twitchAppToken = await getAppToken('twitch');

        if(!twitchAppToken) {
            return {
                error: true,
                message: 'Failed to get Twitch app token',
                status: 500,
                type: 'error',
                reason: 'Failed to get Twitch app token',
            }
        }

        let finalMessage = message;

        if (context) {
            try {
                const parsedResult = await parseSpecialCommands(message, context);
                finalMessage = parsedResult.parsedText;
            } catch (parseError) {
                await logWarn({
                    function: 'sendTwitchChatMessage.parseSpecialCommands',
                    channelID,
                    error: parseError instanceof Error ? parseError.message : String(parseError)
                }, { channelId: channelID, destination: 'both' });
            }
        }

        let body = {
            broadcaster_id: channelID,
            sender_id: MODERATOR_ID,
            message: finalMessage,
        }

        if(replyToMessageId) {
            (body as any).reply_parent_message_id = replyToMessageId;
        }

        const response = await fetch(getTwitchHelixUrl('chat/messages'), {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${twitchAppToken}`,
                'Client-Id': process.env.CLIENT_ID!,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        const data = await response.json();

        if(response.status < 200 || response.status > 299) {
            return {
                error: true,
                message: data.message,
                status: response.status,
                type: data.error,
            }
        }

        return {
            error: false,
            message: 'Message sent',
            status: response.status,
            type: 'success',
            data: data.data[0],
        }

    } catch (err) {
        console.error(`Error sending Twitch chat message: ${err}`);
        return {
            error: true,
            message: 'Error sending Twitch chat message',
            status: 500,
            type: 'error',
            reason: err instanceof Error ? err.message : String(err),
        }
    }
}