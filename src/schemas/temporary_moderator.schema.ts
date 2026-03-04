import { Schema, model, Types } from 'mongoose';

export interface ITemporaryModerator {
    _id: Types.ObjectId;
    channelID: string;
    channel: string;
    userID: string;
    username: string;
    durationDays: number;
    expireTimestamp: Date;
    createdAt: Date;
}

const temporaryModeratorSchema = new Schema<ITemporaryModerator>({
    channelID: { type: String, required: true, index: true },
    channel: { type: String, required: true },
    userID: { type: String, required: true, index: true },
    username: { type: String, required: true },
    durationDays: { type: Number, required: true },
    expireTimestamp: { type: Date, required: true, index: true },
    createdAt: { type: Date, default: Date.now }
});

temporaryModeratorSchema.index({ channelID: 1, userID: 1 }, { unique: true });

export const TemporaryModeratorSchema = model<ITemporaryModerator>('temporary_moderator', temporaryModeratorSchema);
