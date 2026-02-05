import { Schema, model, Types } from 'mongoose';

export interface IAdmin {
    _id: Types.ObjectId;
    adminName: string;
    adminID: string;
    channelName: string;
    channelID: string;
    actived: boolean;
    permissions: string[];
    createdAt: Date;
    updatedAt: Date;
}

const adminSchema = new Schema<IAdmin>({
    adminName: { type: String, default: '' },
    adminID: { type: String, default: '' },
    channelName: { type: String, default: '' },
    channelID: { type: String, default: '' },
    actived: { type: Boolean, default: true },
    permissions: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

adminSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

export const AdminSchema = model<IAdmin>('Admin', adminSchema);
