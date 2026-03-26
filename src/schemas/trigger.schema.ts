import { Schema, model, Types } from 'mongoose';

export interface ITrigger {
    _id: Types.ObjectId;
    name: string;
    channel: string;
    channelID: string;
    rewardID: string;
    file: string;
    fileID?: Types.ObjectId | null;
    assetID?: Types.ObjectId | null;
    libraryItemID?: Types.ObjectId | null;
    type: string;
    mediaType: string;
    isEnabled: boolean;
    volume: number;
    cost: number;
    cooldown: number;
    prompt: string;
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
    rewardID: { type: String, required: false },
    file: { type: String, required: true },
    fileID: { type: Schema.Types.ObjectId, required: false, default: null },
    assetID: { type: Schema.Types.ObjectId, required: false, default: null, ref: 'MediaAsset' },
    libraryItemID: { type: Schema.Types.ObjectId, required: false, default: null, ref: 'UserMediaLibraryItem' },
    type: { type: String, default: 'trigger' },
    mediaType: { type: String, required: true },
    isEnabled: { type: Boolean, default: true },
    volume: { type: Number, default: 100 },
    cost: { type: Number, default: 1 },
    cooldown: { type: Number, default: 0 },
    prompt: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
    date: {
        day: { type: Number, default: () => new Date().getDate() },
        month: { type: Number, default: () => new Date().getMonth() + 1 },
        year: { type: Number, default: () => new Date().getFullYear() },
    },
});

export const TriggerSchema = model<ITrigger>('Trigger', triggerSchema);
