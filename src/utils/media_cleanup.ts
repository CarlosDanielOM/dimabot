import { MediaAssetSchema } from '../schemas/media_asset.schema.js';
import { UserMediaLibraryItemSchema } from '../schemas/user_media_library_item.schema.js';
import { TriggerSchema } from '../schemas/trigger.schema.js';
import { deleteTriggerFileFromS3 } from './s3.js';
import {
    DOMDIMABOT_SITE_OWNER_CHANNEL_ID,
    DOMDIMABOT_SITE_OWNER_CHANNEL_NAME,
    DOMDIMABOT_SITE_OWNER_USER_ID
} from '../server/services/media_library.service.js';

export interface CleanupChannelMediaOptions {
    channelID: string;
    userID: string;
}

export interface CleanupChannelMediaResult {
    libraryItemsRemoved: number;
    privateAssetsDeleted: number;
    publicAssetsTransferred: number;
    assetCountsUpdated: number;
}

export async function cleanupChannelMediaOwnership(options: CleanupChannelMediaOptions): Promise<CleanupChannelMediaResult> {
    const { channelID, userID } = options;

    const libraryItems = await UserMediaLibraryItemSchema.find({
        channelID,
        isActive: true,
        deletedAt: null
    });

    if (libraryItems.length === 0) {
        return {
            libraryItemsRemoved: 0,
            privateAssetsDeleted: 0,
            publicAssetsTransferred: 0,
            assetCountsUpdated: 0
        };
    }

    const now = new Date();
    const assetIds = Array.from(new Set(libraryItems.map((item) => String(item.assetID))));
    const assets = await MediaAssetSchema.find({
        _id: { $in: assetIds },
        deletedAt: null
    });
    const assetMap = new Map(assets.map((asset) => [String(asset._id), asset]));

    let libraryItemsRemoved = 0;
    let privateAssetsDeleted = 0;
    let publicAssetsTransferred = 0;
    let assetCountsUpdated = 0;

    for (const libraryItem of libraryItems) {
        libraryItem.isActive = false;
        libraryItem.deletedAt = now;
        await libraryItem.save();
        libraryItemsRemoved += 1;
    }

    for (const assetId of assetIds) {
        const asset = assetMap.get(assetId);
        if (!asset) {
            continue;
        }

        const remainingLibraryCount = await UserMediaLibraryItemSchema.countDocuments({
            assetID: asset._id,
            isActive: true,
            deletedAt: null
        });
        const triggerReferenceCount = await TriggerSchema.countDocuments({
            assetID: asset._id
        });

        if (asset.scope === 'private') {
            if (remainingLibraryCount === 0 && triggerReferenceCount === 0) {
                await deleteTriggerFileFromS3(asset.ownerChannelID, asset.s3Key);
                await MediaAssetSchema.deleteOne({ _id: asset._id });
                privateAssetsDeleted += 1;
                continue;
            }

            await MediaAssetSchema.updateOne({ _id: asset._id }, {
                $set: {
                    libraryCount: remainingLibraryCount,
                    triggerReferenceCount
                }
            });
            assetCountsUpdated += 1;
            continue;
        }

        const shouldTransferOwnership = asset.ownerUserID === userID || asset.ownerChannelID === channelID;
        await MediaAssetSchema.updateOne({ _id: asset._id }, {
            $set: {
                ownerUserID: shouldTransferOwnership ? DOMDIMABOT_SITE_OWNER_USER_ID : asset.ownerUserID,
                ownerChannelID: shouldTransferOwnership ? DOMDIMABOT_SITE_OWNER_CHANNEL_ID : asset.ownerChannelID,
                ownerChannelName: shouldTransferOwnership ? DOMDIMABOT_SITE_OWNER_CHANNEL_NAME : asset.ownerChannelName,
                libraryCount: remainingLibraryCount,
                triggerReferenceCount
            }
        });

        if (shouldTransferOwnership) {
            publicAssetsTransferred += 1;
        }

        assetCountsUpdated += 1;
    }

    return {
        libraryItemsRemoved,
        privateAssetsDeleted,
        publicAssetsTransferred,
        assetCountsUpdated
    };
}
