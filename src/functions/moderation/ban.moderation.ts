import { getTwitchBotHeader } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';

interface TwitchBanData {
    broadcaster_id: string;
    moderator_id: string;
    user_id: string;
    created_at: string;
    end_time?: string;
    reason?: string;
}

interface BanResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    data?: TwitchBanData;
}

export async function ban(channelID: string, userID: string, moderatorID: string, duration: number | null = null, reason: string | null = null): Promise<BanResponse> {
    try {
        const botHeaderResult = await getTwitchBotHeader();

        if (botHeaderResult.error || !botHeaderResult.header) {
            return {
                error: true,
                message: botHeaderResult.message,
                status: 403,
                type: 'permission_error'
            };
        }

        const botHeader = botHeaderResult.header;

        const params = new URLSearchParams({
            broadcaster_id: channelID,
            moderator_id: moderatorID
        });

        const bodyData = {
            data: {
                user_id: userID
            }
        };

        if (duration) {
            (bodyData.data as any).duration = duration;
        }

        if (reason) {
            (bodyData.data as any).reason = reason;
        }

        const response = await fetch(getTwitchHelixUrl('moderation/bans', params.toString()), {
            method: 'POST',
            headers: botHeader as unknown as Record<string, string>,
            body: JSON.stringify(bodyData)
        });

        const data = await response.json();

        if (data.error) {
            return {
                error: true,
                message: data.message,
                status: data.status,
                type: data.error
            };
        }

        return {
            error: false,
            message: 'Success',
            data: data.data[0]
        };
    } catch (error) {
        console.error(`Error in ban:`, {
            channelID,
            userID,
            moderatorID,
            duration,
            reason,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });

        return {
            error: true,
            message: 'Internal server error',
            type: 'error'
        };
    }
}
