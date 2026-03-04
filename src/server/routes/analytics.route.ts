import express, { type Request, type Response } from 'express';
import TwitchStreamers from '../../classes/twitch_streamers.class.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { AdminSchema } from '../../schemas/admin.schema.js';
import { FollowRelationshipLedgerSchema } from '../../schemas/follow_relationship_ledger.schema.js';

interface IRequestWithUser extends Request {
    user?: {
        id: string;
    };
}

function normalizeStatusFilter(value: unknown): 'active' | 'ended' | 'all' {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'ended') return 'ended';
    if (normalized === 'all') return 'all';
    return 'active';
}

function normalizeMutualFilter(value: unknown): 'mutual' | 'non-mutual' | 'all' {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'mutual' || normalized === 'true' || normalized === '1') return 'mutual';
    if (normalized === 'non-mutual' || normalized === 'non_mutual' || normalized === 'false' || normalized === '0') return 'non-mutual';
    return 'all';
}

function normalizeSortOrder(value: unknown): 'asc' | 'desc' {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'asc' ? 'asc' : 'desc';
}

function normalizeSearch(value: unknown): string {
    const normalized = String(value || '').trim();
    if (normalized.length <= 0) return '';
    return normalized.slice(0, 64);
}

function escapeRegex(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toPositiveInt(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.floor(parsed);
}

async function getAccessContext(requesterID: string, channelID: string): Promise<{ allowed: boolean; role: 'owner' | 'admin' | 'none' }> {
    if (requesterID === channelID) {
        return { allowed: true, role: 'owner' };
    }

    const admin = await AdminSchema.findOne({
        channelID,
        adminID: requesterID,
        actived: true,
        permissions: { $in: ['*', 'dashboard:view', 'analytics:view'] }
    }).lean();

    if (admin) {
        return { allowed: true, role: 'admin' };
    }

    return { allowed: false, role: 'none' };
}

const router = express.Router();

router.get('/follows/:channelID', authMiddleware as any, async (req: IRequestWithUser, res: Response) => {
    try {
        const { channelID } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
        const requesterID = req.user?.id;

        if (!requesterID) {
            return res.status(401).json({
                error: true,
                message: 'Authentication required',
                status: 401
            });
        }

        const streamer = await TwitchStreamers.getTwitchAccountById(channelIdStr);
        if (!streamer) {
            return res.status(404).json({
                error: true,
                message: 'Streamer not found',
                status: 404
            });
        }

        const access = await getAccessContext(requesterID, channelIdStr);
        if (!access.allowed) {
            return res.status(403).json({
                error: true,
                message: 'You do not have permission to view this analytics page',
                status: 403
            });
        }

        const statusFilter = normalizeStatusFilter(req.query.status);
        const mutualFilter = normalizeMutualFilter(req.query.mutual);
        const sortOrder = normalizeSortOrder(req.query.order);
        const search = normalizeSearch(req.query.search);
        const page = toPositiveInt(req.query.page, 1);
        const limit = Math.min(200, toPositiveInt(req.query.limit, 48));

        const query: Record<string, unknown> = {
            platform: 'twitch',
            followed_id: channelIdStr
        };

        if (statusFilter !== 'all') {
            query.status = statusFilter;
        }
        if (mutualFilter === 'mutual') {
            query.mutual = true;
        }
        if (mutualFilter === 'non-mutual') {
            query.mutual = false;
        }
        if (search.length > 0) {
            const searchRegex = new RegExp(escapeRegex(search), 'i');
            query.$or = [
                { follower_login: searchRegex },
                { follower_name: searchRegex },
                { follower_id: searchRegex }
            ];
        }

        const [rows, total, activeCount, mutualCount] = await Promise.all([
            FollowRelationshipLedgerSchema.find(query)
                .sort({ followed_at: sortOrder === 'asc' ? 1 : -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .select('follower_id follower_login follower_name mutual status followed_at ended_at')
                .lean(),
            FollowRelationshipLedgerSchema.countDocuments(query),
            FollowRelationshipLedgerSchema.countDocuments({
                platform: 'twitch',
                followed_id: channelIdStr,
                status: 'active'
            }),
            FollowRelationshipLedgerSchema.countDocuments({
                platform: 'twitch',
                followed_id: channelIdStr,
                status: 'active',
                mutual: true
            })
        ]);

        return res.status(200).json({
            error: false,
            message: 'Follow ledger fetched successfully',
            status: 200,
            data: {
                role: access.role,
                channelID: channelIdStr,
                channelName: streamer.name,
                filters: {
                    status: statusFilter,
                    mutual: mutualFilter,
                    order: sortOrder,
                    search
                },
                rows: rows.map((row) => ({
                    follower_id: row.follower_id,
                    follower_login: row.follower_login,
                    follower_name: row.follower_name,
                    mutual: Boolean(row.mutual),
                    status: row.status,
                    followed_at: row.followed_at instanceof Date ? row.followed_at.toISOString() : new Date(row.followed_at).toISOString(),
                    ended_at: row.ended_at instanceof Date
                        ? row.ended_at.toISOString()
                        : row.ended_at
                            ? new Date(row.ended_at).toISOString()
                            : null
                })),
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.max(1, Math.ceil(total / limit))
                },
                summary: {
                    activeCount,
                    mutualCount,
                    nonMutualCount: Math.max(0, activeCount - mutualCount)
                }
            }
        });
    } catch (error) {
        console.error('Error in GET /analytics/follows/:channelID:', {
            channelID: req.params.channelID,
            query: req.query,
            requesterID: req.user?.id,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });

        return res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

export const analyticsRoute = router;
