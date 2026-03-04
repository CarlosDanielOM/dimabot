import { Schema, model, Types } from 'mongoose';

export interface ICustomTimer {
    _id?: Types.ObjectId;
    name: string;
    message: string;
    frequency: number;
    channel: string;
    channelID: string;
    active: boolean;
    created_at?: Date;
    updated_at?: Date;
}

const customTimerSchema = new Schema<ICustomTimer>({
    name: {
        type: String,
        required: true,
        maxlength: 30,
        trim: true
    },
    message: {
        type: String,
        required: true,
        maxlength: 350,
        trim: true
    },
    frequency: {
        type: Number,
        required: true,
        min: 1,
        max: 288
    },
    channel: {
        type: String,
        required: true
    },
    channelID: {
        type: String,
        required: true,
        index: true
    },
    active: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: {
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    }
});

customTimerSchema.index({ channelID: 1, name: 1 }, { unique: true });

export const CustomTimerSchema = model<ICustomTimer>('custom_timer', customTimerSchema);
