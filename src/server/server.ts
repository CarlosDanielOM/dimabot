import express, { type Express } from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { getDirname } from "../utils/pollyfills.js";
import { fileRoute } from "./routes/file.route.js";
import { clipRoute } from "./routes/clip.route.js";
import { userRoute } from "./routes/user.route.js";
import { adminRoute } from "./routes/admin.route.js";
import { referralRoute } from "./routes/referral.route.js";
import { commandRoute } from "./routes/command.route.js";
import { eventsubRoute } from "./routes/eventsub.route.js";
import { authRoute } from "./routes/auth.route.js";
import { aiPersonalityRoute } from "./routes/aiPersonality.route.js";
import { rewardRoute } from "./routes/reward.route.js";
import { triggerRoute } from "./routes/trigger.route.js";
import { siteRoute } from "./routes/site.route.js";
import { polarshWebhook } from "./routes/webhooks/polarsh.webhook.js";

const __dirname = getDirname(import.meta.url);

export const server = async (): Promise<Express.Application> => {
    try {
        let app = express();

        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
        app.use(express.static(path.join(__dirname, 'routes', 'public')));
        app.use(cors());

        // Setup file routes
        app.use('/video', fileRoute);

        // Setup clip routes
        app.use('/clip', clipRoute);

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

        // Setup site routes
        app.use('/site', siteRoute);

        // Setup webhooks
        app.use('/polar/webhook', polarshWebhook);

        //? Route imports

        //? Webhooks Endpoints
        
        app.get('/config/commands/reserved', (req, res) => {

            const rawData = fs.readFileSync(path.join(__dirname, '..', 'config', 'commands', 'reservedcommands.json'), 'utf8');
            const data = JSON.parse(rawData);
            
            res.status(200).json({
                error: false,
                message: 'Commands fetched successfully',
                status: 200,
                data: data
            });
        });

        return app;

    } catch (error) {
        console.error('Error on server:', error);
        process.exit(1);
    }
}