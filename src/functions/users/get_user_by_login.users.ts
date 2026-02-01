import { getTwitchAppHeader } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';

interface TwitchUserData {
    id: string;
    login: string;
    display_name: string;
    type: string;
    broadcaster_type: string;
    description: string;
    profile_image_url: string;
    offline_image_url: string;
    view_count: number;
    created_at: string;
}

interface GetUserByLoginResponse {
    error: boolean;
    message: string;
    status?: number;
    data?: TwitchUserData;
}

export async function getTwitchUserByLogin(login: string, skipCache: boolean = false): Promise<GetUserByLoginResponse> {
    try {
        const appHeader = await getTwitchAppHeader();

        const response = await fetch(
            getTwitchHelixUrl('users', `login=${login}`),
            {
                headers: appHeader as unknown as Record<string, string>
            }
        );

        const data = await response.json();

        if (data.error) {
            return {
                error: true,
                message: data.message,
                status: data.status
            };
        }

        if (!data.data || data.data.length === 0) {
            return {
                error: true,
                message: 'User not found'
            };
        }

        return {
            error: false,
            message: 'Success',
            data: data.data[0]
        };
    } catch (error) {
        console.error(`Error in getTwitchUserByLogin:`, {
            login,
            skipCache,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });

        return {
            error: true,
            message: 'Internal server error'
        };
    }
}
