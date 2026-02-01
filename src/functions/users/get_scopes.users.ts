import { getAppToken } from '../../utils/tokens.js';
import { getTwitchHelixUrl } from '../../utils/links.js';

interface GetScopesResponse {
    error: boolean;
    message: string;
    status?: number;
    data?: any;
}

export async function getScopes(userID: string): Promise<GetScopesResponse> {
    try {
        const params = new URLSearchParams();
        params.append('user_id', userID);

        const appAccessToken = await getAppToken('twitch');

        if (!appAccessToken) {
            return {
                error: true,
                message: 'Failed to get app access token',
                status: 500
            };
        }

        const response = await fetch(getTwitchHelixUrl('authorization/users', params.toString()), {
            headers: {
                'Authorization': `Bearer ${appAccessToken}`,
                'Client-Id': process.env.CLIENT_ID!,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (data.error) {
            return {
                error: true,
                message: data.message,
                status: data.status,
                data: data
            };
        }

        return {
            error: false,
            message: 'Scopes fetched successfully',
            status: 200,
            data: data.data
        };
    } catch (error) {
        console.error(`Error in getScopes:`, {
            userID,
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
