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

const __dirname = getDirname(import.meta.url);

export const server = async (): Promise<Express.Application> => {
    try {
        let app = express();

        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
        app.use(express.static(path.join(__dirname, 'routes', 'public')));
        app.use(cors());

        // Setup file routes
        fileRoute(app);

        // Setup clip routes
        clipRoute(app);

        // Setup user routes
        userRoute(app);

        // Setup admin routes
        adminRoute(app);

        // Setup referral routes
        referralRoute(app);

        // Setup command routes
        commandRoute(app);

        // Setup eventsub routes
        eventsubRoute(app);

        // Setup auth routes
        authRoute(app);

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