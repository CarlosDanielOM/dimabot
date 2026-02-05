import { Schema, model, Types } from 'mongoose';

export interface ITrigger {
    _id: Types.ObjectId;
    name: string;
    channel: string;
    channelID: string;
    rewardID: string;
    file: string;
    fileID: Types.ObjectId;
    type: string;
    mediaType: string;
    volume: number;
    cost: number;
    cooldown: number;
    createdAt: Date;
    date: {
        day: number;
        month: number;
        year: number;
    };
}

const triggerSchema = new Schema<ITrigger>({
    name: { type: String, required: true },
    channel: { type: String, required: true },
    channelID: { type: String, required: true },
    rewardID: { type: String, required: true },
    file: { type: String, required: true },
    fileID: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, default: 'redemption' },
    mediaType: { type: String, required: true },
    volume: { type: Number, default: 100 },
    cost: { type: Number, default: 1 },
    cooldown: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    date: {
        day: { type: Number, default: () => new Date().getDate() },
        month: { type: Number, default: () => new Date().getMonth() + 1 },
        year: { type: Number, default: () => new Date().getFullYear() },
    },
});

export const TriggerSchema = model<ITrigger>('Trigger', triggerSchema);
