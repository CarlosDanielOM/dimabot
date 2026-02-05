import { Schema, model, Types } from 'mongoose';

export interface ITriggerFile {
    _id: Types.ObjectId;
    name: string;
    fileName: string;
    fileSize: number;
    fileType: string;
    fileUrl: string;
    channel: string;
    channelID: string;
    createdAt: Date;
    date: {
        day: number;
        month: number;
        year: number;
    };
}

const triggerFileSchema = new Schema<ITriggerFile>({
    name: { type: String, required: true },
    fileName: { type: String, required: true },
    fileSize: { type: Number, required: true },
    fileType: { type: String, required: true },
    fileUrl: { type: String, required: true },
    channel: { type: String, required: true },
    channelID: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    date: {
        day: { type: Number, default: () => new Date().getDate() },
        month: { type: Number, default: () => new Date().getMonth() + 1 },
        year: { type: Number, default: () => new Date().getFullYear() },
    },
});

export const TriggerFileSchema = model<ITriggerFile>('TriggerFile', triggerFileSchema);
