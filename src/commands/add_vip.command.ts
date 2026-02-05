import { addChannelVIP } from '../functions/channels/index.js';
import { getTwitchUserByLogin } from '../functions/users/index.js';

interface AddVipResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

const days = 24 * 60 * 60 * 1000;

export async function addVipCommand(channelID: string, argument: string, tags: any): Promise<AddVipResponse> {
    try {
        if (!argument) {
            return {
                error: true,
                message: 'No argument provided',
                status: 400,
                type: 'no_argument_provided'
            };
        }

        const [user, duration] = argument.split(' ');

        const userDataResult = await getTwitchUserByLogin(user);
        if (userDataResult.error || !userDataResult.data) {
            return {
                error: true,
                message: userDataResult.message,
                status: userDataResult.status
            };
        }

        const userData = userDataResult.data;

        const vipAdded = await addChannelVIP(channelID, userData.id);

        if (vipAdded.error) {
            return {
                error: true,
                message: vipAdded.message,
                status: vipAdded.status,
                type: vipAdded.type
            };
        }

        // VIP schema feature commented out - vipSchema not migrated yet
        // if (duration) {
        //     if (isNaN(duration)) {
        //         return {
        //             error: true,
        //             message: 'Invalid duration',
        //             status: 400,
        //             type: 'invalid_duration'
        //         };
        //     }
        //
        //     if (duration < 1) {
        //         return {
        //             error: true,
        //             message: 'Duration must be at least 1 day',
        //             status: 400,
        //             type: 'duration_too_short'
        //         };
        //     }
        //
        //     if (duration > 365) {
        //         return {
        //             error: true,
        //             message: 'Duration cannot be longer than 365 days',
        //             status: 400,
        //             type: 'duration_too_long'
        //         };
        //     }
        //
        //     // VIP schema save commented out
        // }

        return {
            error: false,
            message: `${userData.display_name} has been added as a VIP ${duration ? `for ${duration} days` : ''}`
        };
    } catch (error) {
        console.error(`Error in addVipCommand:`, {
            channelID,
            argument,
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
