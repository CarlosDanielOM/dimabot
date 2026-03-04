import { Schema, model, Types } from 'mongoose';

export interface IStreamSubscriptionLedger {
    _id?: Types.ObjectId;
    platform: 'twitch';
    streamer_id: string;
    streamer_login: string;
    streamer_name: string;
    user_id: string;
    user_login: string;
    user_name: string;
    sub_tier_raw: string;
    sub_tier_normalized: 'tier1' | 'tier2' | 'tier3' | 'unknown';
    is_gift: boolean;
    status: 'active' | 'ended';
    subbed_at: Date;
    ended_at: Date | null;
    last_event_at: Date;
    created_at?: Date;
    updated_at?: Date;
}

const streamSubscriptionLedgerSchema = new Schema<IStreamSubscriptionLedger>({
    platform: { type: String, enum: ['twitch'], required: true, default: 'twitch', index: true },
    streamer_id: { type: String, required: true, index: true },
    streamer_login: { type: String, default: '' },
    streamer_name: { type: String, default: '' },
    user_id: { type: String, required: true, index: true },
    user_login: { type: String, default: '' },
    user_name: { type: String, default: '' },
    sub_tier_raw: { type: String, default: '' },
    sub_tier_normalized: { type: String, enum: ['tier1', 'tier2', 'tier3', 'unknown'], default: 'unknown', index: true },
    is_gift: { type: Boolean, default: false },
    status: { type: String, enum: ['active', 'ended'], default: 'active', index: true },
    subbed_at: { type: Date, required: true, default: Date.now },
    ended_at: { type: Date, default: null },
    last_event_at: { type: Date, required: true, default: Date.now, index: true }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

streamSubscriptionLedgerSchema.index({ streamer_id: 1, status: 1 });
streamSubscriptionLedgerSchema.index(
    { platform: 1, streamer_id: 1, user_id: 1, status: 1 },
    { unique: true, partialFilterExpression: { status: 'active' } }
);

export const StreamSubscriptionLedgerSchema = model<IStreamSubscriptionLedger>('stream_subscription_ledger', streamSubscriptionLedgerSchema);
