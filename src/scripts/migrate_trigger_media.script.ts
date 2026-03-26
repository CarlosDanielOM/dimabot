import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { Types } from 'mongoose';
import { getMongoDBConnection } from '../utils/databases/mongodb.database.js';
import UsersSchema from '../schemas/users.schema.js';
import { TriggerFileSchema } from '../schemas/trigger_file.schema.js';
import { TriggerSchema } from '../schemas/trigger.schema.js';
import { MediaAssetSchema } from '../schemas/media_asset.schema.js';
import { UserMediaLibraryItemSchema } from '../schemas/user_media_library_item.schema.js';
import {
    buildMediaS3Key,
    getInitialMarketplaceStatus,
    inferMediaTypeFromMimeType
} from '../server/services/media_library.service.js';

const isDev = process.env.NODE_ENV !== 'production';
if (isDev) {
    dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
}
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const INVALID_LEGACY_PREFIX = 'https://api.domdimabot.com/media/';

interface MigrationReport {
    generatedAt: string;
    totals: {
        triggerFiles: number;
        validCandidates: number;
        invalidLegacyUrls: number;
        unresolvedOwners: number;
        alreadyMigrated: number;
        migratedAssets?: number;
        migratedLibraryItems?: number;
        updatedTriggers?: number;
    };
    invalidLegacyFiles: Array<{
        triggerFileID: string;
        channelID: string;
        name: string;
        fileUrl: string;
    }>;
    unresolvedOwners: Array<{
        triggerFileID: string;
        channelID: string;
        name: string;
    }>;
}

function getArgValue(flag: string): string | null {
    const index = process.argv.indexOf(flag);
    if (index === -1) {
        return null;
    }

    return process.argv[index + 1] || null;
}

function getReportPath(): string {
    const explicit = getArgValue('--report');
    if (explicit) {
        return path.resolve(process.cwd(), explicit);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.resolve(process.cwd(), '.opencode', 'reports', `trigger-media-migration-${timestamp}.json`);
}

function isInvalidLegacyUrl(fileUrl: string): boolean {
    return fileUrl.startsWith(INVALID_LEGACY_PREFIX);
}

function extractS3Key(fileUrl: string, channelID: string, fileName: string, mediaType: 'video' | 'audio' | 'image' | 'gif'): string | null {
    if (isInvalidLegacyUrl(fileUrl)) {
        return null;
    }

    try {
        const parsed = new URL(fileUrl);
        const pathname = parsed.pathname.replace(/^\/+/, '');
        if (pathname.length > 0) {
            return pathname;
        }
    } catch {
        // fall through to legacy path reconstruction
    }

    return buildMediaS3Key('private', mediaType, channelID, fileName.replace(/\s+/g, '_'));
}

async function run(): Promise<void> {
    const execute = process.argv.includes('--execute');
    await getMongoDBConnection('migrate_trigger_media');

    const reportPath = getReportPath();
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });

    const triggerFiles = await TriggerFileSchema.find({}).lean();
    const alreadyMigrated = await MediaAssetSchema.countDocuments({ legacyTriggerFileID: { $ne: null } });

    const channelIDs = Array.from(new Set(triggerFiles.map((file) => file.channelID).filter(Boolean)));
    const ownerUsers = await UsersSchema.find({
        'accounts.type': 'twitch',
        'accounts.id': { $in: channelIDs }
    }).select('_id accounts').lean();

    const ownerUserIdByChannelId = new Map<string, string>();
    for (const user of ownerUsers) {
        const twitchAccount = user.accounts.find((account) => account.type === 'twitch');
        if (twitchAccount?.id) {
            ownerUserIdByChannelId.set(twitchAccount.id, String(user._id));
        }
    }

    const invalidLegacyFiles: MigrationReport['invalidLegacyFiles'] = [];
    const unresolvedOwners: MigrationReport['unresolvedOwners'] = [];
    const candidates: Array<typeof triggerFiles[number] & {
        ownerUserID: string;
        mediaType: 'video' | 'audio' | 'image' | 'gif';
        s3Key: string;
    }> = [];

    for (const file of triggerFiles) {
        const existingAsset = await MediaAssetSchema.findOne({ legacyTriggerFileID: file._id }).select('_id').lean();
        if (existingAsset) {
            continue;
        }

        if (isInvalidLegacyUrl(file.fileUrl)) {
            invalidLegacyFiles.push({
                triggerFileID: String(file._id),
                channelID: file.channelID,
                name: file.name,
                fileUrl: file.fileUrl
            });
            continue;
        }

        const ownerUserID = ownerUserIdByChannelId.get(file.channelID);
        if (!ownerUserID) {
            unresolvedOwners.push({
                triggerFileID: String(file._id),
                channelID: file.channelID,
                name: file.name
            });
            continue;
        }

        const mediaType = inferMediaTypeFromMimeType(file.fileType);
        if (!mediaType) {
            invalidLegacyFiles.push({
                triggerFileID: String(file._id),
                channelID: file.channelID,
                name: file.name,
                fileUrl: file.fileUrl
            });
            continue;
        }

        const s3Key = extractS3Key(file.fileUrl, file.channelID, file.fileName, mediaType);
        if (!s3Key) {
            invalidLegacyFiles.push({
                triggerFileID: String(file._id),
                channelID: file.channelID,
                name: file.name,
                fileUrl: file.fileUrl
            });
            continue;
        }

        candidates.push({
            ...file,
            ownerUserID,
            mediaType,
            s3Key
        });
    }

    const report: MigrationReport = {
        generatedAt: new Date().toISOString(),
        totals: {
            triggerFiles: triggerFiles.length,
            validCandidates: candidates.length,
            invalidLegacyUrls: invalidLegacyFiles.length,
            unresolvedOwners: unresolvedOwners.length,
            alreadyMigrated
        },
        invalidLegacyFiles,
        unresolvedOwners
    };

    if (!execute) {
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log('[migration] dry-run complete');
        console.log('[migration] report written to:', reportPath);
        console.log('[migration] summary:', report.totals);
        console.log('[migration] invalid legacy trigger files are reported only; nothing was deleted.');
        return;
    }

    let migratedAssets = 0;
    let migratedLibraryItems = 0;
    let updatedTriggers = 0;

    for (const file of candidates) {
        let asset = await MediaAssetSchema.findOne({ legacyTriggerFileID: file._id });

        if (!asset) {
            asset = await MediaAssetSchema.create({
                legacyTriggerFileID: file._id,
                ownerUserID: file.ownerUserID,
                ownerChannelID: file.channelID,
                ownerChannelName: file.channel,
                uploadedByUserID: file.ownerUserID,
                originalName: file.fileName,
                displayName: file.name,
                fileName: file.fileName,
                extension: path.extname(file.fileName).replace(/^\./, '').toLowerCase() || file.fileType.split('/')[1] || 'bin',
                mimeType: file.fileType,
                mediaType: file.mediaType,
                bytes: file.fileSize,
                bucket: process.env.S3_BUCKET || '',
                s3Key: file.s3Key,
                storageUrl: file.fileUrl,
                proxyPath: null,
                scope: 'private',
                marketplaceStatus: getInitialMarketplaceStatus('private'),
                checksumSha256: null,
                libraryCount: 1,
                triggerReferenceCount: 0,
                deletedAt: null
            });
            migratedAssets += 1;
        }

        let libraryItem = await UserMediaLibraryItemSchema.findOne({
            channelID: file.channelID,
            assetID: asset._id,
            isActive: true,
            deletedAt: null
        });

        if (!libraryItem) {
            libraryItem = await UserMediaLibraryItemSchema.create({
                channelID: file.channelID,
                channelName: file.channel,
                addedByUserID: file.ownerUserID,
                assetID: asset._id,
                relationType: 'owner_upload',
                localAlias: null,
                quotaBytesCharged: file.fileSize,
                assetScope: 'private',
                mediaType: file.mediaType,
                isActive: true,
                deletedAt: null
            });
            migratedLibraryItems += 1;
        }

        const triggerUpdateResult = await TriggerSchema.updateMany({
            channelID: file.channelID,
            $or: [
                { fileID: file._id },
                {
                    file: file.name,
                    mediaType: file.fileType
                }
            ]
        }, {
            $set: {
                assetID: asset._id,
                libraryItemID: libraryItem._id
            }
        });

        updatedTriggers += triggerUpdateResult.modifiedCount ?? 0;

        const triggerReferenceCount = await TriggerSchema.countDocuments({ assetID: asset._id });
        await MediaAssetSchema.updateOne({ _id: asset._id }, {
            $set: {
                libraryCount: 1,
                triggerReferenceCount
            }
        });
    }

    report.totals.migratedAssets = migratedAssets;
    report.totals.migratedLibraryItems = migratedLibraryItems;
    report.totals.updatedTriggers = updatedTriggers;
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log('[migration] execute complete');
    console.log('[migration] report written to:', reportPath);
    console.log('[migration] summary:', report.totals);
    console.log('[migration] invalid legacy trigger files were not deleted.');
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('[migration] failed', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        });
        process.exit(1);
    });
