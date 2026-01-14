const { getClient } = require('../../util/database/dragonfly');
const Channel = require('../../schema/channel');
const { processSubscriptionReward, PRODUCT_IDS } = require('../../util/referral');

const AI_USAGE_METER_ID = '01d90c16-87d0-4e31-880a-4045a8da90cd';

async function polarSHEventsHandler(eventData) {
    const cacheClient = getClient();

    switch(eventData.type) {
        case 'customer.state_changed': {
            const channelID = eventData.data.metadata?.twitch_user_id;
            if (!channelID) {
                console.error('Polar.sh webhook: Missing twitch_channel_id in metadata');
                return;
            }

            const activeMeters = eventData.data.active_meters || [];
            const aiMeter = activeMeters.find(meter => meter.meter_id === AI_USAGE_METER_ID);

            if (!aiMeter) {
                return;
            }

            if (aiMeter.balance <= 0) {
                await cacheClient.set(`${channelID}:ai:exhaust`, 'true');
            } else {
                await cacheClient.del(`${channelID}:ai:exhaust`);
            }
            break;
        }
        case 'subscription.created':
        case 'subscription.updated':
        case 'subscription.canceled':
        case 'subscription.revoked': {
            // Try to get twitch_channel_id from subscription metadata first, then from customer metadata
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

            // Determine premium status based on product
            let premium = false;
            let premium_plus = false;

            switch (productId) {
                case PRODUCT_IDS.PRO:
                    premium = true;
                    premium_plus = true;
                    break;
                case PRODUCT_IDS.PREMIUM:
                    premium = true;
                    premium_plus = false;
                    break;
                case PRODUCT_IDS.FREE:
                default:
                    premium = false;
                    premium_plus = false;
                    break;
            }

            // Check if subscription is active
            if (eventData.data.status !== 'active') {
                premium = false;
                premium_plus = false;
            }

            // Update the channel in the database
            const updatedChannel = await Channel.findOneAndUpdate(
                { twitch_user_id: channelID },
                { 
                    premium,
                    premium_plus,
                    updatedAt: new Date()
                },
                { new: true }
            );

            if (updatedChannel) {
                console.log(`Polar.sh webhook: Updated channel ${updatedChannel.name} (${channelID}) - premium: ${premium}, premium_plus: ${premium_plus} (Status: ${eventData.data.status})`);
                
                // Process referral reward for new active subscriptions
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
                        console.error('Polar.sh webhook: Error processing referral reward:', referralError.message);
                    }
                }
            } else {
                console.error(`Polar.sh webhook: Channel not found for twitch_user_id: ${channelID}`);
            }
            break;
        }
    }
}

module.exports = polarSHEventsHandler;