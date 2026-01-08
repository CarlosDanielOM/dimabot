require('dotenv').config();
const channelSchema = require('../../../schema/channel');
const { getPolarShClient } = require('../../polarsh');
const logger = require('../../../util/logger');

const FREE_TIER_ID = "fccf0669-adab-447d-89c8-d77d8b83bea5";

/**
 * Creates Polar.sh customers for all channels missing polar_sh_customer_id
 * and subscribes them to the free tier.
 * 
 * @returns {Promise<{success: Array, failed: Array, total: number}>} Results of the operation
 */
async function PolarUpdate() {
    const results = {
        success: [],
        failed: [],
        total: 0
    };

    try {
        const polarshClient = getPolarShClient();

        // Find all channels without a Polar.sh customer ID
        const channels = await channelSchema.find({
            $or: [
                { polar_sh_customer_id: null },
                { polar_sh_customer_id: { $exists: false } }
            ]
        });

        results.total = channels.length;
        console.log(`Found ${channels.length} channels without Polar.sh customer ID`);

        if (channels.length === 0) {
            console.log('No channels to update');
            return results;
        }

        for (const channel of channels) {
            const channelID = channel.twitch_user_id;
            const channelName = channel.name;

            try {
                // 1. Create Polar.sh Customer
                console.log(`Creating Polar.sh customer for ${channelName} (${channelID})...`);
                
                const customer = await polarshClient.customers.create({
                    email: channel.email,
                    externalId: channel._id.toString(),
                    name: channel.name,
                    billingAddress: {
                        country: 'US'
                    },
                    metadata: {
                        twitch_user_id: channel.twitch_user_id,
                        twitch_user_name: channel.name
                    }
                });

                // 2. Update Database with customer ID
                await channelSchema.findOneAndUpdate(
                    { _id: channel._id },
                    { $set: { polar_sh_customer_id: customer.id } }
                );

                console.log(`Updated DB with customer ID for ${channelName}`);

                // 3. Subscribe to Free Tier
                const subscriptionResult = await polarshClient.subscriptions.create({
                    productId: FREE_TIER_ID,
                    customerId: customer.id,
                });

                if (subscriptionResult.error) {
                    logger(subscriptionResult, true, channelID, 'polar_migration_subscription');
                    throw new Error(`Subscription creation failed: ${subscriptionResult.error}`);
                }

                console.log(`Subscribed ${channelName} to free tier`);
                results.success.push({
                    channelName,
                    channelID,
                    customerId: customer.id
                });

            } catch (error) {
                console.error(`Error processing ${channelName} (${channelID}): ${error.message}`);
                logger(error, true, channelID, 'polar_migration');
                results.failed.push({
                    channelName,
                    channelID,
                    error: error.message
                });
            }
        }

        console.log('\n--- Polar.sh Migration Summary ---');
        console.log(`Success: ${results.success.length}`);
        console.log(`Failed: ${results.failed.length}`);

        return results;

    } catch (error) {
        console.error(`Migration operation failed: ${error.message}`);
        throw error;
    }
}

module.exports = {
    PolarUpdate
}