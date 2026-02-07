import { removeChannelVIP } from '../functions/channels/index.js';
import { getTwitchUserByLogin } from '../functions/users/index.js';
import { error } from '../utils/logger.js';

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
    } catch (err) {
        await error({
            function: 'removeVipCommand',
            channelID,
            user,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
        }, { channelId: channelID, destination: 'both' });

        return {
            error: true,
            message: 'Internal server error'
        };
    }
}
