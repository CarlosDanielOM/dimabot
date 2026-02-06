import { removeChannelVIP } from '../functions/channels/index.js';
import { getTwitchUserByLogin } from '../functions/users/index.js';

interface RemoveVipResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

export async function removeVipCommand(channelID: string, user: string): Promise<RemoveVipResponse> {
    try {
        const userName = user.split(' ')[0].toLowerCase();

        const userDataResult = await getTwitchUserByLogin(userName);

        if (userDataResult.error || !userDataResult.data) {
            return {
                error: true,
                message: userDataResult.message,
                status: userDataResult.status
            };
        }

        const userData = userDataResult.data;

        const removeVipResult = await removeChannelVIP(channelID, userData.id);

        if (removeVipResult.error) {
            return {
                error: true,
                message: removeVipResult.message,
                status: removeVipResult.status,
                type: removeVipResult.type
            };
        }

        return {
            error: false,
            message: `${userData.display_name} has been removed from the VIP list`,
            status: 200,
            type: 'success'
        };
    } catch (error) {
        console.error(`Error in removeVipCommand:`, {
            channelID,
            user,
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
