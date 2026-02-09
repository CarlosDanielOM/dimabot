import express, { type Request, type Response } from "express";
import { getDragonflyClient } from "../../utils/databases/dragonfly.database.js";
import { getTwitchUserByLogin } from "../../functions/users/get_user_by_login.users.js";
import { error as logError } from "../../utils/logger.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { AdminSchema } from "../../schemas/admin.schema.js";

const router = express.Router();

router.get('/:channelID', authMiddleware as any, async (req: Request, res: Response) => {
        try {
            const { channelID } = req.params;
            const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
            const query = req.query;

            const page = parseInt((query.page as string) || '1');
            const limit = parseInt((query.limit as string) || '10');
            const offset = (page - 1) * limit;
            const sort = (query.sort as string) || 'createdAt';
            const order = (query.order as string) || 'desc';
            const name = query.name as string;
            const id = query.id as string;

            if (name && id) {
                return res.status(400).json({
                    error: true,
                    message: "Cannot filter by both name and id",
                    status: 400
                });
            }

            if (sort !== 'createdAt' && sort !== 'updatedAt') {
                return res.status(400).json({
                    error: true,
                    message: "Invalid sort parameter. Must be 'createdAt' or 'updatedAt'",
                    status: 400
                });
            }

            if (order !== 'asc' && order !== 'desc') {
                return res.status(400).json({
                    error: true,
                    message: "Invalid order parameter. Must be 'asc' or 'desc'",
                    status: 400
                });
            }

            let dbQuery: any = { channelID: channelIdStr };
            if (name) {
                dbQuery.adminName = name;
            } else if (id) {
                dbQuery.adminID = id;
            }

            const sortOrder = order === 'asc' ? 1 : -1;
            const [admins, total] = await Promise.all([
                AdminSchema.find(dbQuery)
                    .sort({ [sort]: sortOrder })
                    .skip(offset)
                    .limit(limit)
                    .lean(),
                AdminSchema.countDocuments(dbQuery)
            ]);

            if (admins.length === 0) {
                return res.status(404).json({
                    error: true,
                    message: "No admins found",
                    status: 404
                });
            }

            res.status(200).json({
                error: false,
                message: 'Admins fetched successfully',
                status: 200,
                data: admins,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            });
        } catch (error) {
            console.error('Error in GET /:channelID:', {
                channelID: req.params.channelID,
                query: req.query,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString()
            });

            res.status(500).json({
                error: true,
                message: 'Internal server error',
                status: 500
            });
        }
    });

router.get('/:channelID/:adminID', authMiddleware as any, async (req: Request, res: Response) => {
        try {
            const { channelID, adminID } = req.params;
            const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
            const adminIdStr = Array.isArray(adminID) ? adminID[0] : adminID;

            const cacheClient = await getDragonflyClient();
            const adminData = await cacheClient.hGetAll(`${channelIdStr}:admins:${adminIdStr}`);

            if (!adminData || Object.keys(adminData).length === 0) {
                return res.status(404).json({
                    error: true,
                    message: "Admin not found",
                    status: 404
                });
            }

            res.status(200).json({
                error: false,
                message: 'Admin fetched successfully',
                status: 200,
                data: adminData
            });
        } catch (error) {
            console.error('Error in GET /:channelID/:adminID:', {
                channelIdStr: Array.isArray(req.params.channelID) ? req.params.channelID[0] : req.params.channelID,
                adminIdStr: Array.isArray(req.params.adminID) ? req.params.adminID[0] : req.params.adminID,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString()
            });

            res.status(500).json({
                error: true,
                message: 'Internal server error',
                status: 500
            });
        }
    });

router.post('/:channelID', authMiddleware as any, async (req: Request, res: Response) => {
        try {
            const { channelID } = req.params;
            const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
            const { channelName, adminName } = req.body;

            if (!channelName || !adminName) {
                return res.status(400).json({
                    error: true,
                    message: "Missing parameters. Both channelName and adminName are required",
                    status: 400
                });
            }

            const exists = await AdminSchema.findOne({ channelID: channelIdStr, adminName });
            if (exists) {
                return res.status(400).json({
                    error: true,
                    message: "Admin already exists",
                    status: 400
                });
            }

            const userData = await getTwitchUserByLogin(adminName);
            if (userData.error) {
                await logError(userData, { channelId: channelIdStr, destination: 'both' });
                return res.status(userData.status || 500).json(userData);
            }

            const adminData = new AdminSchema({
                channelID: channelIdStr,
                channelName,
                adminID: userData.data!.id,
                adminName,
                permissions: ['*'],
                actived: true
            });

            await adminData.save();

            const cacheClient = await getDragonflyClient();
            const adminId = userData.data!.id;
            await cacheClient.sAdd(`${channelIdStr}:admins:ids`, adminId);
            await cacheClient.sAdd(`${channelIdStr}:admins`, adminName);
            await cacheClient.hSet(`${channelIdStr}:admins:${adminId}`, 'adminID', adminId);
            await cacheClient.hSet(`${channelIdStr}:admins:${adminId}`, 'adminName', adminName);
            await cacheClient.hSet(`${channelIdStr}:admins:${adminId}`, 'channelID', channelIdStr);
            await cacheClient.hSet(`${channelIdStr}:admins:${adminId}`, 'channelName', channelName);
            await cacheClient.hSet(`${channelIdStr}:admins:${adminId}`, 'permissions', JSON.stringify(['*']));
            await cacheClient.hSet(`${channelIdStr}:admins:${adminId}`, 'actived', 'true');

            res.status(201).json({
                error: false,
                message: 'Admin added successfully',
                status: 201
            });
        } catch (error) {
            const errorChannelID = Array.isArray(req.params.channelID) ? req.params.channelID[0] : req.params.channelID;
            console.error('Error in POST /:channelID:', {
                channelID: req.params.channelID,
                body: req.body,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString()
            });

            await logError({ error: true, message: "Error adding admin", caughtError: error }, { channelId: errorChannelID, destination: 'both' });

            res.status(500).json({
                error: true,
                message: 'Internal server error',
                status: 500
            });
        }
    });

router.delete('/:channelID/:adminID', authMiddleware as any, async (req: Request, res: Response) => {
        try {
            const { channelID, adminID } = req.params;
            const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
            const adminIdStr = Array.isArray(adminID) ? adminID[0] : adminID;

            const cacheClient = await getDragonflyClient();
            const exists = await cacheClient.exists(`${channelIdStr}:admins:${adminIdStr}`);

            if (exists === 0) {
                return res.status(404).json({
                    error: true,
                    message: "Admin not found",
                    status: 404
                });
            }

            const adminData = await cacheClient.hGetAll(`${channelIdStr}:admins:${adminIdStr}`);

            await AdminSchema.findOneAndDelete({ channelID: channelIdStr, adminID: adminIdStr });
            await cacheClient.del(`${channelIdStr}:admins:${adminIdStr}`);
            await cacheClient.sRem(`${channelIdStr}:admins`, adminData.adminName as string);
            await cacheClient.sRem(`${channelIdStr}:admins:ids`, adminIdStr);

            res.status(200).json({
                error: false,
                message: 'Admin deleted successfully',
                status: 200
            });
        } catch (error) {
            const errorChannelID = Array.isArray(req.params.channelID) ? req.params.channelID[0] : req.params.channelID;
            console.error('Error in DELETE /:channelID/:adminID:', {
                channelID: req.params.channelID,
                adminID: req.params.adminID,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString()
            });

            await logError({ error: true, message: "Error deleting admin", caughtError: error }, { channelId: errorChannelID, destination: 'both' });

            res.status(500).json({
                error: true,
                message: 'Internal server error',
                status: 500
            });
        }
    });

export const adminRoute = router;
