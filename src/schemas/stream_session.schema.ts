import { Schema, model, Types } from 'mongoose';

export type StreamSessionStatus = 'live' | 'offline' | 'orphaned';

export interface IStreamSession {
    _id: Types.ObjectId;
    channelID: string;
    channel: string;
    stream_id: string;
    started_at: Date;
    ended_at: Date | null;
    status: StreamSessionStatus;
    peak_viewers: number;
    average_viewers: number;
    sample_count: number;
    sample_total_viewers: number;
    duration_minutes: number;
    follows: number;
    subs: number;
    bits: number;
    donations: number;
    messages: number;
    commands: number;
    last_seen_live_at: Date | null;
    consecutive_offline_checks: number;
    created_at: Date;
    updated_at: Date;
}

const streamSessionSchema = new Schema<IStreamSession>({
    channelID: { type: String, required: true, index: true },
    channel: { type: String, default: '' },
    stream_id: { type: String, required: true, index: true },
    started_at: { type: Date, required: true, index: true },
    ended_at: { type: Date, default: null, index: true },
    status: { type: String, enum: ['live', 'offline', 'orphaned'], default: 'live', index: true },
    peak_viewers: { type: Number, default: 0 },
    average_viewers: { type: Number, default: 0 },
    sample_count: { type: Number, default: 0 },
    sample_total_viewers: { type: Number, default: 0 },
    duration_minutes: { type: Number, default: 0 },
    follows: { type: Number, default: 0 },
    subs: { type: Number, default: 0 },
    bits: { type: Number, default: 0 },
    donations: { type: Number, default: 0 },
    messages: { type: Number, default: 0 },
    commands: { type: Number, default: 0 },
    last_seen_live_at: { type: Date, default: null },
    consecutive_offline_checks: { type: Number, default: 0 }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

streamSessionSchema.index({ channelID: 1, started_at: -1 });
streamSessionSchema.index({ channelID: 1, stream_id: 1 }, { unique: true });
streamSessionSchema.index(
    { channelID: 1, ended_at: 1 },
    { partialFilterExpression: { ended_at: null }, unique: true }
);

export const StreamSessionSchema = model<IStreamSession>('StreamSession', streamSessionSchema);
