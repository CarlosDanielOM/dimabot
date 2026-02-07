import { VipSchema } from '../../schemas/vip.schema.js';
import { removeChannelVIP } from '../channels/remove_vip.channel.js';
import { error as logError } from '../../utils/logger.js';

interface EventData {
    broadcaster_user_id: string;
    broadcaster_user_login: string;
}

interface UnVIPExpiredUserResponse {
    error?: boolean;
    message?: string;
    status?: number;
    type?: string;
}

export async function unVIPExpiredUser(eventData: EventData): Promise<UnVIPExpiredUserResponse | undefined> {
    try {
        const { broadcaster_user_id, broadcaster_user_login } = eventData;

        const vipReward = await VipSchema.find({ channelID: broadcaster_user_id, vip: true });

        if (vipReward.length === 0) {
            return { error: true, message: 'No VIPs found' };
        }

        const currentDate = Date.now();

        for (const vip of vipReward) {
            const expireDate = new Date(vip.expireDate.year, vip.expireDate.month, vip.expireDate.day).getTime();

            if (currentDate > expireDate) {
                const result = await removeChannelVIP(broadcaster_user_id, vip.userID);
                if (result.error) {
                    console.error({
                        error: result,
                        where: 'unVIPExpiredUser',
                        channel: broadcaster_user_login,
                    });
                    return {
                        error: true,
                        message: 'Error removing VIP',
                        status: 500,
                        type: 'error_removing_vip'
                    };
                }

                await VipSchema.deleteOne({ userID: vip.userID, channelID: broadcaster_user_id });
            }
        }

    } catch (err) {
        await logError({ 
            function: 'unVIPExpiredUser',
            broadcaster_user_id: eventData.broadcaster_user_id,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
        });
    }
}
