import { Schema, model, Types } from 'mongoose';

export type FollowPlatform = 'twitch';
export type FollowStatus = 'active' | 'ended';
export type EndedReason = 'missing_in_followers_scan' | 'missing_in_following_scan' | 'event_unfollow' | 'unknown';

export interface IFollowRelationshipLedger {
    _id: Types.ObjectId;
    platform: FollowPlatform;
    follower_id: string;
    follower_login: string;
    follower_name: string;
    followed_id: string;
    followed_login: string;
    followed_name: string;
    mutual: boolean;
    status: FollowStatus;
    followed_at: Date;
    ended_at: Date | null;
    ended_reason: EndedReason | null;
    last_event_at: Date;
    created_at: Date;
    updated_at: Date;
}

const followRelationshipLedgerSchema = new Schema<IFollowRelationshipLedger>({
    platform: {
        type: String,
        enum: ['twitch'],
        required: true,
        default: 'twitch',
        index: true
    },
    follower_id: {
        type: String,
        required: true,
        index: true
    },
    follower_login: {
        type: String,
        default: ''
    },
    follower_name: {
        type: String,
        default: ''
    },
    followed_id: {
        type: String,
        required: true,
        index: true
    },
    followed_login: {
        type: String,
        default: ''
    },
    followed_name: {
        type: String,
        default: ''
    },
    mutual: {
        type: Boolean,
        default: false,
        index: true
    },
    status: {
        type: String,
        enum: ['active', 'ended'],
        default: 'active',
        index: true
    },
    followed_at: {
        type: Date,
        required: true,
        default: Date.now
    },
    ended_at: {
        type: Date,
        default: null
    },
    ended_reason: {
        type: String,
        enum: ['missing_in_followers_scan', 'missing_in_following_scan', 'event_unfollow', 'unknown'],
        default: null
    },
    last_event_at: {
        type: Date,
        required: true,
        default: Date.now,
        index: true
    }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

followRelationshipLedgerSchema.index({ followed_id: 1, status: 1 });
followRelationshipLedgerSchema.index({ followed_id: 1, mutual: 1, status: 1 });
followRelationshipLedgerSchema.index({ follower_id: 1, status: 1 });
followRelationshipLedgerSchema.index(
    { platform: 1, follower_id: 1, followed_id: 1, status: 1 },
    { unique: true, partialFilterExpression: { status: 'active' } }
);

export const FollowRelationshipLedgerSchema = model<IFollowRelationshipLedger>(
    'follow_relationship_ledger',
    followRelationshipLedgerSchema
);
