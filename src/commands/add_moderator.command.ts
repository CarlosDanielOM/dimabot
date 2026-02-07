import { addModerator } from '../functions/channels/index.js';
import { getTwitchUserByLogin } from '../functions/users/index.js';
import { error } from '../utils/logger.js';

interface AddModeratorResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

export async function addModeratorCommand(channelID: string, user: string): Promise<AddModeratorResponse> {
    try {
        const userDataResult = await getTwitchUserByLogin(user);

        if (userDataResult.error || !userDataResult.data) {
            return {
                error: true,
                message: userDataResult.message,
                status: userDataResult.status
            };
        }

        const setModerator = await addModerator(channelID, userDataResult.data.id);

        if (setModerator.error) {
            return {
                error: true,
                message: setModerator.message,
                status: setModerator.status,
                type: setModerator.type
            };
        }

        return {
            error: false,
            message: 'Moderator added'
        };
    } catch (err) {
        await error({
            function: 'addModeratorCommand',
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
