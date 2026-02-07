import { sendTwitchChatMessage, type SendMessageContext } from "../functions/chats/send_message.chat.js";
import type { IEventsub } from "../schemas/eventsub.schema.js";
import type { IBitUseEvent } from "../interfaces/twitch/eventsub.interface.js";
import type { ICheerTiers } from "../schemas/eventsub.schema.js";
import { error as logError, info as logInfo } from "../utils/logger.js";

interface CheerHandlerResponse {
    error: boolean;
    message: string;
}

function findMatchingTier(tiers: ICheerTiers[], bits: number): ICheerTiers | null {
    return tiers.find(tier =>
        bits >= tier.min_amount && bits <= tier.max_amount
    ) || null;
}

export async function cheerHandler(
    eventData: IBitUseEvent,
    eventsubData: IEventsub,
    chatEnabled: boolean
): Promise<CheerHandlerResponse> {
    try {
        if (!eventData.broadcaster_user_id) {
            await logError({
                function: 'cheerHandler',
                error: 'Missing broadcaster_user_id in event data',
                eventData
            }, { channelId: 'unknown', destination: 'both' });

            return {
                error: true,
                message: 'Invalid event data'
            };
        }

        const channelID = eventData.broadcaster_user_id;

        if (!chatEnabled) {
            return {
                error: false,
                message: 'Chat is disabled'
            };
        }

        let messageToSend: string;

        if (eventData.is_anonymous) {
            await logInfo({
                message: 'Anonymous cheer received (Twitch disabled this, but keeping for future-proofing)',
                bits: eventData.bits,
                channelID
            }, { channelId: channelID, destination: 'both' });

            messageToSend = eventsubData.message || `Gracias por los ${eventData.bits} bits Anonimo!`;
        } else {
            const bits = eventData.bits;
            const matchedTier = findMatchingTier(eventsubData.cheerTiers || [], bits);

            if (matchedTier) {
                await logInfo({
                    message: 'Cheer matched tier',
                    tier: matchedTier.name,
                    bits: bits,
                    channelID
                }, { channelId: channelID, destination: 'both' });

                messageToSend = matchedTier.message;
            } else {
                await logInfo({
                    message: 'No cheer tier matched, using default message',
                    bits: bits,
                    channelID
                }, { channelId: channelID, destination: 'both' });

                messageToSend = eventsubData.message || '';
            }
        }

        if (!messageToSend || messageToSend.trim() === '') {
            return {
                error: false,
                message: 'No message to send'
            };
        }

        const context: SendMessageContext = {
            channelID: channelID,
            eventData: eventData,
            eventsubData: eventsubData,
            variables: {
                bits: String(eventData.bits),
                user: eventData.user_name ?? '',
                userLogin: eventData.user_login ?? ''
            }
        };

        const result = await sendTwitchChatMessage(channelID, messageToSend, null, context);

        if (result.error) {
            await logError({
                function: 'cheerHandler.sendTwitchChatMessage',
                channelID,
                bits: eventData.bits,
                error: result.message
            }, { channelId: channelID, destination: 'both' });

            return {
                error: true,
                message: result.message || 'Failed to send cheer message'
            };
        }

        return {
            error: false,
            message: 'Cheer handled successfully'
        };
    } catch (err) {
        await logError({
            function: 'cheerHandler',
            eventData,
            eventsubData,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
        }, { channelId: eventData.broadcaster_user_id, destination: 'both' });

        return {
            error: true,
            message: 'Internal server error'
        };
    }
}
