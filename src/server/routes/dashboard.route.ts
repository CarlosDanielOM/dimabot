import express, { type Request, type Response } from 'express';
import TwitchStreamers from '../../classes/twitch_streamers.class.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { AdminSchema } from '../../schemas/admin.schema.js';
import UsersSchema from '../../schemas/users.schema.js';
import { getTwitchAppHeader } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';
import { getDashboardAnalytics } from '../../utils/stream_analytics.js';

interface DashboardRequest extends Request {
    user?: {
        id: string;
        login: string;
        display_name: string;
        profile_image_url?: string;
    };
}

type PlanTier = 'free' | 'premium' | 'pro';

function normalizePlanTier(planTier: string | undefined): PlanTier {
    if (planTier === 'premium' || planTier === 'pro') {
        return planTier;
    }

    return 'free';
}

const router = express.Router();

async function getLiveStatus(channelID: string): Promise<{ isLive: boolean; stream?: any }> {
    const appHeader = await getTwitchAppHeader();
    const params = new URLSearchParams({ user_id: channelID });

    const response = await fetch(getTwitchHelixUrl('streams', params.toString()), {
        headers: {
            'Client-Id': appHeader['Client-Id'],
            'Authorization': appHeader.Authorization,
            'Content-Type': appHeader['Content-Type']
        }
    });

    if (!response.ok) {
        return { isLive: false };
    }

    const data = await response.json();
    const stream = Array.isArray(data.data) && data.data.length > 0 ? data.data[0] : null;

    return {
        isLive: Boolean(stream),
        stream: stream || undefined
    };
}

async function getAccessContext(requesterID: string, channelID: string): Promise<{ allowed: boolean; role: 'owner' | 'admin' | 'none' }> {
    if (requesterID === channelID) {
        return { allowed: true, role: 'owner' };
    }

    const admin = await AdminSchema.findOne({
        channelID,
        adminID: requesterID,
        actived: true,
        permissions: { $in: ['*', 'dashboard:view'] }
    }).lean();

    if (admin) {
        return { allowed: true, role: 'admin' };
    }

    return { allowed: false, role: 'none' };
}

async function getChannelChatEnabled(channelID: string, fallback: boolean): Promise<boolean> {
    try {
        const user = await UsersSchema.findOne({
            'accounts.id': channelID,
            'accounts.type': 'twitch'
        }).select('accounts').lean();

        if (!user) {
            return fallback;
        }

        const twitchAccount = user.accounts.find((account) => account.type === 'twitch');
        return twitchAccount?.chat_enabled ?? fallback;
    } catch (error) {
        console.error('Error in getChannelChatEnabled:', {
            channelID,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
        return fallback;
    }
}

router.get('/:channelID/access', authMiddleware as any, async (req: DashboardRequest, res: Response) => {
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
                message: 'You do not have permission to view this dashboard',
                status: 403
            });
        }

        return res.status(200).json({
            error: false,
            message: 'Access granted',
            status: 200,
            data: {
                allowed: true,
                role: access.role,
                channelID: channelIdStr,
                channelName: streamer.name,
                planTier: normalizePlanTier(streamer.plan_tier)
            }
        });
    } catch (error) {
        console.error('Error in GET /dashboard/:channelID/access:', {
            channelID: req.params.channelID,
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

router.get('/:channelID/live-status', authMiddleware as any, async (req: DashboardRequest, res: Response) => {
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
                message: 'You do not have permission to view this dashboard',
                status: 403
            });
        }

        const live = await getLiveStatus(channelIdStr);

        return res.status(200).json({
            error: false,
            message: 'Live status fetched successfully',
            status: 200,
            data: {
                isLive: live.isLive,
                role: access.role,
                checkedAt: new Date().toISOString(),
                stream: live.stream || null
            }
        });
    } catch (error) {
        console.error('Error in GET /dashboard/:channelID/live-status:', {
            channelID: req.params.channelID,
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

router.get('/:channelID/bootstrap', authMiddleware as any, async (req: DashboardRequest, res: Response) => {
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
                message: 'You do not have permission to view this dashboard',
                status: 403
            });
        }

        const analytics = await getDashboardAnalytics(channelIdStr, 30);
        const live = await getLiveStatus(channelIdStr);
        const cacheChatEnabled = streamer.chat_enabled === 'true';
        const chatEnabled = await getChannelChatEnabled(channelIdStr, cacheChatEnabled);

        return res.status(200).json({
            error: false,
            message: 'Dashboard bootstrap fetched successfully',
            status: 200,
            data: {
                role: access.role,
                channel: {
                    id: channelIdStr,
                    name: streamer.name,
                    chatEnabled
                },
                isLive: live.isLive,
                liveStream: live.stream || null,
                kpis: analytics.kpis,
                trend: analytics.trend,
                streamHistory: analytics.streamHistory
            }
        });
    } catch (error) {
        console.error('Error in GET /dashboard/:channelID/bootstrap:', {
            channelID: req.params.channelID,
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

export const dashboardRoute = router;
