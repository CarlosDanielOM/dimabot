import { sendTrigger } from "../functions/triggers/send_trigger.trigger.js";
import { sendTwitchChatMessage, type SendMessageContext } from "../functions/chats/send_message.chat.js";
import { vipRedemptionFun } from "../functions/redemptions/vip.redemption.js";
import { customRedemptionReward } from "../functions/redemptions/custom.redemption.js";
import { TriggerSchema } from "../schemas/trigger.schema.js";
import { TriggerFileSchema } from "../schemas/trigger_file.schema.js";
import { RedemptionRewardSchema } from "../schemas/redemption_reward.schema.js";
import TwitchStreamers from "../classes/twitch_streamers.class.js";
import type { IRedemptionEvent } from "../interfaces/twitch/eventsub.interface.js";
import type { ITrigger } from "../schemas/trigger.schema.js";
import type { ITriggerFile } from "../schemas/trigger_file.schema.js";
import type { IRedemptionReward as IRedemptionRewardSchema } from "../schemas/redemption_reward.schema.js";
import { getApiUrl } from "../utils/dev.js";
import { error as logError, info as logInfo } from "../utils/logger.js";

interface RedemptionHandlerResponse {
    error: boolean;
    message: string;
}

export async function redemptionHandler(
    eventData: IRedemptionEvent,
    chatEnabled: boolean
): Promise<RedemptionHandlerResponse> {
    try {
        const { broadcaster_user_id, broadcaster_user_login, user_id, user_login, user_name, reward } = eventData;

        const rewardData = await RedemptionRewardSchema.findOne({
            channelID: broadcaster_user_id,
            rewardID: reward.id
        });

        if (!rewardData) {
            await logError({
                function: 'redemptionHandler',
                channelID: broadcaster_user_id,
                error: 'Reward not found in database',
                rewardID: reward.id
            }, { channelId: broadcaster_user_id, destination: 'both' });

            return {
                error: true,
                message: 'Reward not found'
            };
        }

        const isVipReward = reward.title.toLowerCase().includes('vip');

        if (isVipReward) {
            const vipResult = await vipRedemptionFun(eventData, reward);

            if (vipResult.error) {
                if (chatEnabled) {
                    const context: SendMessageContext = {
                        channelID: broadcaster_user_id,
                        eventData: eventData,
                        variables: {
                            user: user_name,
                            userLogin: user_login
                        }
                    };
                    await sendTwitchChatMessage(broadcaster_user_id, vipResult.message, null, context);
                }
                return {
                    error: true,
                    message: vipResult.message
                };
            }

            if (chatEnabled && vipResult.rewardMessage) {
                const context: SendMessageContext = {
                    channelID: broadcaster_user_id,
                    eventData: eventData,
                    variables: {
                        user: user_name,
                        userLogin: user_login,
                        reward: reward.title
                    }
                };
                await sendTwitchChatMessage(broadcaster_user_id, vipResult.rewardMessage, null, context);
            }

            return {
                error: false,
                message: 'VIP redeemed'
            };
        }

        if (rewardData.type === 'song') {
            await logError({
                function: 'redemptionHandler',
                channelID: broadcaster_user_id,
                rewardID: reward.id,
                error: 'Song rewards are no longer supported'
            }, { channelId: broadcaster_user_id, destination: 'both' });

            return {
                error: true,
                message: 'Song rewards are no longer supported'
            };
        }

        const trigger = await TriggerSchema.findOne({
            channelID: broadcaster_user_id,
            name: reward.title,
            type: 'redemption'
        });

        if (!trigger) {
            const customResult = await customRedemptionReward(eventData, reward);

            if (customResult.error) {
                if (chatEnabled) {
                    const context: SendMessageContext = {
                        channelID: broadcaster_user_id,
                        eventData: eventData,
                        variables: {
                            user: user_name,
                            userLogin: user_login
                        }
                    };
                    await sendTwitchChatMessage(broadcaster_user_id, customResult.message, null, context);
                }
                return {
                    error: true,
                    message: customResult.message
                };
            }

            if (chatEnabled && customResult.rewardMessage) {
                const context: SendMessageContext = {
                    channelID: broadcaster_user_id,
                    eventData: eventData,
                    variables: {
                        user: user_name,
                        userLogin: user_login,
                        reward: reward.title
                    }
                };
                await sendTwitchChatMessage(broadcaster_user_id, customResult.rewardMessage, null, context);
            }

            return {
                error: false,
                message: 'Reward redeemed'
            };
        }

        const file = await TriggerFileSchema.findOne({
            name: trigger.file,
            fileType: trigger.mediaType
        });

        if (!file) {
            await logError({
                function: 'redemptionHandler',
                channelID: broadcaster_user_id,
                triggerName: trigger.name,
                error: 'Trigger file not found'
            }, { channelId: broadcaster_user_id, destination: 'both' });

            return {
                error: true,
                message: 'Trigger file not found'
            };
        }

        const customReward = await RedemptionRewardSchema.findOne({
            channelID: broadcaster_user_id,
            rewardID: trigger.rewardID
        });

        const triggerData = {
            url: file.fileUrl,
            mediaType: file.fileType,
            volume: trigger.volume
        };

        if (customReward && customReward.costChange > 0) {
            const newCost = customReward.cost + customReward.costChange;
            const data = {
                title: customReward.title,
                prompt: customReward.prompt,
                cost: newCost
            };

            const streamerToken = await TwitchStreamers.getAccountTokenById(broadcaster_user_id, 'twitch');

            if (streamerToken) {
                try {
                    const response = await fetch(`${getApiUrl()}/rewards/${broadcaster_user_id}/${trigger.rewardID}`, {
                        method: 'PATCH',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${streamerToken}`
                        },
                        body: JSON.stringify(data)
                    });

                    const responseData = await response.json();

                    if (responseData.error) {
                        await logError({
                            function: 'redemptionHandler.updateCost',
                            channelID: broadcaster_user_id,
                            response: responseData
                        }, { channelId: broadcaster_user_id, destination: 'both' });
                    }
                } catch (err) {
                    await logError({
                        function: 'redemptionHandler.updateCost',
                        channelID: broadcaster_user_id,
                        error: err instanceof Error ? err.message : String(err)
                    }, { channelId: broadcaster_user_id, destination: 'both' });
                }
            }
        }

        const delay = (trigger as any).delay ?? 0;

        if (delay > 0) {
            setTimeout(() => {
                sendTrigger(broadcaster_user_id, triggerData, false);
            }, delay * 1000);
        } else {
            const result = await sendTrigger(broadcaster_user_id, triggerData, false);
            
            if (result.error) {
                await logError({
                    function: 'redemptionHandler.sendTrigger',
                    channelID: broadcaster_user_id,
                    error: result.message
                }, { channelId: broadcaster_user_id, destination: 'both' });
            }
        }

        await logInfo({
            message: 'Trigger redemption processed',
            channelID: broadcaster_user_id,
            user: user_name,
            reward: reward.title,
            trigger: trigger.name,
            delay
        }, { channelId: broadcaster_user_id, destination: 'both' });

        return {
            error: false,
            message: 'Redemption processed'
        };
    } catch (err) {
        await logError({
            function: 'redemptionHandler',
            eventData,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
        }, { channelId: eventData.broadcaster_user_id, destination: 'both' });

        return {
            error: true,
            message: 'Internal server error'
        };
    }
}
