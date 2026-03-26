import { RedemptionRewardSchema } from '../../schemas/redemption_reward.schema.js';
import { getApiUrl } from '../../utils/dev.js';
import TwitchStreamers from '../../classes/twitch_streamers.class.js';
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

interface CustomRedemptionResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    rewardMessage?: string;
}

export async function customRedemptionReward(eventData: EventData, rewardData: RewardData): Promise<CustomRedemptionResponse> {
    try {
        const { broadcaster_user_id, broadcaster_user_login } = eventData;

        const reward = await RedemptionRewardSchema.findOne({ channelID: broadcaster_user_id, rewardID: rewardData.id });
        if (!reward) {
            return { error: true, message: 'Reward not found', status: 404, type: 'reward_not_found' };
        }

        if (reward.costChange > 0) {
            let newCost = reward.cost + reward.costChange;
            if (newCost < 1) newCost = 1;

            const data = {
                title: reward.title,
                prompt: reward.prompt,
                cost: newCost,
            };

            const streamerToken = await TwitchStreamers.getAccountTokenById(broadcaster_user_id, 'twitch');
            if (!streamerToken) {
                await logError({ 
                    function: 'customRedemptionReward',
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
                    where: 'customRedemptionReward',
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

        return { error: false, message: 'Reward updated', rewardMessage: reward.message };

    } catch (err) {
        await logError({ 
            function: 'customRedemptionReward',
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
