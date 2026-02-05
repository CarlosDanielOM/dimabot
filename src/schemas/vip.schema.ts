import { Schema, model, Types } from 'mongoose';

export interface IVip {
    _id: Types.ObjectId;
    username: string;
    userID: string;
    channel: string;
    channelID: string;
    duration: number;
    vip: boolean;
    date: {
        day: number;
        month: number;
        year: number;
    };
    createdAt: Date;
    expireDate: {
        day: number;
        month: number;
        year: number;
    };
    expireTimestamp: Date;
}

const vipSchema = new Schema<IVip>({
    username: { type: String, required: true },
    userID: { type: String, required: true },
    channel: { type: String, required: true },
    channelID: { type: String, required: true },
    duration: { type: Number, required: true },
    vip: { type: Boolean, default: true },
    date: {
        day: { type: Number, default: () => new Date().getDate() },
        month: { type: Number, default: () => new Date().getMonth() },
        year: { type: Number, default: () => new Date().getFullYear() },
    },
    createdAt: { type: Date, default: Date.now },
    expireDate: {
        day: { type: Number, required: true },
        month: { type: Number, required: true },
        year: { type: Number, required: true },
    },
    expireTimestamp: { type: Date, required: true },
});

export const VipSchema = model<IVip>('vip', vipSchema);
