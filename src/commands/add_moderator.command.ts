import { addModerator } from '../functions/channels/index.js';
import { getTwitchUserByLogin } from '../functions/users/index.js';

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
    } catch (error) {
        console.error(`Error in addModeratorCommand:`, {
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
