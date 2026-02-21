import { error, info } from '../utils/logger.js';
import { getDragonflyClient } from '../utils/databases/dragonfly.database.js';
import {
    processBotSubscriptionReward,
    PRODUCT_IDS,
    type SubscriptionCadence
} from '../utils/referral.js';
import UsersSchema from '../schemas/users.schema.js';

const AI_USAGE_METER_ID = '01d90c16-87d0-4e31-880a-4045a8da90cd';

interface PolarSHEvent {
    id?: string;
    type: string;
    data: any;
}

type PlanTier = 'free' | 'premium' | 'pro';

function resolvePlanTier(productId: string | undefined): PlanTier {
    switch (productId) {
        case PRODUCT_IDS.PRO:
            return 'pro';
        case PRODUCT_IDS.PREMIUM:
            return 'premium';
        default:
            return 'free';
    }
}

function toDateOrNull(value: unknown): Date | null {
    if (!value || typeof value !== 'string') {
        return null;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date;
}

function getSubscriptionPeriodEnd(data: any): Date | null {
    const candidates = [
        data?.current_period_end,
        data?.current_period_end_at,
        data?.ends_at,
        data?.ended_at
    ];

    for (const candidate of candidates) {
        const parsed = toDateOrNull(candidate);
        if (parsed) {
            return parsed;
        }
    }

    return null;
}

function getCanceledSubscriptionEnd(data: any): Date | null {
    const candidates = [
        data?.ends_at,
        data?.ended_at,
        data?.current_period_end,
        data?.current_period_end_at
    ];

    for (const candidate of candidates) {
        const parsed = toDateOrNull(candidate);
        if (parsed) {
            return parsed;
        }
    }

    return null;
}

function getActiveSubscriptionEnd(data: any): Date | null {
    const candidates = [
        data?.current_period_end,
        data?.current_period_end_at,
        data?.ends_at,
        data?.ended_at
    ];

    for (const candidate of candidates) {
        const parsed = toDateOrNull(candidate);
        if (parsed) {
            return parsed;
        }
    }

    return null;
}

function normalizeStatus(status: unknown): string {
    if (typeof status !== 'string') {
        return '';
    }

    return status.trim().toLowerCase();
}

function isCanceledStatus(status: string): boolean {
    return status === 'canceled';
}

function isRenewedOrActiveStatus(status: string): boolean {
    return status.length > 0 && !isCanceledStatus(status);
}

function getProductId(data: any): string | undefined {
    const candidates = [
        data?.product_id,
        data?.product?.id,
        data?.subscription?.product_id,
        data?.subscription?.product?.id,
        data?.items?.[0]?.product_id,
        data?.items?.[0]?.product?.id
    ];

    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim();
        }
    }

    return undefined;
}

function getSubscriptionCycleKey(data: any): string {
    const candidates = [
        data?.current_period_start,
        data?.current_period_start_at,
        data?.started_at,
        data?.created_at,
        data?.billing_cycle_anchor
    ];

    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
            return candidate;
        }
    }

    return 'cycle_unknown';
}

function getSubscriptionCadence(data: any): SubscriptionCadence {
    const candidates = [
        data?.recurring_interval,
        data?.price_recurring_interval,
        data?.plan?.interval,
        data?.product?.recurring_interval,
        data?.product?.name,
        data?.product?.slug,
        data?.price?.name,
        data?.price?.slug
    ];

    for (const candidate of candidates) {
        if (typeof candidate !== 'string') {
            continue;
        }

        const value = candidate.toLowerCase();
        if (value.includes('year') || value.includes('annual')) {
            return 'yearly';
        }
    }

    return 'monthly';
}

function getCustomerId(data: any): string | null {
    const candidate = data?.customer_id || data?.customer?.id;
    if (typeof candidate !== 'string' || !candidate.trim()) {
        return null;
    }

    return candidate.trim();
}

async function resolveUserFromSubscription(data: any) {
    const metadataChannelID = data?.metadata?.twitch_user_id || data?.customer?.metadata?.twitch_user_id;
    if (typeof metadataChannelID === 'string' && metadataChannelID.trim()) {
        const user = await UsersSchema.findOne({
            'accounts.id': metadataChannelID.trim(),
            'accounts.type': 'twitch'
        });

        if (user) {
            return user;
        }
    }

    const customerId = getCustomerId(data);
    if (!customerId) {
        return null;
    }

    return await UsersSchema.findOne({ polar_sh_customer_id: customerId });
}

async function updateUserPlanFromWebhook(options: {
    eventType: string;
    eventId?: string;
    data: any;
    status?: string;
    planTierUntil: Date | null;
}): Promise<{ userId: string; channelID: string; productId?: string; planTier: PlanTier } | null> {
    const { eventType, eventId, data, status, planTierUntil } = options;

    const user = await resolveUserFromSubscription(data);
    if (!user) {
        console.error('Polar.sh webhook: User not found from payload', {
            eventType,
            eventId,
            customerId: getCustomerId(data),
            productId: getProductId(data)
        });
        return null;
    }

    const channelID = user.accounts.find((account) => account.type === 'twitch')?.id;
    if (!channelID) {
        console.error('Polar.sh webhook: User has no twitch account', {
            eventType,
            eventId,
            userId: user._id
        });
        return null;
    }

    const productId = getProductId(data);
    const nextPlanTier = resolvePlanTier(productId);

    const updatedUser = await UsersSchema.findByIdAndUpdate(
        user._id,
        {
            plan_tier: nextPlanTier,
            plan_tier_until: planTierUntil
        },
        { new: true }
    );

    if (!updatedUser) {
        console.error('Polar.sh webhook: Failed to update user plan', {
            eventType,
            eventId,
            userId: user._id
        });
        return null;
    }

    try {
        const cache = await getDragonflyClient('handlePolarSHEvent plan cache sync');
        await cache.hSet(`accounts:twitch:${channelID}:data`, {
            plan_tier: nextPlanTier,
            plan_tier_until: planTierUntil ? planTierUntil.toDateString() : ''
        });
        await cache.del('twitch:accounts');
    } catch (cacheError) {
        console.error('Polar.sh webhook: Failed to sync plan tier to cache', {
            eventType,
            eventId,
            channelID,
            userId: updatedUser._id,
            error: cacheError instanceof Error ? cacheError.message : String(cacheError)
        });
    }

    info(
        {
            message: `Polar.sh webhook: Updated user ${updatedUser.name} (${channelID}) - plan_tier: ${nextPlanTier}`,
            eventType,
            eventId,
            subscriptionStatus: status,
            productId,
            planTierUntil: planTierUntil?.toISOString() || null
        },
        { destination: eventType === 'order.paid' ? 'console' : 'cache' }
    );

    return {
        userId: updatedUser._id.toString(),
        channelID,
        productId,
        planTier: nextPlanTier
    };
}

async function maybeProcessBotReward(options: {
    eventType: string;
    data: any;
    productId?: string;
    status?: string;
    eventId?: string;
}): Promise<void> {
    const { eventType, data, productId, status, eventId } = options;

    if (!productId || productId === PRODUCT_IDS.FREE) {
        return;
    }

    if (eventType === 'subscription.updated' || eventType === 'subscription.update') {
        const normalizedStatus = normalizeStatus(status);
        if (!isRenewedOrActiveStatus(normalizedStatus)) {
            return;
        }
    }

    const customerId = getCustomerId(data);
    const cadence = getSubscriptionCadence(data);
    const cycleKey = getSubscriptionCycleKey(data);
    const primaryId = String(data?.id || '').trim();
    const fallbackId = String(eventId || '').trim();
    const referenceId = primaryId || fallbackId;

    if (!customerId || !referenceId) {
        return;
    }

    const externalReference = `polar:subscription_reward:${eventType}:${referenceId}:${cycleKey}`;

    const reward = await processBotSubscriptionReward({
        payerPolarId: customerId,
        planId: productId,
        subscriptionId: referenceId,
        cadence,
        externalReference,
        botLogin: 'domdimabot'
    });

    if (!reward) {
        return;
    }

    info(
        {
            message: 'Polar.sh webhook: Bot subscription reward processed',
            amount: reward.amount,
            botUserId: reward.botUserId,
            externalReference,
            cadence,
            eventType
        },
        { destination: eventType === 'order.paid' ? 'console' : 'cache' }
    );
}

export async function handlePolarSHEvent(eventData: PolarSHEvent): Promise<void> {
    try {
        const eventType = eventData.type;
        const data = eventData.data;

        if (eventType === 'customer.state_changed') {
            const channelIdCandidate = data?.metadata?.twitch_user_id ?? data?.customer?.metadata?.twitch_user_id;
            const channelID = typeof channelIdCandidate === 'string'
                ? channelIdCandidate.trim()
                : typeof channelIdCandidate === 'number'
                    ? String(channelIdCandidate)
                    : '';

            if (!channelID) {
                console.error('Polar.sh webhook: Missing twitch_user_id in customer.state_changed metadata', {
                    eventType,
                    eventId: eventData.id
                });
                return;
            }

            const activeMeters = Array.isArray(data?.active_meters) ? data.active_meters : [];
            const aiMeter = activeMeters.find((meter: any) => meter?.meter_id === AI_USAGE_METER_ID);

            if (!aiMeter) {
                info(
                    {
                        message: 'Polar.sh webhook: AI meter not present in customer.state_changed',
                        eventType,
                        eventId: eventData.id,
                        channelID
                    },
                    { destination: 'cache' }
                );
                return;
            }

            const rawBalance = aiMeter?.balance;
            const balance = typeof rawBalance === 'number' ? rawBalance : Number(rawBalance);
            const cache = await getDragonflyClient('handlePolarSHEvent');
            const cacheKey = `twitch:${channelID}:ai:exhaust`;

            if (!Number.isFinite(balance)) {
                console.error('Polar.sh webhook: Invalid AI meter balance in customer.state_changed', {
                    eventType,
                    eventId: eventData.id,
                    channelID,
                    balance: rawBalance
                });
                return;
            }

            if (balance <= 0) {
                await cache.set(cacheKey, 'true');
            } else {
                await cache.del(cacheKey);
            }

            info(
                {
                    message: 'Polar.sh webhook: Updated AI exhaust cache from customer.state_changed',
                    eventType,
                    eventId: eventData.id,
                    channelID,
                    balance,
                    exhausted: balance <= 0
                },
                { destination: 'cache' }
            );

            return;
        }

        if (eventType === 'order.paid') {
            const planTierUntil = getSubscriptionPeriodEnd(data);
            const updateResult = await updateUserPlanFromWebhook({
                eventType,
                eventId: eventData.id,
                data,
                status: undefined,
                planTierUntil
            });

            if (!updateResult) {
                return;
            }

            await maybeProcessBotReward({
                eventType,
                eventId: eventData.id,
                data,
                productId: updateResult.productId,
                status: undefined
            });
            return;
        }

        if (eventType === 'subscription.updated' || eventType === 'subscription.update') {
            const status = normalizeStatus(data?.status);
            const planTierUntil = isCanceledStatus(status)
                ? getCanceledSubscriptionEnd(data)
                : getActiveSubscriptionEnd(data);

            const updateResult = await updateUserPlanFromWebhook({
                eventType,
                eventId: eventData.id,
                data,
                status,
                planTierUntil
            });

            if (!updateResult) {
                return;
            }

            await maybeProcessBotReward({
                eventType,
                eventId: eventData.id,
                data,
                productId: updateResult.productId,
                status
            });
            return;
        }

        info(
            {
                message: 'Polar.sh webhook: Ignored event type',
                eventType,
                eventId: eventData.id
            },
            { destination: 'cache' }
        );
    } catch (err) {
        await error({
            function: 'handlePolarSHEvent',
            eventType: eventData.type,
            eventId: eventData.id,
            error: err instanceof Error ? err.message : String(err)
        });
    }
}
