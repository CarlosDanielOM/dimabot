import { Schema, model, Types } from 'mongoose';

export const TRANSACTION_TYPES = {
    REFERRAL_BONUS: 'referral_bonus',
    REFERRAL_PAYOUT: 'referral_payout',
    MANUAL_CREDIT: 'manual_credit',
    MANUAL_DEBIT: 'manual_debit',
} as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[keyof typeof TRANSACTION_TYPES];

export interface ICreditTransactionMetadata {
    referralCodeUsed?: string;
    referredUserId?: Types.ObjectId;
    subscriptionId?: string;
    planId?: string;
    description?: string;
    externalReference?: string;
}

export interface ICreditTransaction {
    _id: Types.ObjectId;
    user: Types.ObjectId;
    type: TransactionType;
    amount: number;
    balanceAfter?: number;
    metadata: ICreditTransactionMetadata;
    createdAt: Date;
    updatedAt: Date;
}

const creditTransactionSchema = new Schema<ICreditTransaction>(
    {
        user: {
            type: Schema.Types.ObjectId,
            ref: 'Channel',
            required: true,
            index: true,
        },
        type: {
            type: String,
            enum: Object.values(TRANSACTION_TYPES),
            required: true,
            index: true,
        },
        amount: {
            type: Number,
            required: true,
        },
        balanceAfter: {
            type: Number,
            default: null,
        },
        metadata: {
            referralCodeUsed: { type: String, default: null },
            referredUserId: { type: Schema.Types.ObjectId, ref: 'Channel', default: null },
            subscriptionId: { type: String, default: null },
            planId: { type: String, default: null },
            description: { type: String, default: '' },
            externalReference: { type: String, default: null },
        },
    },
    { timestamps: true },
);

creditTransactionSchema.index({ user: 1, createdAt: -1 });
creditTransactionSchema.index({ 'metadata.subscriptionId': 1 }, { sparse: true });

export const CreditTransactionSchema = model<ICreditTransaction>('CreditTransaction', creditTransactionSchema);
