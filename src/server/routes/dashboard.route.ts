import express, { type Request, type Response } from 'express';
import TwitchStreamers from '../../classes/twitch_streamers.class.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { AdminSchema } from '../../schemas/admin.schema.js';
import { FollowRelationshipLedgerSchema } from '../../schemas/follow_relationship_ledger.schema.js';
import { StreamSubscriptionLedgerSchema } from '../../schemas/stream_subscription_ledger.schema.js';
import UsersSchema from '../../schemas/users.schema.js';
import { getCachedLiveStatus } from '../../utils/siteanalytics.js';
import { getDashboardAnalytics, getLiveSessionMetrics } from '../../utils/stream_analytics.js';

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

async function getLiveStatus(channelID: string): Promise<{ isLive: boolean; stream: Record<string, unknown> | null; liveSession: Awaited<ReturnType<typeof getLiveSessionMetrics>> }> {
    const live = await getCachedLiveStatus(channelID);
    const currentViewers = live.stream?.viewer_count ?? 0;
    const liveSession = await getLiveSessionMetrics(channelID, {
        currentViewers
    });

    if (!live.isLive || !live.stream) {
        return {
            isLive: false,
            stream: null,
            liveSession: null
        };
    }

    return {
        isLive: true,
        stream: {
            id: '',
            user_id: channelID,
            user_login: '',
            user_name: '',
            game_name: live.stream.game_name || '',
            title: live.stream.title || '',
            viewer_count: currentViewers,
            started_at: live.stream.started_at || '',
            language: '',
            thumbnail_url: '',
            is_mature: false
        },
        liveSession
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
                stream: live.stream,
                liveSession: live.liveSession
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

        const cacheChatEnabled = streamer.chat_enabled === 'true';
        const [analytics, live, chatEnabled, totalFollowers, totalSubs] = await Promise.all([
            getDashboardAnalytics(channelIdStr, 30),
            getLiveStatus(channelIdStr),
            getChannelChatEnabled(channelIdStr, cacheChatEnabled),
            FollowRelationshipLedgerSchema.countDocuments({
                followed_id: channelIdStr,
                status: 'active'
            }),
            StreamSubscriptionLedgerSchema.countDocuments({
                streamer_id: channelIdStr,
                status: 'active'
            })
        ]);

        const followersGoal = 1000;
        const subsGoal = 1000;

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
                liveSession: live.liveSession,
                kpis: analytics.kpis,
                trend: analytics.trend,
                streamHistory: analytics.streamHistory,
                totalFollowers,
                totalSubs,
                monthlyGoals: {
                    followersGoal,
                    followersCurrent: totalFollowers,
                    subsGoal,
                    subsCurrent: totalSubs
                }
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
