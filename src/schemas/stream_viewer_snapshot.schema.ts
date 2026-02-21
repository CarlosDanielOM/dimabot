import { Schema, model, Types } from 'mongoose';

export interface IStreamViewerSnapshot {
    _id: Types.ObjectId;
    channelID: string;
    session_id: Types.ObjectId;
    stream_id: string;
    captured_at: Date;
    viewers: number;
    title: string;
    game_name: string;
    created_at: Date;
    updated_at: Date;
}

const streamViewerSnapshotSchema = new Schema<IStreamViewerSnapshot>({
    channelID: { type: String, required: true, index: true },
    session_id: { type: Schema.Types.ObjectId, ref: 'StreamSession', required: true, index: true },
    stream_id: { type: String, required: true, index: true },
    captured_at: { type: Date, required: true, index: true },
    viewers: { type: Number, required: true, min: 0 },
    title: { type: String, default: '' },
    game_name: { type: String, default: '' }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

streamViewerSnapshotSchema.index({ channelID: 1, captured_at: -1 });
streamViewerSnapshotSchema.index({ session_id: 1, captured_at: 1 });

export const StreamViewerSnapshotSchema = model<IStreamViewerSnapshot>('StreamViewerSnapshot', streamViewerSnapshotSchema);
