const mongoose = require('mongoose');
const schema = mongoose.Schema;

const TRANSACTION_TYPES = {
    REFERRAL_BONUS: 'referral_bonus',
    REFERRAL_PAYOUT: 'referral_payout',
    MANUAL_CREDIT: 'manual_credit',
    MANUAL_DEBIT: 'manual_debit'
};

const creditTransactionSchema = new schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Channel',
        required: true,
        index: true
    },
    type: {
        type: String,
        enum: Object.values(TRANSACTION_TYPES),
        required: true,
        index: true
    },
    amount: {
        type: Number,
        required: true
    },
    balanceAfter: {
        type: Number,
        default: null
    },
    metadata: {
        // For referral transactions
        referralCodeUsed: { type: String, default: null },
        referredUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', default: null },
        subscriptionId: { type: String, default: null },
        planId: { type: String, default: null },
        // General metadata
        description: { type: String, default: '' },
        externalReference: { type: String, default: null }
    }
}, {
    timestamps: true
});

// Index for efficient user transaction history queries
creditTransactionSchema.index({ user: 1, createdAt: -1 });

// Index for finding transactions by subscription (to prevent duplicates)
creditTransactionSchema.index({ 'metadata.subscriptionId': 1 }, { sparse: true });

const CreditTransaction = mongoose.model('CreditTransaction', creditTransactionSchema);

module.exports = {
    CreditTransaction,
    TRANSACTION_TYPES
};
