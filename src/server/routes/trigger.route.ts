import express, { type Request, type Response } from 'express';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import multer from 'multer';
import os from 'os';
import path from 'path';
import UsersSchema from '../../schemas/users.schema.js';
import { TriggerSchema, type ITrigger } from '../../schemas/trigger.schema.js';
import { RedemptionRewardSchema } from '../../schemas/redemption_reward.schema.js';
import { MediaAssetSchema, type IMediaAsset } from '../../schemas/media_asset.schema.js';
import { UserMediaLibraryItemSchema, type IUserMediaLibraryItem } from '../../schemas/user_media_library_item.schema.js';
import TwitchStreamers from '../../classes/twitch_streamers.class.js';
import { uploadTriggerFileToS3, deleteTriggerFileFromS3 } from '../../utils/s3.js';
import { getUrl } from '../../utils/dev.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { getIO } from '../../server/websocket.js';
import { error } from '../../utils/logger.js';
import { cleanupRewardArtifacts, createRewardWithEventsub, patchTwitchReward } from '../services/reward_creation.service.js';
import {
    buildMediaS3Key,
    buildMediaPlaybackUrl,
    buildStoredMediaFileName,
    getChannelQuotaUsageBytes,
    getDefaultMediaScope,
    getFileExtension,
    getInitialMarketplaceStatus,
    getPlanStorageQuotaBytes,
    getPlanUploadLimitBytes,
    hasTriggerPermission,
    inferMediaTypeFromMimeType,
    isValidMediaDisplayName,
    normalizePlanTier
} from '../services/media_library.service.js';

interface TriggerRequest extends Request {
    user?: {
        id?: string;
        login?: string;
        display_name?: string;
        profile_image_url?: string;
    };
}

interface MulterRequest extends TriggerRequest {
    file?: Express.Multer.File;
    body: {
        name?: string;
        scope?: 'public' | 'private';
        localAlias?: string;
        libraryItemID?: string;
        triggerName?: string;
        [key: string]: unknown;
    };
}

interface TriggerRewardInput {
    create?: boolean;
    title?: string;
    prompt?: string;
    cost?: number;
    message?: string;
    cooldown?: number;
    userInput?: boolean;
    skipQueue?: boolean;
    isEnabled?: boolean;
    costChange?: number;
    returnToOriginalCost?: boolean;
    duration?: number;
    backgroundColor?: string;
    type?: string;
    createdFrom?: string;
    createdFor?: string;
}

const TRIGGER_NAME_REGEX = /^[A-Za-z0-9_]+$/;

const router = express.Router();
const uploadTempDir = path.join(os.tmpdir(), 'dimabot-trigger-uploads');

fs.mkdirSync(uploadTempDir, { recursive: true });

const acceptableMimeTypes = [
    'video/mp4', 'video/mov', 'video/avi', 'video/flv', 'video/wmv', 'video/webm', 'video/mkv',
    'image/gif', 'image/jpg', 'image/jpeg', 'image/png', 'image/bmp', 'image/tiff', 'image/svg', 'image/webp',
    'audio/mp3', 'audio/flac', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/wma', 'audio/m4a'
];

function mapLibraryItemResponse(libraryItem: IUserMediaLibraryItem, asset: IMediaAsset | null): Record<string, unknown> {
    return {
        _id: libraryItem._id,
        assetID: libraryItem.assetID,
        relationType: libraryItem.relationType,
        localAlias: libraryItem.localAlias,
        quotaBytesCharged: libraryItem.quotaBytesCharged,
        assetScope: libraryItem.assetScope,
        mediaType: libraryItem.mediaType,
        isActive: libraryItem.isActive,
        createdAt: libraryItem.createdAt,
        updatedAt: libraryItem.updatedAt,
        asset: asset ? {
            _id: asset._id,
            ownerChannelID: asset.ownerChannelID,
            ownerChannelName: asset.ownerChannelName,
            displayName: asset.displayName,
            fileName: asset.fileName,
            extension: asset.extension,
            mimeType: asset.mimeType,
            mediaType: asset.mediaType,
            bytes: asset.bytes,
            storageUrl: asset.storageUrl,
            playbackUrl: buildMediaPlaybackUrl(asset._id),
            proxyPath: asset.proxyPath,
            scope: asset.scope,
            marketplaceStatus: asset.marketplaceStatus,
            createdAt: asset.createdAt,
            updatedAt: asset.updatedAt
        } : null
    };
}

async function ensureTriggerPermission(
    req: TriggerRequest,
    res: Response,
    channelID: string,
    requiredPermissions: string[]
): Promise<boolean> {
    const requesterID = req.user?.id;
    if (!requesterID) {
        res.status(401).json({
            error: true,
            message: 'Unauthorized',
            status: 401
        });
        return false;
    }

    const allowed = await hasTriggerPermission(requesterID, channelID, requiredPermissions);
    if (!allowed) {
        res.status(403).json({
            error: true,
            message: 'You do not have permission to access triggers for this channel',
            status: 403
        });
        return false;
    }

    return true;
}

async function getMediaAssetMap(assetIds: Array<string>): Promise<Map<string, IMediaAsset>> {
    const uniqueAssetIds = Array.from(new Set(assetIds.filter(Boolean)));
    if (uniqueAssetIds.length === 0) {
        return new Map();
    }

    const assets = await MediaAssetSchema.find({
        _id: { $in: uniqueAssetIds },
        deletedAt: null
    }).lean();

    return new Map(assets.map((asset) => [String(asset._id), asset]));
}

async function getAppUserIdByTwitchAccountID(twitchAccountID: string): Promise<string | null> {
    const user = await UsersSchema.findOne({
        'accounts.id': twitchAccountID,
        'accounts.type': 'twitch'
    }).select('_id').lean();

    return user?._id ? String(user._id) : null;
}

function legacyTriggerFileResponse(res: Response): Response {
    return res.status(410).json({
        error: true,
        message: 'Legacy trigger file endpoints are disabled. Use the media library endpoints instead.',
        status: 410
    });
}

function buildTriggerSendCommand(triggerName: string, queueFlag?: boolean): string {
    const normalizedName = triggerName.trim();
    return `$(trigger.send ${normalizedName}${queueFlag ? ' true' : ''})`;
}

function isValidTriggerName(name: string): boolean {
    return TRIGGER_NAME_REGEX.test(name);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function updateLinkedRewardMessage(message: string, oldName: string, newName: string): string {
    if (!message?.trim() || !oldName.trim() || !newName.trim() || oldName === newName) {
        return message;
    }

    const pattern = new RegExp(`\\$\\(\\s*trigger\\.send\\s+${escapeRegExp(oldName.trim())}(?:\\s+(true|false))?\\s*\\)`, 'g');
    return message.replace(pattern, (_match, queueFlag) => buildTriggerSendCommand(newName.trim(), queueFlag === 'true'));
}

function normalizeTriggerRewardInput(rawReward: unknown, legacyBody: Record<string, any>, triggerName: string): TriggerRewardInput | null {
    const reward = rawReward && typeof rawReward === 'object' ? { ...(rawReward as Record<string, any>) } : null;

    if (reward) {
        return {
            create: reward.create !== false,
            title: typeof reward.title === 'string' && reward.title.trim() ? reward.title.trim() : triggerName,
            prompt: typeof reward.prompt === 'string' ? reward.prompt : '',
            cost: Number.isFinite(Number(reward.cost)) ? Number(reward.cost) : 0,
            message: typeof reward.message === 'string' && reward.message.trim() ? reward.message.trim() : buildTriggerSendCommand(triggerName),
            cooldown: Number.isFinite(Number(reward.cooldown)) ? Number(reward.cooldown) : 0,
            userInput: Boolean(reward.userInput),
            skipQueue: Boolean(reward.skipQueue),
            isEnabled: typeof reward.isEnabled === 'boolean' ? reward.isEnabled : true,
            costChange: Number.isFinite(Number(reward.costChange)) ? Number(reward.costChange) : 0,
            returnToOriginalCost: Boolean(reward.returnToOriginalCost),
            duration: Number.isFinite(Number(reward.duration)) ? Number(reward.duration) : 0,
            backgroundColor: typeof reward.backgroundColor === 'string' ? reward.backgroundColor : undefined,
            type: typeof reward.type === 'string' && reward.type.trim() ? reward.type.trim() : 'custom',
            createdFrom: typeof reward.createdFrom === 'string' && reward.createdFrom.trim() ? reward.createdFrom.trim() : 'domdimabot',
            createdFor: typeof reward.createdFor === 'string' && reward.createdFor.trim() ? reward.createdFor.trim() : 'twitch'
        };
    }

    if (legacyBody.createRedemption === true || legacyBody.createRedemption === undefined) {
        const hasLegacyRewardFields = legacyBody.cost !== undefined || legacyBody.prompt !== undefined || legacyBody.cooldown !== undefined;
        if (hasLegacyRewardFields) {
            return {
                create: true,
                title: triggerName,
                prompt: typeof legacyBody.prompt === 'string' ? legacyBody.prompt : '',
                cost: Number.isFinite(Number(legacyBody.cost)) ? Number(legacyBody.cost) : 0,
                message: buildTriggerSendCommand(triggerName),
                cooldown: Number.isFinite(Number(legacyBody.cooldown)) ? Number(legacyBody.cooldown) : 0,
                userInput: Boolean(legacyBody.userInput),
                skipQueue: Boolean(legacyBody.skipQueue),
                isEnabled: typeof legacyBody.isEnabled === 'boolean' ? legacyBody.isEnabled : true,
                costChange: Number.isFinite(Number(legacyBody.costChange)) ? Number(legacyBody.costChange) : 0,
                returnToOriginalCost: Boolean(legacyBody.returnToOriginalCost),
                duration: Number.isFinite(Number(legacyBody.duration)) ? Number(legacyBody.duration) : 0,
                backgroundColor: typeof legacyBody.backgroundColor === 'string' ? legacyBody.backgroundColor : undefined,
                type: 'custom',
                createdFrom: 'domdimabot',
                createdFor: 'twitch'
            };
        }
    }

    return null;
}

function buildRewardPayloadForPersistence(reward: TriggerRewardInput): Record<string, any> {
    return {
        title: reward.title,
        prompt: reward.prompt || '',
        cost: reward.cost || 0,
        message: reward.message || '',
        cooldown: reward.cooldown || 0,
        userInput: reward.userInput || false,
        skipQueue: reward.skipQueue || false,
        isEnabled: reward.isEnabled !== false,
        costChange: reward.costChange || 0,
        returnToOriginalCost: reward.returnToOriginalCost || false,
        duration: reward.duration || 0,
        backgroundColor: reward.backgroundColor,
        type: reward.type || 'custom',
        createdFrom: reward.createdFrom || 'domdimabot',
        createdFor: reward.createdFor || 'twitch'
    };
}

async function enrichTriggers(triggers: ITrigger[]): Promise<Array<ITrigger & { reward?: any | null }>> {
    const rewardIds = Array.from(new Set(triggers.map((trigger) => trigger.rewardID).filter((rewardID) => typeof rewardID === 'string' && rewardID.trim() !== '')));
    if (rewardIds.length === 0) {
        return triggers.map((trigger) => {
            const triggerDocument = trigger as any;
            const triggerObject = typeof triggerDocument.toObject === 'function' ? triggerDocument.toObject() : triggerDocument;
            return { ...triggerObject, reward: null };
        });
    }

    const rewards = await RedemptionRewardSchema.find({
        rewardID: { $in: rewardIds }
    }).lean();
    const rewardMap = new Map(rewards.map((reward) => [reward.rewardID, reward]));

    return triggers.map((trigger) => {
        const triggerDocument = trigger as any;
        const triggerObject = typeof triggerDocument.toObject === 'function' ? triggerDocument.toObject() : triggerDocument;
        return {
            ...triggerObject,
            reward: trigger.rewardID ? rewardMap.get(trigger.rewardID) || null : null
        };
    });
}

router.get('/assets/public', authMiddleware as any, async (req: TriggerRequest, res: Response) => {
    try {
        if (!req.user?.id) {
            return res.status(401).json({
                error: true,
                message: 'Unauthorized',
                status: 401
            });
        }

        const { id, q, mediaType, limit, skip } = req.query;
        const query: Record<string, unknown> = {
            scope: 'public',
            marketplaceStatus: 'published',
            deletedAt: null
        };

        if (id) {
            query._id = id;
        }

        if (typeof mediaType === 'string' && ['video', 'audio', 'image', 'gif'].includes(mediaType)) {
            query.mediaType = mediaType;
        }

        if (typeof q === 'string' && q.trim().length > 0) {
            query.$or = [
                { displayName: { $regex: q.trim(), $options: 'i' } },
                { ownerChannelName: { $regex: q.trim(), $options: 'i' } }
            ];
        }

        const safeLimit = Math.min(Math.max(Number.parseInt(String(limit || '24'), 10) || 24, 1), 100);
        const safeSkip = Math.max(Number.parseInt(String(skip || '0'), 10) || 0, 0);

        const assets = await MediaAssetSchema.find(query)
            .sort({ createdAt: -1 })
            .skip(safeSkip)
            .limit(safeLimit)
            .lean();

        return res.status(200).json({
            error: false,
            message: 'Public assets fetched successfully',
            status: 200,
            data: assets.map((asset) => ({
                ...asset,
                playbackUrl: buildMediaPlaybackUrl(asset._id)
            })),
            total: assets.length
        });
    } catch (err) {
        await error({
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            query: req.query,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

        return res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.get('/library/:channelID', authMiddleware as any, async (req: TriggerRequest, res: Response) => {
    try {
        const { channelID } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;

        if (!await ensureTriggerPermission(req, res, channelIdStr, ['triggers:view'])) {
            return;
        }

        const streamer = await TwitchStreamers.getTwitchAccountById(channelIdStr);
        if (!streamer) {
            return res.status(404).json({
                error: true,
                message: 'Streamer not found',
                status: 404
            });
        }

        const { id, assetID, scope, mediaType } = req.query;
        const query: Record<string, unknown> = {
            channelID: channelIdStr,
            isActive: true,
            deletedAt: null
        };

        if (id) {
            query._id = id;
        }

        if (assetID) {
            query.assetID = assetID;
        }

        if (typeof scope === 'string' && (scope === 'public' || scope === 'private')) {
            query.assetScope = scope;
        }

        if (typeof mediaType === 'string' && ['video', 'audio', 'image', 'gif'].includes(mediaType)) {
            query.mediaType = mediaType;
        }

        const libraryItems = await UserMediaLibraryItemSchema.find(query)
            .sort({ createdAt: -1 })
            .lean();
        const assetMap = await getMediaAssetMap(libraryItems.map((item) => String(item.assetID)));
        const planTier = normalizePlanTier(streamer.plan_tier);
        const quotaBytesUsed = await getChannelQuotaUsageBytes(channelIdStr);

        return res.status(200).json({
            error: false,
            message: 'Media library fetched successfully',
            status: 200,
            data: libraryItems.map((item) => mapLibraryItemResponse(item, assetMap.get(String(item.assetID)) || null)),
            total: libraryItems.length,
            meta: {
                planTier,
                quotaBytesUsed,
                quotaBytesLimit: getPlanStorageQuotaBytes(planTier)
            }
        });
    } catch (err) {
        await error({
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            channelID: req.params.channelID,
            query: req.query,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

        return res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.post('/library/:channelID/upload', authMiddleware as any, async (req: MulterRequest, res: Response) => {
    const { channelID } = req.params;
    const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;

    if (!await ensureTriggerPermission(req, res, channelIdStr, ['triggers:upload'])) {
        return;
    }

    const streamer = await TwitchStreamers.getTwitchAccountById(channelIdStr);
    if (!streamer) {
        return res.status(404).json({
            error: true,
            message: 'Streamer not found',
            status: 404
        });
    }

    const ownerUserID = await getAppUserIdByTwitchAccountID(channelIdStr);
    const actorUserID = req.user?.id ? await getAppUserIdByTwitchAccountID(req.user.id) : null;
    if (!ownerUserID) {
        return res.status(404).json({
            error: true,
            message: 'Owner user not found',
            status: 404
        });
    }

    const planTier = normalizePlanTier(streamer.plan_tier);
    const upload = multer({
        storage: multer.diskStorage({
            destination: (_request, _file, callback) => callback(null, uploadTempDir),
            filename: (_request, file, callback) => {
                const extension = path.extname(file.originalname || '').toLowerCase();
                callback(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`);
            }
        }),
        fileFilter: (_request, file, callback) => {
            callback(null, acceptableMimeTypes.includes(file.mimetype));
        },
        limits: {
            fileSize: getPlanUploadLimitBytes(planTier)
        }
    }).single('trigger');

    upload(req as any, res as any, async (uploadError: unknown) => {
        const tempFilePath = req.file?.path;

        try {
            if (uploadError) {
                await error({
                    error: 'Bad Request',
                    message: 'Error uploading file',
                    status: 400,
                    channelID: channelIdStr,
                    multerError: uploadError instanceof Error ? uploadError.message : String(uploadError)
                }, { channelId: channelIdStr, destination: 'both' });

                return res.status(400).json({
                    error: true,
                    message: 'Error uploading file',
                    status: 400
                });
            }

            if (!req.file) {
                return res.status(400).json({
                    error: true,
                    message: 'No file uploaded or file type not allowed',
                    status: 400
                });
            }

            const displayName = typeof req.body.name === 'string'
                ? req.body.name.trim()
                : typeof req.body.triggerName === 'string'
                    ? req.body.triggerName.trim()
                    : '';

            if (!displayName || !isValidMediaDisplayName(displayName)) {
                return res.status(400).json({
                    error: true,
                    message: 'Filename can only contain letters, numbers, and underscores',
                    status: 400
                });
            }

            const mediaType = inferMediaTypeFromMimeType(req.file.mimetype);
            if (!mediaType) {
                return res.status(400).json({
                    error: true,
                    message: 'Unsupported media type',
                    status: 400
                });
            }

            const quotaBytesUsed = await getChannelQuotaUsageBytes(channelIdStr);
            const quotaBytesLimit = getPlanStorageQuotaBytes(planTier);
            if (quotaBytesUsed + req.file.size > quotaBytesLimit) {
                return res.status(400).json({
                    error: true,
                    message: 'Storage quota exceeded',
                    status: 400,
                    data: {
                        quotaBytesUsed,
                        quotaBytesLimit,
                        attemptedBytes: req.file.size
                    }
                });
            }

            const scope = getDefaultMediaScope(planTier, req.body.scope);
            const extension = getFileExtension(req.file.originalname || req.file.filename, req.file.mimetype);
            const storedFileName = buildStoredMediaFileName(displayName, extension);
            const s3Key = buildMediaS3Key(scope, mediaType, channelIdStr, storedFileName);
            const storageUrl = await uploadTriggerFileToS3(channelIdStr, fs.createReadStream(req.file.path), req.file.mimetype, s3Key);

            const asset = await MediaAssetSchema.create({
                legacyTriggerFileID: null,
                ownerUserID,
                ownerChannelID: channelIdStr,
                ownerChannelName: streamer.name,
                uploadedByUserID: actorUserID || ownerUserID,
                originalName: req.file.originalname || storedFileName,
                displayName,
                fileName: storedFileName,
                extension,
                mimeType: req.file.mimetype,
                mediaType,
                bytes: req.file.size,
                bucket: process.env.S3_BUCKET || '',
                s3Key,
                storageUrl,
                proxyPath: null,
                scope,
                marketplaceStatus: getInitialMarketplaceStatus(scope),
                checksumSha256: null,
                libraryCount: 1,
                triggerReferenceCount: 0,
                deletedAt: null
            });

            const libraryItem = await UserMediaLibraryItemSchema.create({
                channelID: channelIdStr,
                channelName: streamer.name,
                addedByUserID: actorUserID || ownerUserID,
                assetID: asset._id,
                relationType: 'owner_upload',
                localAlias: null,
                quotaBytesCharged: req.file.size,
                assetScope: scope,
                mediaType,
                isActive: true,
                deletedAt: null
            });

            const updatedQuotaBytesUsed = quotaBytesUsed + req.file.size;

            return res.status(201).json({
                error: false,
                message: 'Media uploaded successfully',
                status: 201,
                data: mapLibraryItemResponse(libraryItem.toObject(), asset.toObject()),
                meta: {
                    planTier,
                    quotaBytesUsed: updatedQuotaBytesUsed,
                    quotaBytesLimit
                }
            });
        } catch (err) {
            await error({
                error: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined,
                channelID: channelIdStr,
                body: req.body,
                timestamp: new Date().toISOString()
            }, { channelId: channelIdStr, destination: 'both' });

            return res.status(500).json({
                error: true,
                message: 'Internal server error',
                status: 500
            });
        } finally {
            if (tempFilePath) {
                await fsPromises.unlink(tempFilePath).catch(() => undefined);
            }
        }
    });
});

router.post('/library/:channelID/add-public/:assetID', authMiddleware as any, async (req: TriggerRequest, res: Response) => {
    try {
        const { channelID, assetID } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
        const assetIdStr = Array.isArray(assetID) ? assetID[0] : assetID;

        if (!await ensureTriggerPermission(req, res, channelIdStr, ['triggers:attach'])) {
            return;
        }

        const streamer = await TwitchStreamers.getTwitchAccountById(channelIdStr);
        if (!streamer) {
            return res.status(404).json({
                error: true,
                message: 'Streamer not found',
                status: 404
            });
        }

        const ownerUserID = await getAppUserIdByTwitchAccountID(channelIdStr);
        const actorUserID = req.user?.id ? await getAppUserIdByTwitchAccountID(req.user.id) : null;
        if (!ownerUserID) {
            return res.status(404).json({
                error: true,
                message: 'Owner user not found',
                status: 404
            });
        }

        const asset = await MediaAssetSchema.findOne({
            _id: assetIdStr,
            scope: 'public',
            marketplaceStatus: 'published',
            deletedAt: null
        });
        if (!asset) {
            return res.status(404).json({
                error: true,
                message: 'Public asset not found',
                status: 404
            });
        }

        const existingLibraryItem = await UserMediaLibraryItemSchema.findOne({
            channelID: channelIdStr,
            assetID: asset._id,
            isActive: true,
            deletedAt: null
        });

        if (existingLibraryItem) {
            return res.status(200).json({
                error: false,
                message: 'Asset already exists in library',
                status: 200,
                data: mapLibraryItemResponse(existingLibraryItem.toObject(), asset.toObject())
            });
        }

        const planTier = normalizePlanTier(streamer.plan_tier);
        const quotaBytesUsed = await getChannelQuotaUsageBytes(channelIdStr);
        const quotaBytesLimit = getPlanStorageQuotaBytes(planTier);
        if (quotaBytesUsed + asset.bytes > quotaBytesLimit) {
            return res.status(400).json({
                error: true,
                message: 'Storage quota exceeded',
                status: 400,
                data: {
                    quotaBytesUsed,
                    quotaBytesLimit,
                    attemptedBytes: asset.bytes
                }
            });
        }

        const libraryItem = await UserMediaLibraryItemSchema.create({
            channelID: channelIdStr,
            channelName: streamer.name,
            addedByUserID: actorUserID || ownerUserID,
            assetID: asset._id,
            relationType: 'public_library_add',
            localAlias: null,
            quotaBytesCharged: asset.bytes,
            assetScope: 'public',
            mediaType: asset.mediaType,
            isActive: true,
            deletedAt: null
        });

        await MediaAssetSchema.updateOne({ _id: asset._id }, { $inc: { libraryCount: 1 } });

        return res.status(201).json({
            error: false,
            message: 'Public asset added to library',
            status: 201,
            data: mapLibraryItemResponse(libraryItem.toObject(), asset.toObject()),
            meta: {
                planTier,
                quotaBytesUsed: quotaBytesUsed + asset.bytes,
                quotaBytesLimit
            }
        });
    } catch (err) {
        await error({
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            channelID: req.params.channelID,
            assetID: req.params.assetID,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

        return res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.patch('/library/:channelID/:libraryItemID', authMiddleware as any, async (req: TriggerRequest, res: Response) => {
    try {
        const { channelID, libraryItemID } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
        const libraryItemIdStr = Array.isArray(libraryItemID) ? libraryItemID[0] : libraryItemID;

        if (!await ensureTriggerPermission(req, res, channelIdStr, ['triggers:edit'])) {
            return;
        }

        const libraryItem = await UserMediaLibraryItemSchema.findOne({
            _id: libraryItemIdStr,
            channelID: channelIdStr,
            isActive: true,
            deletedAt: null
        });
        if (!libraryItem) {
            return res.status(404).json({
                error: true,
                message: 'Library item not found',
                status: 404
            });
        }

        const nextAlias = typeof req.body.localAlias === 'string' ? req.body.localAlias.trim() : '';
        if (nextAlias && !isValidMediaDisplayName(nextAlias)) {
            return res.status(400).json({
                error: true,
                message: 'Alias can only contain letters, numbers, and underscores',
                status: 400
            });
        }

        libraryItem.localAlias = nextAlias || null;
        await libraryItem.save();

        const asset = await MediaAssetSchema.findById(libraryItem.assetID).lean();

        return res.status(200).json({
            error: false,
            message: 'Library item updated successfully',
            status: 200,
            data: mapLibraryItemResponse(libraryItem.toObject(), asset)
        });
    } catch (err) {
        await error({
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            channelID: req.params.channelID,
            libraryItemID: req.params.libraryItemID,
            body: req.body,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

        return res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.delete('/library/:channelID/:libraryItemID', authMiddleware as any, async (req: TriggerRequest, res: Response) => {
    try {
        const { channelID, libraryItemID } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
        const libraryItemIdStr = Array.isArray(libraryItemID) ? libraryItemID[0] : libraryItemID;

        if (!await ensureTriggerPermission(req, res, channelIdStr, ['triggers:delete'])) {
            return;
        }

        const libraryItem = await UserMediaLibraryItemSchema.findOne({
            _id: libraryItemIdStr,
            channelID: channelIdStr,
            isActive: true,
            deletedAt: null
        });
        if (!libraryItem) {
            return res.status(404).json({
                error: true,
                message: 'Library item not found',
                status: 404
            });
        }

        const asset = await MediaAssetSchema.findOne({
            _id: libraryItem.assetID,
            deletedAt: null
        });

        const isInUse = await TriggerSchema.exists({
            channelID: channelIdStr,
            $or: [
                { libraryItemID: libraryItem._id },
                { assetID: libraryItem.assetID }
            ]
        });

        if (isInUse) {
            return res.status(400).json({
                error: true,
                message: 'Media is in use by one or more triggers',
                status: 400
            });
        }

        libraryItem.isActive = false;
        libraryItem.deletedAt = new Date();
        await libraryItem.save();

        if (asset) {
            const remainingLibraryCount = await UserMediaLibraryItemSchema.countDocuments({
                assetID: asset._id,
                isActive: true,
                deletedAt: null
            });

            if (asset.scope === 'private' && remainingLibraryCount === 0) {
                await deleteTriggerFileFromS3(asset.ownerChannelID, asset.s3Key);
                await MediaAssetSchema.deleteOne({ _id: asset._id });
            } else {
                await MediaAssetSchema.updateOne({ _id: asset._id }, { $set: { libraryCount: remainingLibraryCount } });
            }
        }

        return res.status(200).json({
            error: false,
            message: 'Library item removed successfully',
            status: 200,
            data: mapLibraryItemResponse(libraryItem.toObject(), asset ? asset.toObject() : null)
        });
    } catch (err) {
        await error({
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            channelID: req.params.channelID,
            libraryItemID: req.params.libraryItemID,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

        return res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.get('/:channelID', authMiddleware as any, async (req: TriggerRequest, res: Response) => {
    try {
        const { channelID } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
        const { id, name } = req.query;

        if (!await ensureTriggerPermission(req, res, channelIdStr, ['triggers:view'])) {
            return;
        }

        let query: any = { channelID: channelIdStr };
        if (id) {
            query._id = id;
        } else if (name) {
            query.name = name;
        }

        const triggers = await TriggerSchema.find(query);
        const enrichedTriggers = await enrichTriggers(triggers);

        return res.status(200).json({
            data: enrichedTriggers,
            total: enrichedTriggers.length
        });
    } catch (err) {
        await error({
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            channelID: req.params.channelID,
            query: req.query,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

        res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.post('/:channelID', authMiddleware as any, async (req: TriggerRequest, res: Response) => {
    try {
        const { channelID } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
        const { name, volume, libraryItemID, reward } = req.body;
        const body = { ...req.body };

        if (!await ensureTriggerPermission(req, res, channelIdStr, ['triggers:attach'])) {
            return;
        }

        const streamer = await TwitchStreamers.getTwitchAccountById(channelIdStr);
        if (!streamer) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Streamer not found',
                status: 404
            });
        }

        let libraryItem: IUserMediaLibraryItem | null = null;
        let asset: IMediaAsset | null = null;
        if (typeof libraryItemID !== 'string' || libraryItemID.trim().length === 0) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'libraryItemID is required for triggers',
                status: 400
            });
        }

        libraryItem = await UserMediaLibraryItemSchema.findOne({
            _id: libraryItemID,
            channelID: channelIdStr,
            isActive: true,
            deletedAt: null
        });

        if (!libraryItem) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Library item not found',
                status: 400
            });
        }

        asset = await MediaAssetSchema.findOne({
            _id: libraryItem.assetID,
            deletedAt: null
        });

        if (!asset) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Media asset not found',
                status: 400
            });
        }

        const triggerName = typeof name === 'string' ? name.trim() : '';
        if (!triggerName) {
            return res.status(400).json({
                error: true,
                message: 'Trigger name is required',
                status: 400
            });
        }

        if (!isValidTriggerName(triggerName)) {
            return res.status(400).json({
                error: true,
                message: 'Trigger name can only contain letters, numbers, and underscores',
                status: 400
            });
        }

        const existingTrigger = await TriggerSchema.findOne({ channelID: channelIdStr, name: triggerName }).lean();
        if (existingTrigger) {
            return res.status(409).json({
                error: true,
                message: 'A trigger with that name already exists',
                status: 409
            });
        }

        const resolvedFileName = libraryItem.localAlias?.trim() || asset.displayName;
        const resolvedMediaType = asset.mimeType;
        const triggerVolume = Number.isFinite(Number(volume)) ? Number(volume) : 100;
        const rewardInput = normalizeTriggerRewardInput(reward, body, triggerName);
        const shouldCreateReward = Boolean(rewardInput?.create);

        let rewardData: any = null;

        if (shouldCreateReward && rewardInput) {
            const correlationId = `trigger-route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const result = await createRewardWithEventsub({
                channelID: channelIdStr,
                body: buildRewardPayloadForPersistence(rewardInput),
                correlationId
            });

            if (result.error || !result.data) {
                await error({
                    error: 'Bad Request',
                    message: 'Error creating trigger',
                    status: result.status,
                    response: result
                }, { channelId: channelIdStr, destination: 'both' });
                return res.status(result.status).json({
                    error: true,
                    message: result.message,
                    status: result.status
                });
            }

            rewardData = result.data;

            if (!rewardData.rewardID || !rewardData.eventsubID) {
                if (rewardData.rewardID) {
                    await cleanupRewardArtifacts(channelIdStr, rewardData.rewardID, rewardData.eventsubID, correlationId);
                }

                await error({
                    error: 'Internal Server Error',
                    message: 'Reward created with invalid state',
                    status: 500,
                    rewardData: {
                        rewardID: rewardData.rewardID,
                        eventsubID: rewardData.eventsubID
                    }
                }, { channelId: channelIdStr, destination: 'both' });

                return res.status(500).json({
                    error: true,
                    message: 'Failed to create trigger reward state',
                    status: 500
                });
            }
        }

        const newTrigger = new TriggerSchema({
            name: triggerName,
            channel: streamer.name,
            channelID: channelIdStr,
            rewardID: rewardData?.rewardID || '',
            file: resolvedFileName,
            type: 'trigger',
            mediaType: resolvedMediaType,
            isEnabled: typeof rewardData?.isEnabled === 'boolean' ? rewardData.isEnabled : true,
            cost: rewardInput?.cost || 0,
            cooldown: rewardInput?.cooldown || 0,
            prompt: rewardInput?.prompt || '',
            volume: triggerVolume,
            fileID: null,
            assetID: asset?._id || null,
            libraryItemID: libraryItem?._id || null
        });

        try {
            await newTrigger.save();
        } catch (saveError) {
            if (shouldCreateReward && rewardData?.rewardID) {
                await cleanupRewardArtifacts(channelIdStr, rewardData.rewardID, rewardData.eventsubID, `trigger-route-cleanup-${Date.now()}`);
            }

            await error({
                error: 'Internal Server Error',
                message: 'Error saving trigger',
                status: 500,
                saveError: saveError instanceof Error ? saveError.message : String(saveError)
            }, { channelId: channelIdStr, destination: 'both' });
            return res.status(500).json({
                error: 'Internal Server Error',
                message: 'Error saving trigger',
                status: 500
            });
        }

        if (asset) {
            const triggerReferenceCount = await TriggerSchema.countDocuments({ assetID: asset._id });
            await MediaAssetSchema.updateOne({ _id: asset._id }, { $set: { triggerReferenceCount } });
        }

        const createdTrigger = await TriggerSchema.findById(newTrigger._id);
        const enriched = createdTrigger ? await enrichTriggers([createdTrigger]) : [];

        return res.status(201).json({
            data: enriched[0] || newTrigger,
            status: 201
        });
    } catch (err) {
        await error({
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            channelID: req.params.channelID,
            body: req.body,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

        res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.patch('/:channelID/:triggerID', authMiddleware as any, async (req: TriggerRequest, res: Response) => {
    try {
        const { channelID, triggerID } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
        const triggerIdStr = Array.isArray(triggerID) ? triggerID[0] : triggerID;
        const { name, libraryItemID, volume, isEnabled, reward } = req.body;
        const body = { ...req.body };

        if (!await ensureTriggerPermission(req, res, channelIdStr, ['triggers:edit'])) {
            return;
        }

        const trigger = await TriggerSchema.findOne({ channelID: channelIdStr, _id: triggerIdStr });
        if (!trigger) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Trigger not found',
                status: 404
            });
        }

        const nextName = typeof name === 'string' && name.trim().length > 0 ? name.trim() : trigger.name;

        if (!isValidTriggerName(nextName)) {
            return res.status(400).json({
                error: true,
                message: 'Trigger name can only contain letters, numbers, and underscores',
                status: 400
            });
        }

        if (nextName !== trigger.name) {
            const duplicate = await TriggerSchema.findOne({
                channelID: channelIdStr,
                name: nextName,
                _id: { $ne: trigger._id }
            }).lean();

            if (duplicate) {
                return res.status(409).json({
                    error: true,
                    message: 'A trigger with that name already exists',
                    status: 409
                });
            }
        }

        let nextLibraryItemID = trigger.libraryItemID;
        let nextAssetID = trigger.assetID;
        let nextFile = trigger.file;
        let nextMediaType = trigger.mediaType;

        if (typeof libraryItemID === 'string' && libraryItemID.trim().length > 0 && String(trigger.libraryItemID || '') !== libraryItemID) {
            const nextLibraryItem = await UserMediaLibraryItemSchema.findOne({
                _id: libraryItemID,
                channelID: channelIdStr,
                isActive: true,
                deletedAt: null
            });

            if (!nextLibraryItem) {
                return res.status(400).json({
                    error: true,
                    message: 'Library item not found',
                    status: 400
                });
            }

            const nextAsset = await MediaAssetSchema.findOne({
                _id: nextLibraryItem.assetID,
                deletedAt: null
            });

            if (!nextAsset) {
                return res.status(400).json({
                    error: true,
                    message: 'Media asset not found',
                    status: 400
                });
            }

            nextLibraryItemID = nextLibraryItem._id;
            nextAssetID = nextAsset._id;
            nextFile = nextLibraryItem.localAlias?.trim() || nextAsset.displayName;
            nextMediaType = nextAsset.mimeType;
        }

        const rewardDoc = trigger.rewardID ? await RedemptionRewardSchema.findOne({ channelID: channelIdStr, rewardID: trigger.rewardID }) : null;
        const rewardInput = reward && typeof reward === 'object' ? reward as TriggerRewardInput : null;

        if (rewardInput?.create && !trigger.rewardID) {
            const createdRewardInput = normalizeTriggerRewardInput(rewardInput, body, nextName);
            if (createdRewardInput) {
                const createResult = await createRewardWithEventsub({
                    channelID: channelIdStr,
                    body: buildRewardPayloadForPersistence(createdRewardInput),
                    correlationId: `trigger-route-update-create-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
                });

                if (createResult.error || !createResult.data) {
                    return res.status(createResult.status).json({
                        error: true,
                        message: createResult.message,
                        status: createResult.status
                    });
                }

                trigger.rewardID = createResult.data.rewardID;
            }
        } else if (trigger.rewardID && rewardDoc) {
            const rewardPatchBody: Record<string, any> = {};
            if (rewardInput) {
                if (typeof rewardInput.title === 'string' && rewardInput.title.trim()) {
                    rewardPatchBody.title = rewardInput.title.trim();
                }
                if (typeof rewardInput.prompt === 'string') {
                    rewardPatchBody.prompt = rewardInput.prompt;
                }
                if (Number.isFinite(Number(rewardInput.cost))) {
                    rewardPatchBody.cost = Number(rewardInput.cost);
                }
                if (Number.isFinite(Number(rewardInput.cooldown))) {
                    rewardPatchBody.cooldown = Number(rewardInput.cooldown);
                }
                if (typeof rewardInput.userInput === 'boolean') {
                    rewardPatchBody.userInput = rewardInput.userInput;
                }
                if (typeof rewardInput.skipQueue === 'boolean') {
                    rewardPatchBody.skipQueue = rewardInput.skipQueue;
                }
                if (typeof rewardInput.isEnabled === 'boolean') {
                    rewardPatchBody.isEnabled = rewardInput.isEnabled;
                }
                if (Number.isFinite(Number(rewardInput.costChange))) {
                    rewardPatchBody.costChange = Number(rewardInput.costChange);
                }
                if (typeof rewardInput.returnToOriginalCost === 'boolean') {
                    rewardPatchBody.returnToOriginalCost = rewardInput.returnToOriginalCost;
                }
                if (Number.isFinite(Number(rewardInput.duration))) {
                    rewardPatchBody.duration = Number(rewardInput.duration);
                }
                if (typeof rewardInput.backgroundColor === 'string') {
                    rewardPatchBody.background_color = rewardInput.backgroundColor;
                    rewardPatchBody.backgroundColor = rewardInput.backgroundColor;
                }
                if (typeof rewardInput.message === 'string') {
                    rewardPatchBody.message = rewardInput.message;
                }
            }

            if (typeof isEnabled === 'boolean' && rewardPatchBody.isEnabled === undefined) {
                rewardPatchBody.isEnabled = isEnabled;
            }

            if (nextName !== trigger.name && rewardPatchBody.message === undefined) {
                rewardPatchBody.message = updateLinkedRewardMessage(rewardDoc.message || '', trigger.name, nextName);
            }

            if (Object.keys(rewardPatchBody).length > 0) {
                const result = await patchTwitchReward(channelIdStr, rewardPatchBody, trigger.rewardID);
                if (result.error) {
                    await error({
                        error: 'Bad Request',
                        message: 'Error updating trigger',
                        status: 400,
                        response: result
                    }, { channelId: channelIdStr, destination: 'both' });
                    return res.status(400).json({
                        error: true,
                        message: result.message || result.error || 'Error updating trigger reward',
                        status: 400
                    });
                }

                const rewardDbUpdate: Record<string, any> = {};
                if (rewardPatchBody.title !== undefined) rewardDbUpdate.title = rewardPatchBody.title;
                if (rewardPatchBody.prompt !== undefined) rewardDbUpdate.prompt = rewardPatchBody.prompt;
                if (rewardPatchBody.cost !== undefined) rewardDbUpdate.cost = rewardPatchBody.cost;
                if (rewardPatchBody.cooldown !== undefined) rewardDbUpdate.cooldown = rewardPatchBody.cooldown;
                if (rewardPatchBody.message !== undefined) rewardDbUpdate.message = rewardPatchBody.message;
                if (rewardPatchBody.costChange !== undefined) rewardDbUpdate.costChange = rewardPatchBody.costChange;
                if (rewardPatchBody.returnToOriginalCost !== undefined) rewardDbUpdate.returnToOriginalCost = rewardPatchBody.returnToOriginalCost;
                if (rewardPatchBody.duration !== undefined) rewardDbUpdate.duration = rewardPatchBody.duration;
                if (rewardPatchBody.isEnabled !== undefined) rewardDbUpdate.isEnabled = rewardPatchBody.isEnabled;
                if (rewardPatchBody.backgroundColor !== undefined) rewardDbUpdate.backgroundColor = rewardPatchBody.backgroundColor;

                if (Object.keys(rewardDbUpdate).length > 0) {
                    await RedemptionRewardSchema.findOneAndUpdate(
                        { channelID: channelIdStr, rewardID: trigger.rewardID },
                        rewardDbUpdate,
                        { new: true }
                    );
                }
            }
        }

        try {
            const updateDoc: Partial<ITrigger> = {};
            updateDoc.name = nextName;
            updateDoc.file = nextFile;
            updateDoc.mediaType = nextMediaType;
            updateDoc.assetID = nextAssetID || null;
            updateDoc.libraryItemID = nextLibraryItemID || null;
            updateDoc.rewardID = trigger.rewardID || '';
            if (typeof volume === 'number') {
                updateDoc.volume = volume;
            }
            if (typeof isEnabled === 'boolean') {
                updateDoc.isEnabled = isEnabled;
            }

            const linkedReward = trigger.rewardID
                ? await RedemptionRewardSchema.findOne({ channelID: channelIdStr, rewardID: trigger.rewardID }).lean()
                : null;

            updateDoc.cost = linkedReward?.cost || 0;
            updateDoc.cooldown = linkedReward?.cooldown || 0;
            updateDoc.prompt = linkedReward?.prompt || '';

            const updateResult = await TriggerSchema.findByIdAndUpdate(triggerIdStr, updateDoc, { new: true });
            const enriched = updateResult ? await enrichTriggers([updateResult]) : [];

            return res.status(200).json({
                data: enriched[0] || updateResult,
                status: 200
            });
        } catch (updateError) {
            await error({
                error: 'Internal Server Error',
                message: 'Error updating trigger',
                status: 500,
                updateError: updateError instanceof Error ? updateError.message : String(updateError)
            }, { channelId: channelIdStr, destination: 'both' });
            return res.status(500).json({
                error: 'Internal Server Error',
                message: 'Error updating trigger',
                status: 500
            });
        }
    } catch (err) {
        await error({
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            channelID: req.params.channelID,
            triggerID: req.params.triggerID,
            body: req.body,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

        res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.delete('/:channelID/:triggerID', authMiddleware as any, async (req: TriggerRequest, res: Response) => {
    try {
        const { channelID, triggerID } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
        const triggerIdStr = Array.isArray(triggerID) ? triggerID[0] : triggerID;

        if (!await ensureTriggerPermission(req, res, channelIdStr, ['triggers:delete'])) {
            return;
        }

        const trigger = await TriggerSchema.findOne({ channelID: channelIdStr, _id: triggerIdStr });
        if (!trigger) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Trigger not found',
                status: 404
            });
        }

        if (trigger.rewardID && trigger.rewardID.trim() !== '') {
            try {
                await cleanupRewardArtifacts(channelIdStr, trigger.rewardID, undefined, `trigger-route-delete-${Date.now()}`);
            } catch (cleanupError) {
                await error({
                    error: 'Bad Request',
                    message: 'Error deleting trigger',
                    status: 400,
                    cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
                }, { channelId: channelIdStr, destination: 'both' });
                return res.status(400).json({
                    error: true,
                    message: 'Error deleting trigger reward',
                    status: 400
                });
            }
        }

        try {
            await TriggerSchema.deleteOne({ channelID: channelIdStr, _id: triggerIdStr });
        } catch (deleteError) {
            await error({
                error: 'Internal Server Error',
                message: 'Error deleting trigger',
                status: 500,
                deleteError: deleteError instanceof Error ? deleteError.message : String(deleteError)
            }, { channelId: channelIdStr, destination: 'both' });
            return res.status(500).json({
                error: 'Internal Server Error',
                message: 'Error deleting trigger',
                status: 500
            });
        }

        if (trigger.assetID) {
            const triggerReferenceCount = await TriggerSchema.countDocuments({ assetID: trigger.assetID });
            await MediaAssetSchema.updateOne({ _id: trigger.assetID }, { $set: { triggerReferenceCount } });
        }

        return res.status(200).json({
            data: trigger,
            status: 200
        });
    } catch (err) {
        await error({
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            channelID: req.params.channelID,
            triggerID: req.params.triggerID,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

        res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.post('/:channelID/send', authMiddleware as any, async (req: TriggerRequest, res: Response) => {
    try {
        const io = getIO();
        const { channelID } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
        const body = req.body;

        if (!await ensureTriggerPermission(req, res, channelIdStr, ['triggers:attach', 'triggers:edit'])) {
            return;
        }

        if (!io) {
            return res.status(500).json({
                error: true,
                message: 'Websocket not initialized',
                status: 500
            });
        }

        const namespacePath = `/overlays/triggers/${channelIdStr}`;
        const namespace = io.of(namespacePath);
        const sockets = await namespace.fetchSockets();

        if (sockets.length === 0) {
            await error({
                error: 'No Connected Trigger Clients',
                message: 'No trigger overlay clients connected',
                status: 409,
                channelID: channelIdStr,
                namespacePath
            }, { channelId: channelIdStr, destination: 'both' });

            return res.status(409).json({
                error: true,
                message: 'No trigger overlay clients connected',
                status: 409,
                data: {
                    activeConnections: 0,
                    namespace: namespacePath
                }
            });
        }

        try {
            namespace.emit('trigger', body);
        } catch (emitError) {
            await error({
                error: 'Internal Server Error',
                message: 'Error emitting trigger',
                status: 500,
                emitError: emitError instanceof Error ? emitError.message : String(emitError)
            }, { channelId: channelIdStr, destination: 'both' });
            return res.status(500).json({
                error: true,
                message: 'Error emitting trigger',
                status: 500
            });
        }

        return res.status(200).json({
            error: false,
            message: 'Trigger sent',
            status: 200,
            data: {
                activeConnections: sockets.length,
                namespace: namespacePath
            }
        });
    } catch (err) {
        await error({
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            channelID: req.params.channelID,
            body: req.body,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

        res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.post('/:channelID/upload', authMiddleware as any, async (req: MulterRequest, res: Response) => {
    return legacyTriggerFileResponse(res);
});

router.get('/files/:channelID', authMiddleware as any, async (req: TriggerRequest, res: Response) => {
    return legacyTriggerFileResponse(res);
});

router.delete('/files/:channelID/:fileID', authMiddleware as any, async (req: TriggerRequest, res: Response) => {
    return legacyTriggerFileResponse(res);
});

export const triggerRoute = router;
