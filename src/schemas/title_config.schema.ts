import { Schema, model, Types } from 'mongoose';

export interface ITitleConfig {
    _id: Types.ObjectId;
    channelID: string;
    channel: string;
    pretitle?: string;
    posttitle?: string;
    active: boolean;
}

const titleConfigSchema = new Schema<ITitleConfig>({
    channelID: { type: String, required: true },
    channel: { type: String, required: true },
    pretitle: { type: String },
    posttitle: { type: String },
    active: { type: Boolean, default: true },
});

export const TitleConfigSchema = model<ITitleConfig>('titleConfig', titleConfigSchema);
