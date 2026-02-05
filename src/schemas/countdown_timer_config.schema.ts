import { Schema, model, Types } from 'mongoose';

export interface ICountdownTimerConfig {
    _id: Types.ObjectId;
    channel: string;
    channelID: string;
    bits: number;
    tier1: number;
    tier2: number;
    tier3: number;
    follows: number;
    raids: number;
    viewers: number;
    donations: number;
}

const countdownTimerConfigSchema = new Schema<ICountdownTimerConfig>({
    channel: { type: String, required: true },
    channelID: { type: String, required: true },
    bits: { type: Number, required: true },
    tier1: { type: Number, required: true },
    tier2: { type: Number, required: true },
    tier3: { type: Number, required: true },
    follows: { type: Number, required: true },
    raids: { type: Number, required: true },
    viewers: { type: Number, required: true },
    donations: { type: Number, required: true },
});

export const CountdownTimerConfigSchema = model<ICountdownTimerConfig>('Countdowntimerconfig', countdownTimerConfigSchema);
