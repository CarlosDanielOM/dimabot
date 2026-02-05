import { Schema, model, Types } from 'mongoose';

export interface ICommandTimer {
    _id: Types.ObjectId;
    command: string;
    timer: number;
    channel: string;
    channelID: string;
    createdAt: Date;
    date: {
        day: number;
        month: number;
        year: number;
    };
}

const commandTimerSchema = new Schema<ICommandTimer>({
    command: { type: String, required: true },
    timer: { type: Number, required: true },
    channel: { type: String, required: true },
    channelID: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    date: {
        day: { type: Number, default: () => new Date().getDate() },
        month: { type: Number, default: () => new Date().getMonth() + 1 },
        year: { type: Number, default: () => new Date().getFullYear() },
    },
});

export const CommandTimerSchema = model<ICommandTimer>('timer_command', commandTimerSchema);
