import { getDragonflyClient } from '../utils/databases/dragonfly.database.js';
import { error, info } from '../utils/logger.js';
import { processSubscriptionReward, PRODUCT_IDS } from '../utils/referral.js';
import UsersSchema from '../schemas/users.schema.js';

const AI_USAGE_METER_ID = '01d90c16-87d0-4e31-880a-4045a8da90cd';

interface PolarSHEvent {
    type: string;
    data: any;
}

export async function handlePolarSHEvent(eventData: PolarSHEvent): Promise<void> {
    try {
        switch (eventData.type) {
            case 'customer.state_changed': {
                const channelID = eventData.data.metadata?.twitch_user_id;
                if (!channelID) {
                    console.error('Polar.sh webhook: Missing twitch_channel_id in metadata');
                    return;
                }

                const activeMeters = eventData.data.active_meters || [];
                const aiMeter = activeMeters.find((meter: any) => meter.meter_id === AI_USAGE_METER_ID);

                if (!aiMeter) {
                    return;
                }

                const cache = await getDragonflyClient('handlePolarSHEvent');
                if (aiMeter.balance <= 0) {
                    await cache.set(`twitch:${channelID}:ai:exhaust`, 'true');
                } else {
                    await cache.del(`twitch:${channelID}:ai:exhaust`);
                }
                break;
            }
            case 'subscription.created':
            case 'subscription.updated':
            case 'subscription.canceled':
            case 'subscription.revoked': {
                const channelID = eventData.data.metadata?.twitch_user_id || eventData.data.customer?.metadata?.twitch_user_id;
                if (!channelID) {
                    console.error('Polar.sh webhook: Missing twitch_channel_id in subscription/customer metadata');
                    return;
                }

                const productId = eventData.data.product_id;
                if (!productId) {
                    console.error('Polar.sh webhook: Missing product_id in subscription data');
                    return;
                }

                let plan_tier: 'free' | 'premium' | 'pro' = 'free';

                switch (productId) {
                    case PRODUCT_IDS.PRO:
                        plan_tier = 'pro';
                        break;
                    case PRODUCT_IDS.PREMIUM:
                        plan_tier = 'premium';
                        break;
                    case PRODUCT_IDS.FREE:
                    default:
                        plan_tier = 'free';
                        break;
                }

                if (eventData.data.status !== 'active') {
                    plan_tier = 'free';
                }

                const updatedUser = await UsersSchema.findOneAndUpdate(
                    { 'accounts.id': channelID, 'accounts.type': 'twitch' },
                    { 
                        plan_tier,
                        updatedAt: new Date()
                    },
                    { new: true }
                );

                if (updatedUser) {
                    info({ message: `Polar.sh webhook: Updated user ${updatedUser.name} (${channelID}) - plan_tier: ${plan_tier} (Status: ${eventData.data.status})` }, { destination: 'console' });
                    
                    if ((eventData.type === 'subscription.created' || eventData.type === 'subscription.updated') 
                        && eventData.data.status === 'active'
                        && productId !== PRODUCT_IDS.FREE) {
                        try {
                            const customerId = eventData.data.customer_id || eventData.data.customer?.id;
                            const subscriptionId = eventData.data.id;
                            
                            if (customerId && subscriptionId) {
                                const reward = await processSubscriptionReward(customerId, productId, subscriptionId);
                                if (reward) {
                                    console.log(`Polar.sh webhook: Referral reward processed - ${reward.amount} tokens to referrer ${reward.referrerId}`);
                                }
                            }
                        } catch (referralError) {
                            console.error('Polar.sh webhook: Error processing referral reward:', referralError);
                        }
                    }
                } else {
                    console.error(`Polar.sh webhook: User not found for twitch_user_id: ${channelID}`);
                }
                break;
            }
        }
    } catch (err) {
        await error({ 
            function: 'handlePolarSHEvent', 
            eventType: eventData.type,
            error: err instanceof Error ? err.message : String(err) 
        });
    }
}
