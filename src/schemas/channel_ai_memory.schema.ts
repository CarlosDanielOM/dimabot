import { Schema, model, Document, Types } from "mongoose";

export type MemorySubjectScope = 'channel' | 'user';
export type MemorySource = 'chat' | 'mod' | 'streamer' | 'system';
export type MemoryType = 'preference' | 'running_joke' | 'known_user_fact' | 'channel_lore' | 'boundary';
export type MemoryStatus = 'candidate' | 'pending_review' | 'confirmed' | 'rejected' | 'archived';
export type MemoryRisk = 'low' | 'medium' | 'high';

export interface IMemorySubject {
    scope: MemorySubjectScope;
    username: string;
    userID: string;
}

export interface IMemoryEvidence {
    source: MemorySource;
    username: string;
    userID: string;
    message: string;
    messageId: string;
    timestamp: number;
}

export interface IMemoryActor {
    source: MemorySource;
    username: string;
    userID: string;
}

export interface IChannelAIMemory extends Document {
    _id: Types.ObjectId;
    channelID: string;
    channel: string;
    type: MemoryType;
    status: MemoryStatus;
    risk: MemoryRisk;
    confidence: number;
    subject: IMemorySubject;
    content: string;
    summary: string;
    fingerprint: string;
    sourceEvidence: IMemoryEvidence[];
    createdBy: IMemoryActor;
    reviewedBy?: IMemoryActor;
    reviewReason: string;
    reviewedAt?: Date;
    useCount: number;
    lastUsedAt?: Date;
    expiresAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const memorySubjectSchema = new Schema<IMemorySubject>({
    scope: {
        type: String,
        enum: ['channel', 'user'],
        required: true,
        default: 'channel'
    },
    username: { type: String, default: '' },
    userID: { type: String, default: '' }
}, { _id: false });

const memoryEvidenceSchema = new Schema<IMemoryEvidence>({
    source: {
        type: String,
        enum: ['chat', 'mod', 'streamer', 'system'],
        required: true,
        default: 'chat'
    },
    username: { type: String, default: '' },
    userID: { type: String, default: '' },
    message: { type: String, default: '' },
    messageId: { type: String, default: '' },
    timestamp: { type: Number, required: true, default: () => Math.floor(Date.now() / 1000) }
}, { _id: false });

const memoryActorSchema = new Schema<IMemoryActor>({
    source: {
        type: String,
        enum: ['chat', 'mod', 'streamer', 'system'],
        required: true,
        default: 'system'
    },
    username: { type: String, default: '' },
    userID: { type: String, default: '' }
}, { _id: false });

const channelAIMemorySchema = new Schema<IChannelAIMemory>({
    channelID: { type: String, required: true },
    channel: { type: String, required: true, default: 'Unknown' },
    type: {
        type: String,
        enum: ['preference', 'running_joke', 'known_user_fact', 'channel_lore', 'boundary'],
        required: true
    },
    status: {
        type: String,
        enum: ['candidate', 'pending_review', 'confirmed', 'rejected', 'archived'],
        required: true,
        default: 'candidate'
    },
    risk: {
        type: String,
        enum: ['low', 'medium', 'high'],
        required: true,
        default: 'low'
    },
    confidence: { type: Number, required: true, default: 0.5, min: 0, max: 1 },
    subject: { type: memorySubjectSchema, required: true, default: { scope: 'channel' } },
    content: { type: String, required: true },
    summary: { type: String, required: true },
    fingerprint: { type: String, required: true },
    sourceEvidence: { type: [memoryEvidenceSchema], default: [] },
    createdBy: { type: memoryActorSchema, required: true, default: { source: 'system' } },
    reviewedBy: { type: memoryActorSchema, required: false },
    reviewReason: { type: String, default: '' },
    reviewedAt: { type: Date },
    useCount: { type: Number, default: 0 },
    lastUsedAt: { type: Date },
    expiresAt: { type: Date }
}, {
    timestamps: true
});

channelAIMemorySchema.index({ channelID: 1, status: 1, type: 1 });
channelAIMemorySchema.index({ channelID: 1, fingerprint: 1 }, { unique: true });
channelAIMemorySchema.index({ channelID: 1, updatedAt: -1 });
channelAIMemorySchema.index({ channelID: 1, 'subject.username': 1, type: 1 });

export const ChannelAIMemorySchema = model<IChannelAIMemory>('ChannelAIMemory', channelAIMemorySchema);

export default ChannelAIMemorySchema;
