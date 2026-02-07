import { getTwitchAppHeader } from '../../utils/header.js';
import { error as logError } from "../../utils/logger.js";
import { getTwitchHelixUrl } from '../../utils/links.js';

interface GetUserColorResponse {
    error: boolean;
    message?: string;
    status?: number;
    color?: string;
}

export async function getUserColor(userID: string): Promise<GetUserColorResponse> {
    try {
        const botHeader = await getTwitchAppHeader();

        const response = await fetch(
            getTwitchHelixUrl('chat/color', `user_id=${userID}`),
            {
                headers: botHeader as unknown as Record<string, string>
            }
        );

        const data = await response.json();

        if (data.error) {
            return {
                error: data.error,
                message: data.message,
                status: data.status
            };
        }

        const userData = data.data[0];

        return {
            error: false,
            color: userData.color
        };
    } catch (err) {
        await logError({ function: 'getUserColor',
            userID,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
        });

        return {
            error: true,
            message: 'Internal server error',
            status: 500
        };
    }
}
