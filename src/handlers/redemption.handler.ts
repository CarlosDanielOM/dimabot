import { sendTwitchChatMessage, type SendMessageContext } from "../functions/chats/send_message.chat.js";
import { vipRedemptionFun } from "../functions/redemptions/vip.redemption.js";
import { customRedemptionReward } from "../functions/redemptions/custom.redemption.js";
import { TriggerSchema } from "../schemas/trigger.schema.js";
import { RedemptionRewardSchema } from "../schemas/redemption_reward.schema.js";
import TwitchStreamers from "../classes/twitch_streamers.class.js";
import type { IRedemptionEvent } from "../interfaces/twitch/eventsub.interface.js";
import { getApiUrl } from "../utils/dev.js";
import { error as logError, info as logInfo } from "../utils/logger.js";
import { parseSpecialCommands } from "./special_parser.handler.js";

interface RedemptionHandlerResponse {
    error: boolean;
    message: string;
}

async function runRedemptionSpecialFunctions(
    rawMessage: string | undefined,
    channelID: string,
    eventData: IRedemptionEvent,
    rewardTitle: string
): Promise<string> {
    if (!rawMessage || rawMessage.trim() === '') {
        return '';
    }

    try {
        const parsed = await parseSpecialCommands(rawMessage, {
            channelID,
            eventData,
            argument: eventData.user_input || '',
            variables: {
                user: eventData.user_name,
                userLogin: eventData.user_login,
                reward: rewardTitle
            },
            userLevel: 10
        });

        return parsed.parsedText;
    } catch (err) {
        console.error('Error running redemption special functions:', {
            channelID,
            rewardTitle,
            rawMessage,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            timestamp: new Date().toISOString()
        });

        await logError({
            function: 'redemptionHandler.runRedemptionSpecialFunctions',
            channelID,
            rewardTitle,
            rawMessage,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
        }, { channelId: channelID, destination: 'both' });

        return rawMessage;
    }
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
                const parsedRewardMessage = await runRedemptionSpecialFunctions(
                    vipResult.rewardMessage,
                    broadcaster_user_id,
                    eventData,
                    reward.title
                );
                if (parsedRewardMessage.trim() !== '') {
                    await sendTwitchChatMessage(broadcaster_user_id, parsedRewardMessage, null);
                }
            } else if (vipResult.rewardMessage) {
                await runRedemptionSpecialFunctions(
                    vipResult.rewardMessage,
                    broadcaster_user_id,
                    eventData,
                    reward.title
                );
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
            $or: [
                { rewardID: reward.id },
                { name: reward.title },
                { name: reward.title, type: 'redemption' }
            ]
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
                const parsedRewardMessage = await runRedemptionSpecialFunctions(
                    customResult.rewardMessage,
                    broadcaster_user_id,
                    eventData,
                    reward.title
                );
                if (parsedRewardMessage.trim() !== '') {
                    await sendTwitchChatMessage(broadcaster_user_id, parsedRewardMessage, null);
                }
            } else if (customResult.rewardMessage) {
                await runRedemptionSpecialFunctions(
                    customResult.rewardMessage,
                    broadcaster_user_id,
                    eventData,
                    reward.title
                );
            }

            return {
                error: false,
                message: 'Reward redeemed'
            };
        }

        const customReward = await RedemptionRewardSchema.findOne({
            channelID: broadcaster_user_id,
            rewardID: trigger.rewardID
        });

        const parsedRewardMessage = await runRedemptionSpecialFunctions(
            rewardData.message,
            broadcaster_user_id,
            eventData,
            reward.title
        );

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

        await logInfo({
            message: 'Trigger redemption processed',
            channelID: broadcaster_user_id,
            user: user_name,
            reward: reward.title,
            trigger: trigger.name,
            parsedRewardMessage
        }, { channelId: broadcaster_user_id, destination: 'both' });

        if (chatEnabled && parsedRewardMessage) {
            await sendTwitchChatMessage(broadcaster_user_id, parsedRewardMessage, null);
        }

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
