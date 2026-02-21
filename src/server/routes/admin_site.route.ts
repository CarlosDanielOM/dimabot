import express, { type Request, type Response } from 'express';
import UsersSchema from '../../schemas/users.schema.js';
import { CommandsSchema } from '../../schemas/commands.schema.js';
import EventsubSchema from '../../schemas/eventsub.schema.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { getTwitchAppHeader } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';

interface AuthRequest extends Request {
    user?: {
        id: string;
        login: string;
        display_name: string;
        profile_image_url?: string;
    };
}

interface TwitchLiveStream {
    user_id: string;
    viewer_count?: number;
}

interface AggregatedUser {
    channelID: string;
    channel: string;
    email: string;
    plan_tier: 'free' | 'premium' | 'pro';
    actived: boolean;
    chat_enabled: boolean;
    has_permissions: boolean;
    up_to_date_permissions: boolean;
    created_at?: Date;
    updated_at?: Date;
}

interface AdminUserRow extends AggregatedUser {
    isLive: boolean;
    liveViewers: number;
    commandsCount: number;
    eventsubsActiveCount: number;
    eventsubsDisabledCount: number;
}

const SUPER_ADMIN_LOGIN = 'cdom201';
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const DEFAULT_SORT_BY = 'channel';
const DEFAULT_SORT_ORDER = 'asc';

type SortOrder = 'asc' | 'desc';

const router = express.Router();

function parsePositiveInt(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.floor(parsed);
}

function chunkArray<T>(items: T[], size: number): T[][] {
    if (size <= 0) {
        return [items];
    }

    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

function normalizeSortOrder(value: unknown): SortOrder {
    return String(value || '').toLowerCase() === 'desc' ? 'desc' : 'asc';
}

function compareValues(a: unknown, b: unknown): number {
    if (typeof a === 'number' && typeof b === 'number') {
        return a - b;
    }

    if (typeof a === 'boolean' && typeof b === 'boolean') {
        return Number(a) - Number(b);
    }

    const left = String(a ?? '').toLowerCase();
    const right = String(b ?? '').toLowerCase();
    return left.localeCompare(right);
}

function ensureSuperAdmin(req: AuthRequest, res: Response): boolean {
    const requesterLogin = String(req.user?.login || '').toLowerCase();
    if (requesterLogin !== SUPER_ADMIN_LOGIN) {
        res.status(403).json({
            error: true,
            message: 'You do not have permission to access this endpoint',
            status: 403
        });
        return false;
    }

    return true;
}

async function fetchLiveByChannelIds(channelIDs: string[]): Promise<Map<string, TwitchLiveStream>> {
    const liveByChannelID = new Map<string, TwitchLiveStream>();
    const uniqueIDs = Array.from(new Set(channelIDs.filter((id) => Boolean(id))));

    if (!uniqueIDs.length) {
        return liveByChannelID;
    }

    const appHeader = await getTwitchAppHeader();
    const batches = chunkArray(uniqueIDs, 100);

    for (const batch of batches) {
        const params = new URLSearchParams({ type: 'live' });
        for (const channelID of batch) {
            params.append('user_id', channelID);
        }

        const response = await fetch(getTwitchHelixUrl('streams', params.toString()), {
            headers: {
                'Client-Id': appHeader['Client-Id'],
                'Authorization': appHeader.Authorization,
                'Content-Type': appHeader['Content-Type']
            }
        });

        if (!response.ok) {
            continue;
        }

        const payload = await response.json();
        const streams = Array.isArray(payload?.data) ? payload.data as TwitchLiveStream[] : [];
        for (const stream of streams) {
            if (!stream.user_id) {
                continue;
            }
            liveByChannelID.set(stream.user_id, stream);
        }
    }

    return liveByChannelID;
}

router.get('/users', authMiddleware as any, async (req: AuthRequest, res: Response) => {
    try {
        if (!ensureSuperAdmin(req, res)) {
            return;
        }

        const page = parsePositiveInt(req.query.page, 1);
        const limit = Math.min(MAX_LIMIT, parsePositiveInt(req.query.limit, DEFAULT_LIMIT));
        const search = String(req.query.search || '').trim().toLowerCase();
        const sortBy = String(req.query.sortBy || DEFAULT_SORT_BY);
        const sortOrder = normalizeSortOrder(req.query.sortOrder || DEFAULT_SORT_ORDER);

        const matchStage: Record<string, unknown> = {
            'accounts.type': 'twitch'
        };

        if (search) {
            matchStage.$or = [
                { 'accounts.name': { $regex: search, $options: 'i' } },
                { 'accounts.id': { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }

        const aggregateBase = [
            { $unwind: '$accounts' },
            { $match: matchStage }
        ];

        const users: AggregatedUser[] = await UsersSchema.aggregate([
            ...aggregateBase,
            {
                $project: {
                    _id: 0,
                    channelID: '$accounts.id',
                    channel: '$accounts.name',
                    email: '$accounts.email',
                    plan_tier: '$plan_tier',
                    actived: '$accounts.actived',
                    chat_enabled: '$accounts.chat_enabled',
                    has_permissions: '$accounts.has_permissions',
                    up_to_date_permissions: '$accounts.up_to_date_permissions',
                    created_at: '$created_at',
                    updated_at: '$updated_at'
                }
            }
        ]);
        
        const total = users.length;
        const channelIDs = users.map((user) => user.channelID).filter((channelID) => Boolean(channelID));

        if (!channelIDs.length) {
            return res.status(200).json({
                error: false,
                message: 'Admin users fetched successfully',
                status: 200,
                data: {
                    rows: [],
                    pagination: {
                        page,
                        limit,
                        total: 0,
                        totalPages: 1
                    },
                    summary: {
                        totalChannels: 0,
                        activeBots: 0,
                        inactiveBots: 0,
                        withPermissions: 0,
                        permissionsNeedUpdate: 0,
                        liveChannels: 0,
                        liveViewers: 0,
                        totalCommands: 0,
                        totalEventsubsActive: 0,
                        totalEventsubsDisabled: 0
                    }
                }
            });
        }

        const [commandsCountAgg, eventsubCountAgg, liveByChannelID] = await Promise.all([
            CommandsSchema.aggregate([
                { $match: { channelID: { $in: channelIDs } } },
                { $group: { _id: '$channelID', count: { $sum: 1 } } }
            ]),
            EventsubSchema.aggregate([
                { $match: { channelID: { $in: channelIDs } } },
                {
                    $group: {
                        _id: '$channelID',
                        activeCount: {
                            $sum: {
                                $cond: [{ $eq: ['$enabled', true] }, 1, 0]
                            }
                        },
                        disabledCount: {
                            $sum: {
                                $cond: [{ $eq: ['$enabled', false] }, 1, 0]
                            }
                        }
                    }
                }
            ]),
            fetchLiveByChannelIds(channelIDs)
        ]);

        const commandsByChannel = new Map<string, number>(
            commandsCountAgg.map((row) => [String(row._id), Number(row.count || 0)])
        );

        const eventsubsByChannel = new Map<string, { active: number; disabled: number }>(
            eventsubCountAgg.map((row) => [
                String(row._id),
                {
                    active: Number(row.activeCount || 0),
                    disabled: Number(row.disabledCount || 0)
                }
            ])
        );

        const fullRows: AdminUserRow[] = users.map((user) => {
            const live = liveByChannelID.get(user.channelID);
            const eventsubs = eventsubsByChannel.get(user.channelID) || { active: 0, disabled: 0 };

            return {
                ...user,
                isLive: Boolean(live),
                liveViewers: Number(live?.viewer_count || 0),
                commandsCount: Number(commandsByChannel.get(user.channelID) || 0),
                eventsubsActiveCount: eventsubs.active,
                eventsubsDisabledCount: eventsubs.disabled
            };
        });

        const sortableGetters: Record<string, (row: AdminUserRow) => unknown> = {
            channel: (row) => row.channel,
            plan_tier: (row) => row.plan_tier,
            actived: (row) => row.actived,
            has_permissions: (row) => row.has_permissions && row.up_to_date_permissions,
            chat_enabled: (row) => row.chat_enabled,
            isLive: (row) => row.isLive,
            liveViewers: (row) => row.liveViewers,
            commandsCount: (row) => row.commandsCount,
            eventsubsActiveCount: (row) => row.eventsubsActiveCount,
            eventsubsDisabledCount: (row) => row.eventsubsDisabledCount,
            created_at: (row) => row.created_at ? new Date(row.created_at).getTime() : 0,
            updated_at: (row) => row.updated_at ? new Date(row.updated_at).getTime() : 0
        };

        const getSortValue = sortableGetters[sortBy] || sortableGetters[DEFAULT_SORT_BY];
        const sortedRows = [...fullRows].sort((left, right) => {
            const compared = compareValues(getSortValue(left), getSortValue(right));
            if (compared === 0) {
                return compareValues(left.channel, right.channel);
            }
            return sortOrder === 'asc' ? compared : -compared;
        });

        const totalPages = Math.max(1, Math.ceil(total / limit));
        const normalizedPage = Math.min(page, totalPages);
        const skip = (normalizedPage - 1) * limit;
        const rows = sortedRows.slice(skip, skip + limit);

        const summary = fullRows.reduce((acc, row) => {
            acc.totalChannels += 1;
            if (row.actived) {
                acc.activeBots += 1;
            }
            if (row.has_permissions && row.up_to_date_permissions) {
                acc.withPermissions += 1;
            }
            if (row.isLive) {
                acc.liveChannels += 1;
                acc.liveViewers += row.liveViewers;
            }
            acc.totalCommands += row.commandsCount;
            acc.totalEventsubsActive += row.eventsubsActiveCount;
            acc.totalEventsubsDisabled += row.eventsubsDisabledCount;
            return acc;
        }, {
            totalChannels: 0,
            activeBots: 0,
            withPermissions: 0,
            liveChannels: 0,
            liveViewers: 0,
            totalCommands: 0,
            totalEventsubsActive: 0,
            totalEventsubsDisabled: 0
        });

        return res.status(200).json({
            error: false,
            message: 'Admin users fetched successfully',
            status: 200,
            data: {
                rows,
                pagination: {
                    page: normalizedPage,
                    limit,
                    total,
                    totalPages
                },
                summary: {
                    totalChannels: summary.totalChannels,
                    activeBots: summary.activeBots,
                    inactiveBots: Math.max(0, summary.totalChannels - summary.activeBots),
                    withPermissions: summary.withPermissions,
                    permissionsNeedUpdate: Math.max(0, summary.totalChannels - summary.withPermissions),
                    liveChannels: summary.liveChannels,
                    liveViewers: summary.liveViewers,
                    totalCommands: summary.totalCommands,
                    totalEventsubsActive: summary.totalEventsubsActive,
                    totalEventsubsDisabled: summary.totalEventsubsDisabled
                }
            }
        });
    } catch (error) {
        console.error('Error in GET /admin-site/users:', {
            user: req.user?.login,
            query: req.query,
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

router.get('/users/:channelID/commands', authMiddleware as any, async (req: AuthRequest, res: Response) => {
    try {
        if (!ensureSuperAdmin(req, res)) {
            return;
        }

        const { channelID } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
        const page = parsePositiveInt(req.query.page, 1);
        const limit = Math.min(MAX_LIMIT, parsePositiveInt(req.query.limit, DEFAULT_LIMIT));
        const skip = (page - 1) * limit;
        const search = String(req.query.search || '').trim();
        const sortBy = String(req.query.sortBy || 'createdAt');
        const sortOrder = normalizeSortOrder(req.query.sortOrder || 'desc');

        const match: Record<string, unknown> = { channelID: channelIdStr };
        if (search) {
            match.$or = [
                { name: { $regex: search, $options: 'i' } },
                { cmd: { $regex: search, $options: 'i' } },
                { func: { $regex: search, $options: 'i' } },
                { message: { $regex: search, $options: 'i' } }
            ];
        }

        const commandSortMap: Record<string, string> = {
            createdAt: 'createdAt',
            name: 'name',
            cmd: 'cmd',
            func: 'func',
            enabled: 'enabled',
            cooldown: 'cooldown',
            userLevelName: 'userLevelName'
        };
        const mongoSortField = commandSortMap[sortBy] || 'createdAt';
        const mongoSortOrder = sortOrder === 'asc' ? 1 : -1;

        const [total, rows] = await Promise.all([
            CommandsSchema.countDocuments(match),
            CommandsSchema.find(match)
                .select('_id name cmd func message enabled cooldown userLevelName createdAt')
                .sort({ [mongoSortField]: mongoSortOrder })
                .skip(skip)
                .limit(limit)
                .lean()
        ]);

        return res.status(200).json({
            error: false,
            message: 'Admin user commands fetched successfully',
            status: 200,
            data: {
                rows: rows.map((row) => ({
                    id: String(row._id),
                    name: row.name || '',
                    cmd: row.cmd || '',
                    func: row.func || '',
                    message: row.message || '',
                    enabled: Boolean(row.enabled),
                    cooldown: Number(row.cooldown || 0),
                    userLevelName: row.userLevelName || '',
                    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : undefined
                })),
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.max(1, Math.ceil(total / limit))
                }
            }
        });
    } catch (error) {
        console.error('Error in GET /admin-site/users/:channelID/commands:', {
            user: req.user?.login,
            channelID: req.params.channelID,
            query: req.query,
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

router.get('/users/:channelID/eventsubs', authMiddleware as any, async (req: AuthRequest, res: Response) => {
    try {
        if (!ensureSuperAdmin(req, res)) {
            return;
        }

        const { channelID } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
        const page = parsePositiveInt(req.query.page, 1);
        const limit = Math.min(MAX_LIMIT, parsePositiveInt(req.query.limit, DEFAULT_LIMIT));
        const skip = (page - 1) * limit;
        const search = String(req.query.search || '').trim();
        const sortBy = String(req.query.sortBy || 'created_at');
        const sortOrder = normalizeSortOrder(req.query.sortOrder || 'desc');

        const match: Record<string, unknown> = { channelID: channelIdStr };
        if (search) {
            match.$or = [
                { type: { $regex: search, $options: 'i' } },
                { status: { $regex: search, $options: 'i' } },
                { message: { $regex: search, $options: 'i' } },
                { endMessage: { $regex: search, $options: 'i' } }
            ];
        }

        const eventsubSortMap: Record<string, string> = {
            created_at: 'created_at',
            type: 'type',
            status: 'status',
            version: 'version',
            enabled: 'enabled'
        };
        const mongoSortField = eventsubSortMap[sortBy] || 'created_at';
        const mongoSortOrder = sortOrder === 'asc' ? 1 : -1;

        const [total, rows] = await Promise.all([
            EventsubSchema.countDocuments(match),
            EventsubSchema.find(match)
                .select('_id type status version enabled message endMessage created_at')
                .sort({ [mongoSortField]: mongoSortOrder })
                .skip(skip)
                .limit(limit)
                .lean()
        ]);

        return res.status(200).json({
            error: false,
            message: 'Admin user eventsubs fetched successfully',
            status: 200,
            data: {
                rows: rows.map((row) => ({
                    id: String(row._id),
                    type: row.type || '',
                    status: row.status || '',
                    version: row.version || '',
                    enabled: Boolean(row.enabled),
                    message: row.message || '',
                    endMessage: row.endMessage || '',
                    created_at: row.created_at || ''
                })),
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.max(1, Math.ceil(total / limit))
                }
            }
        });
    } catch (error) {
        console.error('Error in GET /admin-site/users/:channelID/eventsubs:', {
            user: req.user?.login,
            channelID: req.params.channelID,
            query: req.query,
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

export const adminSiteRoute = router;
