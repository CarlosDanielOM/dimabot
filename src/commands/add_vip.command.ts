import { addChannelVIP } from '../functions/channels/index.js';
import { getTwitchUserByLogin } from '../functions/users/index.js';
import TwitchStreamers from '../classes/twitch_streamers.class.js';
import { VipSchema } from '../schemas/vip.schema.js';

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

        if (duration) {
            const durationNum = parseInt(duration);

            if (isNaN(durationNum)) {
                return {
                    error: true,
                    message: 'Invalid duration',
                    status: 400,
                    type: 'invalid_duration'
                };
            }

            if (durationNum < 1) {
                return {
                    error: true,
                    message: 'Duration must be at least 1 day',
                    status: 400,
                    type: 'duration_too_short'
                };
            }

            if (durationNum > 365) {
                return {
                    error: true,
                    message: 'Duration cannot be longer than 365 days',
                    status: 400,
                    type: 'duration_too_long'
                };
            }

            const now = Date.now();
            const expireTime = now + (durationNum * days);
            const dateToExpire = new Date(expireTime);
            const expireDate = {
                day: dateToExpire.getDate(),
                month: dateToExpire.getMonth(),
                year: dateToExpire.getFullYear()
            };

            const account = await TwitchStreamers.getTwitchAccountById(channelID);

            if (!account) {
                return {
                    error: true,
                    message: 'Streamer account not found',
                    status: 404,
                    type: 'account_not_found'
                };
            }

            const vipData = {
                username: userData.login,
                userID: userData.id,
                channel: account.name,
                channelID,
                duration: durationNum,
                vip: true,
                date: {
                    day: new Date().getDate(),
                    month: new Date().getMonth(),
                    year: new Date().getFullYear()
                },
                createdAt: new Date(),
                expireDate,
                expireTimestamp: new Date(expireTime)
            };

            try {
                await VipSchema.create(vipData);
            } catch (error) {
                console.error({
                    error: error instanceof Error ? error.message : String(error),
                    where: 'addVipCommand',
                    channel: account.name,
                    channelID
                });
                return {
                    error: true,
                    message: 'Error saving VIP data',
                    status: 500,
                    type: 'error_saving_vip_data'
                };
            }
        }

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
