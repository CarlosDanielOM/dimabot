const Channel = require('../schema/channel');
const ReferralCode = require('../schema/referralCode');
const { CreditTransaction, TRANSACTION_TYPES } = require('../schema/creditTransaction');

// Plan-based referral code limits
const REFERRAL_CODE_LIMITS = {
    FREE: 1,
    PREMIUM: 5,
    PRO: 15
};

// Reward amounts per plan (in tokens/credits)
const REFERRAL_REWARDS = {
    FREE: 0,       // No reward for free plan signups
    PREMIUM: 100,  // 100 tokens for Premium referral
    PRO: 250       // 250 tokens for Pro referral
};

// Polar.sh Product IDs (matching the events handler)
const PRODUCT_IDS = {
    FREE: 'fccf0669-adab-447d-89c8-d77d8b83bea5',
    PREMIUM: '55c8d1d0-5cb8-405c-bcf2-d8dbb9ba0134',
    PRO: '1468eea1-7ad0-40d2-b828-4d4cd6b4abdc'
};

/**
 * Get the user's plan type based on their premium status
 * @param {Object} user - Channel document
 * @returns {string} Plan type: 'FREE', 'PREMIUM', or 'PRO'
 */
function getUserPlanType(user) {
    if (user.premium_plus) return 'PRO';
    if (user.premium) return 'PREMIUM';
    return 'FREE';
}

/**
 * Get the plan type from a Polar.sh product ID
 * @param {string} productId - Polar.sh product ID
 * @returns {string} Plan type: 'FREE', 'PREMIUM', or 'PRO'
 */
function getPlanTypeFromProductId(productId) {
    switch (productId) {
        case PRODUCT_IDS.PRO:
            return 'PRO';
        case PRODUCT_IDS.PREMIUM:
            return 'PREMIUM';
        case PRODUCT_IDS.FREE:
        default:
            return 'FREE';
    }
}

/**
 * Create a new referral campaign code for a user
 * @param {string} userId - Channel ObjectId
 * @param {string} code - The custom referral code
 * @param {string} label - Label/description for the code (e.g., "My Twitch Link")
 * @returns {Promise<Object>} Created ReferralCode document
 * @throws {Error} If user doesn't exist, limit reached, or code invalid/taken
 */
async function createCampaignCode(userId, code, label = '') {
    // Fetch user to check plan
    const user = await Channel.findById(userId);
    if (!user) {
        throw new Error('User not found');
    }

    // Get plan-based limit
    const planType = getUserPlanType(user);
    const limit = REFERRAL_CODE_LIMITS[planType];

    // Count existing codes for this user
    const existingCount = await ReferralCode.countDocuments({ owner: userId, active: true });

    // Check if limit reached
    if (existingCount >= limit) {
        throw new Error(`Referral code limit reached for ${planType} plan. Maximum ${limit} codes allowed.`);
    }

    // Validate code format (additional validation before DB)
    if (!/^[a-zA-Z0-9_]{1,16}$/.test(code)) {
        throw new Error('Invalid code format. Must be 1-16 alphanumeric characters or underscores.');
    }

    // Check if code already exists (case-insensitive)
    const existingCode = await ReferralCode.findOne({ code: code.toLowerCase() });
    if (existingCode) {
        throw new Error('This referral code is already taken.');
    }

    // Create the referral code
    const referralCode = new ReferralCode({
        code: code.toLowerCase(),
        owner: userId,
        label: label.substring(0, 50), // Truncate label if too long
        stats: { conversions: 0 }
    });

    await referralCode.save();
    return referralCode;
}

/**
 * Get all referral codes for a user
 * @param {string} userId - Channel ObjectId
 * @returns {Promise<Array>} Array of ReferralCode documents
 */
async function getUserCodes(userId) {
    return await ReferralCode.find({ owner: userId, active: true })
        .sort({ createdAt: -1 })
        .lean();
}

/**
 * Delete a referral code (soft delete by setting active to false)
 * @param {string} userId - Channel ObjectId
 * @param {string} codeId - ReferralCode ObjectId
 * @returns {Promise<boolean>} Success status
 */
async function deleteCampaignCode(userId, codeId) {
    const result = await ReferralCode.updateOne(
        { _id: codeId, owner: userId },
        { active: false }
    );
    return result.modifiedCount > 0;
}

/**
 * Apply a referral code to a user during signup/first visit
 * @param {string} userId - Channel ObjectId of the new user
 * @param {string} code - Referral code string
 * @returns {Promise<boolean>} Success status
 */
async function applyReferralCode(userId, code) {
    // Find the referral code
    const referralCode = await ReferralCode.findByCode(code);
    if (!referralCode) {
        return false;
    }

    // Prevent self-referral
    if (referralCode.owner.toString() === userId.toString()) {
        return false;
    }

    // Update the user with referrer info
    const result = await Channel.updateOne(
        { _id: userId, referrerId: null }, // Only if not already referred
        {
            referrerId: referralCode.owner,
            referralCodeUsed: referralCode.code
        }
    );

    return result.modifiedCount > 0;
}

/**
 * Process subscription reward when a referred user subscribes
 * @param {string} payerPolarId - Polar.sh customer ID of the payer
 * @param {string} planId - Polar.sh product ID
 * @param {string} subscriptionId - Polar.sh subscription ID
 * @returns {Promise<Object|null>} Transaction result or null if no reward applicable
 */
async function processSubscriptionReward(payerPolarId, planId, subscriptionId) {
    // Find the payer by Polar.sh customer ID
    const payer = await Channel.findOne({ polar_sh_customer_id: payerPolarId });
    if (!payer) {
        console.log(`Referral: Payer not found for polar_sh_customer_id: ${payerPolarId}`);
        return null;
    }

    // Check if user was referred
    if (!payer.referrerId || !payer.referralCodeUsed) {
        return null;
    }

    // Check if reward was already given for this subscription
    const existingTransaction = await CreditTransaction.findOne({
        'metadata.subscriptionId': subscriptionId
    });
    if (existingTransaction) {
        console.log(`Referral: Reward already processed for subscription: ${subscriptionId}`);
        return null;
    }

    // Get reward amount based on plan
    const planType = getPlanTypeFromProductId(planId);
    const rewardAmount = REFERRAL_REWARDS[planType];

    if (rewardAmount <= 0) {
        return null;
    }

    // Perform atomic parallel writes
    const [transaction, updatedReferrer, updatedCode] = await Promise.all([
        // 1. Create credit transaction (history)
        CreditTransaction.create({
            user: payer.referrerId,
            type: TRANSACTION_TYPES.REFERRAL_BONUS,
            amount: rewardAmount,
            metadata: {
                referralCodeUsed: payer.referralCodeUsed,
                referredUserId: payer._id,
                subscriptionId: subscriptionId,
                planId: planId,
                description: `Referral bonus for ${planType} subscription`
            }
        }),

        // 2. Update referrer's token balance (atomic increment)
        Channel.findOneAndUpdate(
            { _id: payer.referrerId },
            { $inc: { tokenBalance: rewardAmount } },
            { new: true }
        ),

        // 3. Update referral code stats (atomic increment)
        ReferralCode.updateOne(
            { code: payer.referralCodeUsed },
            { $inc: { 'stats.conversions': 1 } }
        )
    ]);

    // Update transaction with balance after
    if (transaction && updatedReferrer) {
        await CreditTransaction.updateOne(
            { _id: transaction._id },
            { balanceAfter: updatedReferrer.tokenBalance }
        );
    }

    console.log(`Referral: Processed ${rewardAmount} tokens for referrer ${payer.referrerId} (code: ${payer.referralCodeUsed})`);

    return {
        transactionId: transaction._id,
        referrerId: payer.referrerId,
        amount: rewardAmount,
        codeUsed: payer.referralCodeUsed
    };
}

/**
 * Get referral statistics for a user
 * @param {string} userId - Channel ObjectId
 * @returns {Promise<Object>} Statistics object
 */
async function getReferralStats(userId) {
    const user = await Channel.findById(userId);
    if (!user) {
        throw new Error('User not found');
    }

    const planType = getUserPlanType(user);
    const limit = REFERRAL_CODE_LIMITS[planType];

    const [codes, totalConversions, totalEarned] = await Promise.all([
        ReferralCode.find({ owner: userId, active: true })
            .sort({ createdAt: -1 })
            .lean(),
        ReferralCode.aggregate([
            { $match: { owner: user._id, active: true } },
            { $group: { _id: null, total: { $sum: '$stats.conversions' } } }
        ]),
        CreditTransaction.aggregate([
            { $match: { user: user._id, type: TRANSACTION_TYPES.REFERRAL_BONUS } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ])
    ]);

    return {
        planType,
        codeLimit: limit,
        codesUsed: codes.length,
        codesRemaining: limit - codes.length,
        codes,
        totalConversions: totalConversions[0]?.total || 0,
        totalEarned: totalEarned[0]?.total || 0,
        currentBalance: user.tokenBalance
    };
}

module.exports = {
    createCampaignCode,
    getUserCodes,
    deleteCampaignCode,
    applyReferralCode,
    processSubscriptionReward,
    getReferralStats,
    getUserPlanType,
    REFERRAL_CODE_LIMITS,
    REFERRAL_REWARDS,
    PRODUCT_IDS
};
