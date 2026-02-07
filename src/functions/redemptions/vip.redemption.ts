import { RedemptionRewardSchema } from '../../schemas/redemption_reward.schema.js';
import { VipSchema } from '../../schemas/vip.schema.js';
import { getApiUrl } from '../../utils/dev.js';
import TwitchStreamers from '../../classes/twitch_streamers.class.js';
import { addChannelVIP } from '../channels/add_vip.channel.js';
import { error as logError } from '../../utils/logger.js';

interface EventData {
    broadcaster_user_id: string;
    broadcaster_user_login: string;
    user_id: string;
    user_login: string;
}

interface RewardData {
    id: string;
    title: string;
    prompt: string;
    cost: number;
}

interface VipRedemptionFunResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    rewardMessage?: string;
}

export async function vipRedemptionFun(eventData: EventData, rewardData: RewardData): Promise<VipRedemptionFunResponse> {
    try {
        const { broadcaster_user_id, broadcaster_user_login, user_id, user_login } = eventData;

        const vipReward = await RedemptionRewardSchema.findOne({ channelID: broadcaster_user_id, rewardID: rewardData.id, type: 'vip' });

        if (!vipReward) {
            return {
                error: true,
                message: 'Reward not found',
                status: 404,
                type: 'reward_not_found'
            };
        }

        if (vipReward.costChange > 0) {
            let newCost = vipReward.cost + vipReward.costChange;
            const data = {
                title: vipReward.title,
                prompt: vipReward.prompt,
                cost: newCost,
            };

            const streamerToken = await TwitchStreamers.getAccountTokenById(broadcaster_user_id, 'twitch');
            if (!streamerToken) {
                await logError({ 
                    function: 'vipRedemptionFun',
                    channel: broadcaster_user_login,
                    error: 'Failed to get streamer token'
                });
                return {
                    error: true,
                    message: 'Failed to authenticate',
                    status: 403,
                    type: 'authentication_error'
                };
            }

            const response = await fetch(`${getApiUrl()}/rewards/${broadcaster_user_id}/${rewardData.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${streamerToken}`
                },
                body: JSON.stringify(data)
            });

            const responseData = await response.json();

            if (responseData.error) {
                console.error({
                    response: responseData,
                    where: 'vipRedemptionFun',
                    channel: broadcaster_user_login,
                });
                return {
                    error: true,
                    message: 'Error updating reward',
                    status: 500,
                    type: 'error_updating_reward'
                };
            }
        }

        if (vipReward.duration > 0) {
            const date = new Date();
            date.setDate(date.getDate() + vipReward.duration);
            const expireDate = {
                day: date.getDate(),
                month: date.getMonth(),
                year: date.getFullYear(),
            };

            const vipData = {
                username: eventData.user_login,
                userID: eventData.user_id,
                channel: broadcaster_user_login,
                channelID: broadcaster_user_id,
                vip: true,
                duration: vipReward.duration,
                expireDate,
            };

            await new VipSchema(vipData).save();
        }

        const result = await addChannelVIP(broadcaster_user_id, user_id);
        if (result.error) {
            console.error({
                error: result,
                where: 'vipRedemptionFun',
                channel: broadcaster_user_login,
            });
            return {
                error: true,
                message: 'Error adding VIP',
                status: 500,
                type: 'error_adding_vip'
            };
        }

        return {
            error: false,
            message: 'VIP added',
            rewardMessage: vipReward.message,
        };

    } catch (err) {
        await logError({ 
            function: 'vipRedemptionFun',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
        });

        return {
            error: true,
            message: 'Internal server error',
            type: 'error'
        };
    }
}
