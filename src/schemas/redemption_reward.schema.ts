import { Schema, model, Types } from 'mongoose';

export interface IRedemptionReward {
    _id: Types.ObjectId;
    eventsubID: string;
    channelID: string;
    channel: string;
    rewardID: string;
    title: string;
    type: string;
    prompt: string;
    originalCost: number;
    cost: number;
    isEnabled: boolean;
    message: string;
    costChange: number;
    returnToOriginalCost: boolean;
    duration: number;
    cooldown: number;
    backgroundColor?: string;
    createdFrom: string;
    createdFor: string;
}

const redemptionRewardSchema = new Schema<IRedemptionReward>({
    eventsubID: { type: String, required: true },
    channelID: { type: String, required: true },
    channel: { type: String, required: true },
    rewardID: { type: String, required: true },
    title: { type: String, required: true },
    type: { type: String, default: 'custom' },
    prompt: { type: String, default: '' },
    originalCost: { type: Number, required: true },
    cost: { type: Number, required: true },
    isEnabled: { type: Boolean, default: true },
    message: { type: String, default: '' },
    costChange: { type: Number, default: 0 },
    returnToOriginalCost: { type: Boolean, default: false },
    duration: { type: Number, default: 0 },
    cooldown: { type: Number, default: 0 },
    backgroundColor: { type: String },
    createdFrom: { type: String, default: 'domdimabot' },
    createdFor: { type: String, default: 'twitch' },
});

export const RedemptionRewardSchema = model<IRedemptionReward>('redemptionreward', redemptionRewardSchema);
