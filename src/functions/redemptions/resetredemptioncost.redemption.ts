import { RedemptionRewardSchema } from '../../schemas/redemption_reward.schema.js';
import { getApiUrl } from '../../utils/dev.js';
import TwitchStreamers from '../../classes/twitch_streamers.class.js';
import { error as logError } from '../../utils/logger.js';

interface ResetRedemptionCostResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

export async function resetRedemptionCost(channelID: string): Promise<ResetRedemptionCostResponse> {
    try {
        const account = await TwitchStreamers.getTwitchAccountById(channelID);
        if (!account || account.plan_tier === 'free') {
            return { error: true, message: 'Channel not premium', status: 400, type: 'channel_not_premium' };
        }

        const rewards = await RedemptionRewardSchema.find({ channelID: channelID, returnToOriginalCost: true });

        if (rewards.length === 0) {
            return { error: true, message: 'No rewards found', status: 404, type: 'no_rewards_found' };
        }

        const streamerToken = await TwitchStreamers.getAccountTokenById(channelID, 'twitch');
        if (!streamerToken) {
            await logError({ 
                function: 'resetRedemptionCost',
                channelID,
                error: 'Failed to get streamer token'
            });
            return {
                error: true,
                message: 'Failed to authenticate',
                status: 403,
                type: 'authentication_error'
            };
        }

        for (let i = 0; i < rewards.length; i++) {
            const data = {
                title: rewards[i].title,
                prompt: rewards[i].prompt,
                cost: rewards[i].originalCost,
            };

            const response = await fetch(`${getApiUrl()}/rewards/${channelID}/${rewards[i].rewardID}`, {
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
                    where: 'resetRedemptionCost',
                    channelID,
                });
                return {
                    error: true,
                    message: 'Error updating reward',
                    status: 500,
                    type: 'error_updating_reward'
                };
            }
        }

        return { error: false, message: 'Costs reset' };

    } catch (err) {
        await logError({ 
            function: 'resetRedemptionCost',
            channelID,
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
