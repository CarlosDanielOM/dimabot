import EventsubSchema from "../schemas/eventsub.schema.js";
import type { ITwitchSubscriptionData } from "../interfaces/twitch/eventsub.interface.js";
import type { IEventsub } from "../schemas/eventsub.schema.js";
import { info as logInfo, warn as logWarn, error as logError } from "../utils/logger.js";

interface RevocationHandlerResponse {
    error: boolean;
    message: string;
}

export async function revocationHandler(
    subscriptionData: ITwitchSubscriptionData
): Promise<RevocationHandlerResponse> {
    try {
        const { id, type, version, condition } = subscriptionData;

        if (!id || !type || !version) {
            await logError({
                function: 'revocationHandler',
                error: 'Invalid subscription data: missing required fields',
                subscriptionData
            }, { channelId: 'unknown', destination: 'both' });

            return {
                error: true,
                message: 'Invalid subscription data'
            };
        }

        const subscription: IEventsub | null = await EventsubSchema.findOne({
            id,
            type,
            version
        });

        if (!subscription) {
            await logWarn({
                message: 'EventSub subscription not found for revocation (already deleted?)',
                subscriptionId: id,
                type,
                version,
                condition
            }, { channelId: 'unknown', destination: 'both' });

            return {
                error: false,
                message: 'Subscription not found (already deleted)'
            };
        }

        await logInfo({
            message: 'EventSub subscription revoked - deleting from database',
            subscriptionId: id,
            type,
            version,
            channelID: subscription.channelID,
            channel: subscription.channel,
            condition
        }, { channelId: subscription.channelID || 'unknown', destination: 'both' });

        await EventsubSchema.deleteOne({
            id,
            type,
            version
        });

        await logInfo({
            message: 'EventSub subscription deleted successfully',
            subscriptionId: id,
            type,
            version,
            channelID: subscription.channelID
        }, { channelId: subscription.channelID || 'unknown', destination: 'both' });

        return {
            error: false,
            message: 'Subscription revoked successfully'
        };
    } catch (err) {
        await logError({
            function: 'revocationHandler',
            subscriptionData,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
        }, { channelId: 'unknown', destination: 'both' });

        return {
            error: true,
            message: 'Internal server error'
        };
    }
}
