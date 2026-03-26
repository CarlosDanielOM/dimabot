import { randomBytes } from 'crypto';
import path from 'path';
import { Types } from 'mongoose';
import { AdminSchema } from '../../schemas/admin.schema.js';
import { UserMediaLibraryItemSchema } from '../../schemas/user_media_library_item.schema.js';
import type { MediaAssetMarketplaceStatus, MediaAssetScope, MediaAssetType } from '../../schemas/media_asset.schema.js';
import { getApiUrl } from '../../utils/dev.js';

export type PlanTier = 'free' | 'premium' | 'pro';

export const MEDIA_NAME_REGEX = /^[A-Za-z0-9_]+$/;
export const DOMDIMABOT_SITE_OWNER_USER_ID = 'system:domdimabot';
export const DOMDIMABOT_SITE_OWNER_CHANNEL_ID = 'domdimabot';
export const DOMDIMABOT_SITE_OWNER_CHANNEL_NAME = 'DomDimaBot';

const PLAN_UPLOAD_LIMIT_MB: Record<PlanTier, number> = {
    free: 5,
    premium: 25,
    pro: 100
};

const PLAN_STORAGE_QUOTA_BYTES: Record<PlanTier, number> = {
    free: 100 * 1024 * 1024,
    premium: 1024 * 1024 * 1024,
    pro: 10 * 1024 * 1024 * 1024
};

const MIME_EXTENSION_FALLBACK: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/x-wav': 'wav',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'image/jpeg': 'jpg',
    'image/svg+xml': 'svg',
    'video/quicktime': 'mov'
};

export function normalizePlanTier(planTier: string | undefined): PlanTier {
    if (planTier === 'premium' || planTier === 'pro') {
        return planTier;
    }

    return 'free';
}

export function getPlanUploadLimitBytes(planTier: PlanTier): number {
    return PLAN_UPLOAD_LIMIT_MB[planTier] * 1024 * 1024;
}

export function getPlanStorageQuotaBytes(planTier: PlanTier): number {
    return PLAN_STORAGE_QUOTA_BYTES[planTier];
}

export function isValidMediaDisplayName(name: string): boolean {
    return MEDIA_NAME_REGEX.test(name);
}

export function inferMediaTypeFromMimeType(mimeType: string): MediaAssetType | null {
    if (mimeType === 'image/gif') {
        return 'gif';
    }

    if (mimeType.startsWith('video/')) {
        return 'video';
    }

    if (mimeType.startsWith('audio/')) {
        return 'audio';
    }

    if (mimeType.startsWith('image/')) {
        return 'image';
    }

    return null;
}

export function getFileExtension(fileName: string, mimeType: string): string {
    const rawExtension = path.extname(fileName).replace(/^\./, '').toLowerCase();
    if (rawExtension) {
        return normalizeExtension(rawExtension);
    }

    return MIME_EXTENSION_FALLBACK[mimeType] || mimeType.split('/')[1]?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
}

function normalizeExtension(extension: string): string {
    if (extension === 'jpeg') return 'jpg';
    if (extension === 'svg+xml') return 'svg';
    if (extension === 'quicktime') return 'mov';
    return extension;
}

export function buildStoredMediaFileName(displayName: string, extension: string): string {
    const hashId = randomBytes(6).toString('hex');
    return `${hashId}-${displayName}-${Date.now()}.${extension}`;
}

export function buildMediaS3Key(scope: MediaAssetScope, mediaType: MediaAssetType, channelID: string, fileName: string): string {
    if (scope === 'public') {
        return `library/${mediaType}/${fileName}`;
    }

    return `${channelID}/triggers/${fileName}`;
}

export function buildMediaPlaybackUrl(mediaID: string | Types.ObjectId): string {
    return `${getApiUrl()}/media/${String(mediaID)}`;
}

export function getDefaultMediaScope(planTier: PlanTier, requestedScope: unknown): MediaAssetScope {
    if (planTier === 'free') {
        return 'public';
    }

    return requestedScope === 'public' ? 'public' : 'private';
}

export function getInitialMarketplaceStatus(scope: MediaAssetScope): MediaAssetMarketplaceStatus {
    return scope === 'public' ? 'published' : 'not_listed';
}

export async function getChannelQuotaUsageBytes(channelID: string): Promise<number> {
    const result = await UserMediaLibraryItemSchema.aggregate<{ total: number }>([
        {
            $match: {
                channelID,
                isActive: true,
                deletedAt: null
            }
        },
        {
            $group: {
                _id: null,
                total: { $sum: '$quotaBytesCharged' }
            }
        }
    ]);

    return Number(result[0]?.total || 0);
}

export async function hasTriggerPermission(requesterID: string, channelID: string, requiredPermissions: string[]): Promise<boolean> {
    if (requesterID === channelID) {
        return true;
    }

    const permissionsToCheck = ['*', 'triggers:all', ...requiredPermissions];
    const admin = await AdminSchema.findOne({
        channelID,
        adminID: requesterID,
        actived: true,
        permissions: { $in: permissionsToCheck }
    }).lean();

    return Boolean(admin);
}
