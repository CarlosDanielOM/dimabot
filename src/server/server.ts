import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import path from "path";
import { getDirname } from "../utils/pollyfills.js";
import { fileRoute } from "./routes/file.route.js";
import { mediaRoute } from './routes/media.route.js';
import { clipRoute } from "./routes/clip.route.js";
import { speechRoute } from "./routes/speech.route.js";
import { userRoute } from "./routes/user.route.js";
import { adminRoute } from "./routes/admin.route.js";
import { referralRoute } from "./routes/referral.route.js";
import { commandRoute } from "./routes/command.route.js";
import { eventsubRoute } from "./routes/eventsub.route.js";
import { authRoute } from "./routes/auth.route.js";
import { aiPersonalityRoute } from "./routes/aiPersonality.route.js";
import { rewardRoute } from "./routes/reward.route.js";
import { triggerRoute } from "./routes/trigger.route.js";
import { overlayRoute } from "./routes/overlay.route.js";
import { siteRoute } from "./routes/site.route.js";
import { polarshWebhook } from "./routes/webhooks/polarsh.webhook.js";
import { billingRoute } from "./routes/billing.route.js";
import { dashboardRoute } from "./routes/dashboard.route.js";
import { adminSiteRoute } from "./routes/admin_site.route.js";
import { analyticsRoute } from "./routes/analytics.route.js";
import { timerRoute } from "./routes/timer.route.js";
import { getSiteAnalyticsSnapshot } from "../utils/siteanalytics.js";
import { getReservedCommandsPayload } from "./services/command_defaults.service.js";

const __dirname = getDirname(import.meta.url);

export const server = async (): Promise<Express.Application> => {
    try {
        let app = express();

        // Setup webhooks first (raw body required for signature validation)
        app.use('/polar/webhook', polarshWebhook);

        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
        app.use(express.static(path.join(__dirname, 'routes', 'public')));
        app.use(cors());

        // Setup file routes
        app.use('/video', fileRoute);

        // Setup media routes
        app.use('/media', mediaRoute);

        // Setup clip routes
        app.use('/clip', clipRoute);

        // Setup speech routes
        app.use('/speech', speechRoute);

        // Setup auth routes
        app.use('/auth', authRoute);

        // Setup user routes
        app.use('/users', userRoute);

        // Setup admin routes
        app.use('/admins', adminRoute);

        // Setup referral routes
        app.use('/referrals', referralRoute);

        // Setup command routes
        app.use('/commands', commandRoute);

        // Setup eventsub routes
        app.use('/eventsubs', eventsubRoute);

        // Setup aiPersonality routes
        app.use('/ai-personality', aiPersonalityRoute);

        // Setup reward routes
        app.use('/rewards', rewardRoute);
        
        // Setup trigger routes
        app.use('/triggers', triggerRoute);

        // Setup public overlay routes
        app.use('/', overlayRoute);

        // Setup site routes
        app.use('/site', siteRoute);

        // Setup billing routes
        app.use('/billing', billingRoute);

        // Setup dashboard routes
        app.use('/dashboard', dashboardRoute);

        // Setup analytics routes
        app.use('/analytics', analyticsRoute);

        // Setup timers routes
        app.use('/timers', timerRoute);

        // Setup internal admin site routes
        app.use('/admin-site', adminSiteRoute);

        //? Route imports

        //? Webhooks Endpoints
        
        app.get('/config/commands/reserved', (req, res) => {
            const language = typeof req.query.language === 'string' ? req.query.language : undefined;
            const data = getReservedCommandsPayload(language);
            
            res.status(200).json({
                error: false,
                message: 'Commands fetched successfully',
                status: 200,
                data: data
            });
        });

        app.get('/config/site/analytics', async (_req: Request, res: Response) => {
            try {
                const snapshot = await getSiteAnalyticsSnapshot();

                return res.status(200).json({
                    error: false,
                    message: 'Site analytics fetched successfully',
                    status: 200,
                    data: snapshot
                });
            } catch (error) {
                console.error('Error in GET /config/site/analytics:', {
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

        app.get('/config/site/analytics/stream', async (_req: Request, res: Response) => {
            try {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.flushHeaders();

                const sendSnapshot = async (): Promise<void> => {
                    const snapshot = await getSiteAnalyticsSnapshot();
                    res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
                };

                await sendSnapshot();

                const interval = setInterval(() => {
                    void sendSnapshot().catch((error) => {
                        console.error('Error sending SSE analytics snapshot:', {
                            error: error instanceof Error ? error.message : String(error),
                            timestamp: new Date().toISOString()
                        });
                    });
                }, 500);
                interval.unref?.();

                const heartbeat = setInterval(() => {
                    res.write(': keep-alive\n\n');
                }, 30000);
                heartbeat.unref?.();

                res.on('close', () => {
                    clearInterval(interval);
                    clearInterval(heartbeat);
                    res.end();
                });
            } catch (error) {
                console.error('Error in GET /config/site/analytics/stream:', {
                    error: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                    timestamp: new Date().toISOString()
                });

                if (!res.headersSent) {
                    return res.status(500).json({
                        error: true,
                        message: 'Internal server error',
                        status: 500
                    });
                }

                res.end();
            }
        });

        return app;

    } catch (error) {
        console.error('Error on server:', error);
        process.exit(1);
    }
}
