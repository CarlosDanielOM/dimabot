import { getTwitchHelixUrl } from "../../utils/links.js";
import { getAppToken } from "../../utils/tokens.js";

const MODERATOR_ID = '698614112';

export const sendTwitchChatMessage = async (channelID: string, message: string, replyToMessageId: string | null = null) => {
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

        let body = {
            broadcaster_id: channelID,
            sender_id: MODERATOR_ID,
            message: message,
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

    } catch (error) {
        console.error(`Error sending Twitch chat message: ${error}`);
        return {
            error: true,
            message: 'Error sending Twitch chat message',
            status: 500,
            type: 'error',
            reason: (error as Error).message,
        }
    }
}