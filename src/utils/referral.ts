import { Schema, Types } from 'mongoose';
import UsersSchema, { type IUsers } from '../schemas/users.schema.js';
import { ReferralCodeSchema, type IReferralCode } from '../schemas/referral_code.schema.js';
import { CreditTransactionSchema, TRANSACTION_TYPES } from '../schemas/credit_transaction.schema.js';

export const REFERRAL_CODE_LIMITS = {
    FREE: 1,
    PREMIUM: 5,
    PRO: 15
} as const;

export const REFERRAL_REWARDS = {
    FREE: 0,
    PREMIUM: 100,
    PRO: 250
} as const;

export const PRODUCT_IDS = {
    FREE: 'fccf0669-adab-447d-89c8-d77d8b83bea5',
    PREMIUM: '55c8d1d0-5cb8-405c-bcf2-d8dbb9ba0134',
    PRO: '1468eea1-7ad0-40d2-b828-4d4cd6b4abdc'
} as const;

export type PlanType = 'FREE' | 'PREMIUM' | 'PRO';

export function getUserPlanType(user: IUsers): PlanType {
    if (user.plan_tier === 'pro') return 'PRO';
    if (user.plan_tier === 'premium') return 'PREMIUM';
    return 'FREE';
}

export function getPlanTypeFromProductId(productId: string): PlanType {
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

export async function createCampaignCode(userId: Types.ObjectId, code: string, label: string = ''): Promise<IReferralCode> {
    const user = await UsersSchema.findById(userId);
    if (!user) {
        throw new Error('User not found');
    }

    const planType = getUserPlanType(user);
    const limit = REFERRAL_CODE_LIMITS[planType];

    const existingCount = await ReferralCodeSchema.countDocuments({ owner: userId, active: true });

    if (existingCount >= limit) {
        throw new Error(`Referral code limit reached for ${planType} plan. Maximum ${limit} codes allowed.`);
    }

    if (!/^[a-zA-Z0-9_]{1,16}$/.test(code)) {
        throw new Error('Invalid code format. Must be 1-16 alphanumeric characters or underscores.');
    }

    const existingCode = await ReferralCodeSchema.findOne({ code: code.toLowerCase() });
    if (existingCode) {
        throw new Error('This referral code is already taken.');
    }

    const referralCode = new ReferralCodeSchema({
        code: code.toLowerCase(),
        owner: userId,
        label: label.substring(0, 50),
        stats: { conversions: 0 }
    });

    await referralCode.save();
    return referralCode;
}

export async function getUserCodes(userId: Types.ObjectId): Promise<IReferralCode[]> {
    return await ReferralCodeSchema.find({ owner: userId, active: true })
        .sort({ createdAt: -1 })
        .lean();
}

export async function deleteCampaignCode(userId: Types.ObjectId, codeId: Types.ObjectId): Promise<boolean> {
    const result = await ReferralCodeSchema.updateOne(
        { _id: codeId, owner: userId },
        { active: false }
    );
    return result.modifiedCount > 0;
}

export async function applyReferralCode(userId: Types.ObjectId, code: string): Promise<boolean> {
    const referralCode = await ReferralCodeSchema.findByCode(code);
    if (!referralCode) {
        return false;
    }

    if (referralCode.owner.toString() === userId.toString()) {
        return false;
    }

    const result = await UsersSchema.updateOne(
        { _id: userId, referrerId: null },
        {
            referrerId: referralCode.owner,
            referralCodeUsed: referralCode.code
        }
    );

    return result.modifiedCount > 0;
}

export interface ProcessRewardResult {
    transactionId: Types.ObjectId;
    referrerId: Types.ObjectId;
    amount: number;
    codeUsed: string;
}

export async function processSubscriptionReward(
    payerPolarId: string,
    planId: string,
    subscriptionId: string
): Promise<ProcessRewardResult | null> {
    const payer = await UsersSchema.findOne({ polar_sh_customer_id: payerPolarId });
    if (!payer) {
        console.log(`Referral: Payer not found for polar_sh_customer_id: ${payerPolarId}`);
        return null;
    }

    if (!payer.referrerId || !payer.referralCodeUsed) {
        return null;
    }

    const existingTransaction = await CreditTransactionSchema.findOne({
        'metadata.subscriptionId': subscriptionId
    });
    if (existingTransaction) {
        console.log(`Referral: Reward already processed for subscription: ${subscriptionId}`);
        return null;
    }

    const planType = getPlanTypeFromProductId(planId);
    const rewardAmount = REFERRAL_REWARDS[planType];

    if (rewardAmount <= 0) {
        return null;
    }

    const [transaction, updatedReferrer, updatedCode] = await Promise.all([
        CreditTransactionSchema.create({
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

        UsersSchema.findOneAndUpdate(
            { _id: payer.referrerId },
            { $inc: { tokenBalance: rewardAmount } },
            { new: true }
        ),

        ReferralCodeSchema.updateOne(
            { code: payer.referralCodeUsed },
            { $inc: { 'stats.conversions': 1 } }
        )
    ]);

    if (transaction && updatedReferrer) {
        await CreditTransactionSchema.updateOne(
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

export interface ReferralStats {
    planType: PlanType;
    codeLimit: number;
    codesUsed: number;
    codesRemaining: number;
    codes: IReferralCode[];
    totalConversions: number;
    totalEarned: number;
    currentBalance: number;
}

export async function getReferralStats(userId: Types.ObjectId): Promise<ReferralStats> {
    const user = await UsersSchema.findById(userId);
    if (!user) {
        throw new Error('User not found');
    }

    const planType = getUserPlanType(user);
    const limit = REFERRAL_CODE_LIMITS[planType];

    const [codes, totalConversions, totalEarned] = await Promise.all([
        ReferralCodeSchema.find({ owner: userId, active: true })
            .sort({ createdAt: -1 })
            .lean(),
        ReferralCodeSchema.aggregate([
            { $match: { owner: user._id, active: true } },
            { $group: { _id: null, total: { $sum: '$stats.conversions' } } }
        ]),
        CreditTransactionSchema.aggregate([
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
        currentBalance: user.tokenBalance || 0
    };
}
