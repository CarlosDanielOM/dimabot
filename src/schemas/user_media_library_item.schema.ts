import { Schema, model, type HydratedDocument, Types } from 'mongoose';

export type UserMediaLibraryRelationType = 'owner_upload' | 'public_library_add';

export interface IUserMediaLibraryItem {
    _id: Types.ObjectId;
    channelID: string;
    channelName: string;
    addedByUserID: string;
    assetID: Types.ObjectId;
    relationType: UserMediaLibraryRelationType;
    localAlias: string | null;
    quotaBytesCharged: number;
    assetScope: 'public' | 'private';
    mediaType: 'video' | 'audio' | 'image' | 'gif';
    isActive: boolean;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

const userMediaLibraryItemSchema = new Schema<IUserMediaLibraryItem>({
    channelID: { type: String, required: true, index: true },
    channelName: { type: String, required: true },
    addedByUserID: { type: String, required: true },
    assetID: { type: Schema.Types.ObjectId, ref: 'MediaAsset', required: true, index: true },
    relationType: { type: String, required: true, enum: ['owner_upload', 'public_library_add'] },
    localAlias: { type: String, default: null },
    quotaBytesCharged: { type: Number, required: true },
    assetScope: { type: String, required: true, enum: ['public', 'private'], index: true },
    mediaType: { type: String, required: true, enum: ['video', 'audio', 'image', 'gif'], index: true },
    isActive: { type: Boolean, default: true, index: true },
    deletedAt: { type: Date, default: null, index: true }
}, {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

userMediaLibraryItemSchema.index(
    { channelID: 1, assetID: 1, isActive: 1 },
    {
        unique: true,
        partialFilterExpression: {
            isActive: true
        }
    }
);

export type UserMediaLibraryItemDocument = HydratedDocument<IUserMediaLibraryItem>;

export const UserMediaLibraryItemSchema = model<IUserMediaLibraryItem>('UserMediaLibraryItem', userMediaLibraryItemSchema);
