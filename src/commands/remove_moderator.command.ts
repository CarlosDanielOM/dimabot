import { removeChannelModerator } from '../functions/channels/index.js';
import { getTwitchUserByLogin } from '../functions/users/index.js';

interface RemoveModeratorResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

export async function removeModeratorCommand(channelID: string, user: string): Promise<RemoveModeratorResponse> {
    try {
        const userDataResult = await getTwitchUserByLogin(user);

        if (userDataResult.error || !userDataResult.data) {
            return {
                error: true,
                message: userDataResult.message,
                status: userDataResult.status
            };
        }

        const userData = userDataResult.data;

        const removeModerator = await removeChannelModerator(channelID, userData.id);

        if (removeModerator.error) {
            return {
                error: true,
                message: removeModerator.message,
                status: removeModerator.status,
                type: removeModerator.type
            };
        }

        return {
            error: false,
            message: `${userData.display_name} has been removed from the moderator list`,
            status: 200,
            type: 'success'
        };
    } catch (error) {
        console.error(`Error in removeModeratorCommand:`, {
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
