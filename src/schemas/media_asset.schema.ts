import { Schema, model, type HydratedDocument, Types } from 'mongoose';

export type MediaAssetScope = 'public' | 'private';
export type MediaAssetType = 'video' | 'audio' | 'image' | 'gif';
export type MediaAssetMarketplaceStatus = 'not_listed' | 'published' | 'pending_review' | 'hidden' | 'removed';

export interface IMediaAsset {
    _id: Types.ObjectId;
    legacyTriggerFileID?: Types.ObjectId | null;
    ownerUserID: string;
    ownerChannelID: string;
    ownerChannelName: string;
    uploadedByUserID: string;
    originalName: string;
    displayName: string;
    fileName: string;
    extension: string;
    mimeType: string;
    mediaType: MediaAssetType;
    bytes: number;
    bucket: string;
    s3Key: string;
    storageUrl: string;
    proxyPath: string | null;
    scope: MediaAssetScope;
    marketplaceStatus: MediaAssetMarketplaceStatus;
    checksumSha256?: string | null;
    libraryCount: number;
    triggerReferenceCount: number;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

const mediaAssetSchema = new Schema<IMediaAsset>({
    legacyTriggerFileID: { type: Schema.Types.ObjectId, default: null, index: true },
    ownerUserID: { type: String, required: true, index: true },
    ownerChannelID: { type: String, required: true, index: true },
    ownerChannelName: { type: String, required: true },
    uploadedByUserID: { type: String, required: true },
    originalName: { type: String, required: true },
    displayName: { type: String, required: true },
    fileName: { type: String, required: true },
    extension: { type: String, required: true },
    mimeType: { type: String, required: true },
    mediaType: { type: String, required: true, enum: ['video', 'audio', 'image', 'gif'], index: true },
    bytes: { type: Number, required: true },
    bucket: { type: String, required: true },
    s3Key: { type: String, required: true, unique: true },
    storageUrl: { type: String, required: true },
    proxyPath: { type: String, default: null },
    scope: { type: String, required: true, enum: ['public', 'private'], index: true },
    marketplaceStatus: {
        type: String,
        required: true,
        enum: ['not_listed', 'published', 'pending_review', 'hidden', 'removed'],
        default: 'not_listed',
        index: true
    },
    checksumSha256: { type: String, default: null },
    libraryCount: { type: Number, default: 0 },
    triggerReferenceCount: { type: Number, default: 0 },
    deletedAt: { type: Date, default: null, index: true }
}, {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

mediaAssetSchema.index({ scope: 1, marketplaceStatus: 1, mediaType: 1, createdAt: -1 });

export type MediaAssetDocument = HydratedDocument<IMediaAsset>;

export const MediaAssetSchema = model<IMediaAsset>('MediaAsset', mediaAssetSchema);
