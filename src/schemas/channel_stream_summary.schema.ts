import { Schema, model, Types } from 'mongoose';

export type StreamSummaryStatus = 'pending' | 'applied' | 'noop' | 'failed';
export type StreamSummarySource = 'stream_offline' | 'weekly_maintenance' | 'monthly_maintenance' | 'manual';

export interface IMemoryProposal {
    action: 'create' | 'edit' | 'archive' | 'delete' | 'noop';
    type?: string;
    targetMemoryId?: string;
    summary?: string;
    content?: string;
    confidence?: number;
    risk?: 'low' | 'medium' | 'high';
    reason?: string;
    evidence?: string[];
}

export interface IMemoryActionResult {
    action: 'create' | 'edit' | 'archive' | 'delete' | 'noop';
    targetMemoryId?: string;
    status: 'applied' | 'skipped' | 'failed';
    reason?: string;
    error?: string;
}

export interface IMemoryActionTotals {
    proposed: number;
    applied: number;
    skipped: number;
    failed: number;
}

export interface IStreamSummary {
    _id: Types.ObjectId;
    channelID: string;
    channel: string;
    stream_session_id: Types.ObjectId;
    stream_id: string;
    started_at: Date;
    ended_at: Date;
    duration_minutes: number;
    average_viewers: number;
    peak_viewers: number;
    follows: number;
    subs: number;
    bits: number;
    donations: number;
    headline: string;
    recap: string;
    highlights: string[];
    chat_messages_sampled: number;
    snapshot_count: number;
    proposed_actions: IMemoryProposal[];
    applied_actions: IMemoryActionResult[];
    totals: IMemoryActionTotals;
    status: StreamSummaryStatus;
    error_message: string;
    source: StreamSummarySource;
    created_at: Date;
    updated_at: Date;
}

const memoryProposalSchema = new Schema<IMemoryProposal>({
    action: { type: String, enum: ['create', 'edit', 'archive', 'delete', 'noop'], required: true },
    type: { type: String, default: '' },
    targetMemoryId: { type: String, default: '' },
    summary: { type: String, default: '' },
    content: { type: String, default: '' },
    confidence: { type: Number, default: 0 },
    risk: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
    reason: { type: String, default: '' },
    evidence: { type: [String], default: [] }
}, { _id: false });

const memoryActionResultSchema = new Schema<IMemoryActionResult>({
    action: { type: String, enum: ['create', 'edit', 'archive', 'delete', 'noop'], required: true },
    targetMemoryId: { type: String, default: '' },
    status: { type: String, enum: ['applied', 'skipped', 'failed'], required: true },
    reason: { type: String, default: '' },
    error: { type: String, default: '' }
}, { _id: false });

const memoryActionTotalsSchema = new Schema<IMemoryActionTotals>({
    proposed: { type: Number, default: 0 },
    applied: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    failed: { type: Number, default: 0 }
}, { _id: false });

const streamSummarySchema = new Schema<IStreamSummary>({
    channelID: { type: String, required: true, index: true },
    channel: { type: String, required: true, default: 'Unknown' },
    stream_session_id: { type: Schema.Types.ObjectId, ref: 'StreamSession', required: true, index: true },
    stream_id: { type: String, required: true, default: '' },
    started_at: { type: Date, required: true, index: true },
    ended_at: { type: Date, required: true, index: true },
    duration_minutes: { type: Number, default: 0 },
    average_viewers: { type: Number, default: 0 },
    peak_viewers: { type: Number, default: 0 },
    follows: { type: Number, default: 0 },
    subs: { type: Number, default: 0 },
    bits: { type: Number, default: 0 },
    donations: { type: Number, default: 0 },
    headline: { type: String, default: '' },
    recap: { type: String, default: '' },
    highlights: { type: [String], default: [] },
    chat_messages_sampled: { type: Number, default: 0 },
    snapshot_count: { type: Number, default: 0 },
    proposed_actions: { type: [memoryProposalSchema], default: [] },
    applied_actions: { type: [memoryActionResultSchema], default: [] },
    totals: { type: memoryActionTotalsSchema, default: () => ({}) },
    status: {
        type: String,
        enum: ['pending', 'applied', 'noop', 'failed'],
        required: true,
        default: 'pending',
        index: true
    },
    error_message: { type: String, default: '' },
    source: {
        type: String,
        enum: ['stream_offline', 'weekly_maintenance', 'monthly_maintenance', 'manual'],
        required: true,
        default: 'stream_offline',
        index: true
    }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

streamSummarySchema.index({ channelID: 1, stream_session_id: 1, source: 1 }, { unique: true });
streamSummarySchema.index({ channelID: 1, ended_at: -1 });
streamSummarySchema.index({ status: 1, created_at: -1 });

export const ChannelStreamSummarySchema = model<IStreamSummary>('ChannelStreamSummary', streamSummarySchema);
