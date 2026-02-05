import { Schema, model, Types } from 'mongoose';

export interface ICountdownTimer {
    _id: Types.ObjectId;
    channel: string;
    channelID: string;
    startTime: number;
    resumedAt: Date;
    pausedAt: Date;
    time: number;
    paused: boolean;
    active: boolean;
}

const countdownTimerSchema = new Schema<ICountdownTimer>({
    channel: { type: String, required: true },
    channelID: { type: String, required: true },
    startTime: { type: Number, required: true },
    resumedAt: Date,
    pausedAt: Date,
    time: { type: Number, default: 0 },
    paused: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
});

export const CountdownTimerSchema = model<ICountdownTimer>('Countdowntimer', countdownTimerSchema);
