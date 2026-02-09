import express, { type Request, type Response } from "express";
import { getDragonflyClient } from "../../utils/databases/dragonfly.database.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";

const router = express.Router();

router.post('/:channelID', authMiddleware as any, async (req: Request, res: Response) => {
        const cacheClient = await getDragonflyClient('ValidationRoute');
        const { channelID } = req.params;
        const token = req.headers.authorization || req.headers.Authorization;

        if (!token) {
            console.error({
                error: true,
                message: "Missing token",
                channelID,
                timestamp: new Date().toISOString()
            }, true, channelID, 'validation-token');

            return res.status(400).json({
                error: true,
                message: "Missing token",
                access: false,
                status: 400
            });
        }

        let userCacheID = await cacheClient.hGet(`token:${token}`, 'id');
        let userCacheLogin = await cacheClient.hGet(`token:${token}`, 'login');

        if (!userCacheID || !userCacheLogin) {
            console.error({
                error: true,
                message: "Invalid token",
                channelID,
                timestamp: new Date().toISOString()
            }, true, channelID, 'validation-token');

            return res.status(400).json({
                error: true,
                message: "Invalid token",
                access: false,
                status: 400
            });
        }

        if (channelID === userCacheID) {
            return res.status(200).json({
                error: false,
                message: 'Validation successful',
                access: true,
                status: 200
            });
        }

        let existsAdmin = await cacheClient.sIsMember(`${channelID}:admins`, userCacheLogin);

        if (existsAdmin === 0) {
            console.error({
                error: true,
                message: "User is not an admin",
                channelID,
                userCacheLogin,
                timestamp: new Date().toISOString()
            }, true, channelID, 'validation-admin');

            return res.status(403).json({
                error: true,
                message: "User is not an admin",
                access: false,
                status: 403
            });
        }

        let exists = await cacheClient.exists(`${channelID}:admins:${userCacheID}`);

        if (exists === 0) {
            console.error({
                error: true,
                message: "User is not an admin",
                channelID,
                userCacheID,
                timestamp: new Date().toISOString()
            }, true, channelID, 'validation-admin-details');

            return res.status(403).json({
                error: true,
                message: "User is not an admin",
                access: false,
                status: 403
            });
        }

        res.status(200).json({
            error: false,
            message: 'Validation successful',
            access: true,
            status: 200
        });
    });

export const validationRoute = router;
