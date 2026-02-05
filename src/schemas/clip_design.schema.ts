import { Schema, model, Types } from 'mongoose';

export interface IClipDesign {
    _id: Types.ObjectId;
    name: string;
    channelID: string;
    channel: string;
    cssUrl: string;
    isPublic: boolean;
    isDefault: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const clipDesignSchema = new Schema<IClipDesign>({
    name: {
        type: String,
        required: true,
        unique: true,
    },
    channelID: {
        type: String,
        required: true,
    },
    channel: {
        type: String,
        required: true,
    },
    cssUrl: {
        type: String,
        required: true,
    },
    isPublic: {
        type: Boolean,
        default: false,
    },
    isDefault: {
        type: Boolean,
        default: false,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
});

clipDesignSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

clipDesignSchema.pre('save', async function (next) {
    if (this.isDefault) {
        await (this.constructor as any).updateMany(
            { channelID: this.channelID, _id: { $ne: this._id } },
            { isDefault: false },
        );
    }
    next();
});

export const ClipDesignSchema = model<IClipDesign>('ClipDesign', clipDesignSchema);
