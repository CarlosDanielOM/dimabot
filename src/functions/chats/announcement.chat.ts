import { getTwitchBotHeader } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';
import { error as logError } from '../../utils/logger.js';

interface SendAnnouncementResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

export async function sendAnnouncement(
    channelID: string,
    moderatorID: string,
    message: string,
    color: string = 'purple'
): Promise<SendAnnouncementResponse> {
    try {
        const botHeaderResult = await getTwitchBotHeader();

        if (botHeaderResult.error || !botHeaderResult.header) {
            return {
                error: true,
                message: botHeaderResult.message,
                status: 403,
                type: 'error'
            };
        }

        const botHeader = botHeaderResult.header;

        const params = new URLSearchParams({
            broadcaster_id: channelID,
            moderator_id: moderatorID
        });

        const bodyData = {
            message: message,
            color: color
        };

        const response = await fetch(getTwitchHelixUrl('chat/announcements', params.toString()), {
            method: 'POST',
            headers: botHeader as unknown as Record<string, string>,
            body: JSON.stringify(bodyData)
        });

        if (response.status !== 204) {
            const errorData = await response.json();
            return {
                error: true,
                message: errorData.message || 'Failed to send announcement',
                status: response.status,
                type: errorData.error
            };
        }

        return {
            error: false,
            message: 'Announcement sent'
        };
    } catch (err) {
        await logError({
            function: 'sendAnnouncement',
            channelID,
            moderatorID,
            message,
            color,
            operation: 'send_announcement',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            apiEndpoint: 'chat/announcements',
            method: 'POST'
        }, { channelId: channelID, destination: 'both' });

        return {
            error: true,
            message: 'Internal server error',
            status: 500,
            type: 'error'
        };
    }
}
