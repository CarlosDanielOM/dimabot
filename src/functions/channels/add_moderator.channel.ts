import { getTwitchStreamerHeaderById } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';

interface AddModeratorResponse {
    status: number;
    message: string;
    error?: string;
    type?: string;
}

export async function addModerator(channelID: string, userID: string = '698614112'): Promise<AddModeratorResponse> {
    try {
        const streamerHeader = await getTwitchStreamerHeaderById(channelID);
        
        const params = new URLSearchParams();
        params.append('broadcaster_id', channelID);
        params.append('user_id', userID);
        
        const headers: Record<string, string> = {
            'Client-Id': streamerHeader['Client-Id'],
            'Authorization': streamerHeader.Authorization,
            'Content-Type': streamerHeader['Content-Type']
        };
        
        const response = await fetch(getTwitchHelixUrl('moderation/moderators', params.toString()), {
            method: 'POST',
            headers: headers,
        });
        
        if (response.status !== 204) {
            const errorData = await response.json();
            return {
                status: response.status,
                message: errorData.message || 'Failed to add moderator',
                error: errorData.error,
                type: 'error'
            };
        }
        
        return {
            status: 200,
            message: 'Success'
        };
    } catch (error) {
        return {
            status: 500,
            message: 'Internal server error',
            error: String(error),
            type: 'error'
        };
    }
}
