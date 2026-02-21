import express, { type Request, type Response } from "express";
import { getDragonflyClient } from "../../utils/databases/dragonfly.database.js";
import { error as logError } from "../../utils/logger.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { AdminSchema } from "../../schemas/admin.schema.js";
import UsersSchema from "../../schemas/users.schema.js";

interface AdminRequest extends Request {
    user?: {
        id: string;
        login: string;
        display_name: string;
        profile_image_url?: string;
    };
}

async function getAccess(requesterID: string, channelID: string): Promise<'owner' | 'admin' | 'none'> {
    if (requesterID === channelID) {
        return 'owner';
    }

    const admin = await AdminSchema.findOne({
        channelID,
        adminID: requesterID,
        actived: true,
        permissions: { $in: ['*', 'admins:view', 'admins:manage'] }
    }).lean();

    if (!admin) {
        return 'none';
    }

    return 'admin';
}

const router = express.Router();

router.get('/:channelID', authMiddleware as any, async (req: AdminRequest, res: Response) => {
        try {
            const { channelID } = req.params;
            const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
            const requesterID = req.user?.id;
            if (!requesterID) {
                return res.status(401).json({
                    error: true,
                    message: 'Unauthorized',
                    status: 401
                });
            }

            const access = await getAccess(requesterID, channelIdStr);
            if (access === 'none') {
                return res.status(403).json({
                    error: true,
                    message: 'You do not have permission to view admins for this channel',
                    status: 403
                });
            }

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
                return res.status(200).json({
                    error: false,
                    message: 'No admins found',
                    status: 200,
                    data: [],
                    pagination: {
                        page,
                        limit,
                        total: 0,
                        totalPages: 0
                    }
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

router.get('/:channelID/search', authMiddleware as any, async (req: AdminRequest, res: Response) => {
        try {
            const { channelID } = req.params;
            const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
            const requesterID = req.user?.id;
            const queryRaw = (req.query.query as string | undefined) ?? '';
            const query = queryRaw.trim().toLowerCase();

            if (!requesterID) {
                return res.status(401).json({
                    error: true,
                    message: 'Unauthorized',
                    status: 401
                });
            }

            if (requesterID !== channelIdStr) {
                return res.status(403).json({
                    error: true,
                    message: 'Only the channel owner can search users to add admins',
                    status: 403
                });
            }

            if (query.length < 2) {
                return res.status(400).json({
                    error: true,
                    message: 'Query must contain at least 2 characters',
                    status: 400
                });
            }

            const existingAdmins = await AdminSchema.find({ channelID: channelIdStr })
                .select('adminID')
                .lean();

            const existingAdminIDs = new Set(existingAdmins.map((admin) => admin.adminID));

            const users = await UsersSchema.find({
                accounts: {
                    $elemMatch: {
                        type: 'twitch',
                        name: { $regex: query, $options: 'i' }
                    }
                }
            })
                .select('accounts')
                .limit(15)
                .lean();

            const deduped = new Map<string, { id: string; login: string; display_name: string }>();

            for (const user of users) {
                const twitchAccount = user.accounts.find((account) => account.type === 'twitch');
                if (!twitchAccount || !twitchAccount.id || !twitchAccount.name) {
                    continue;
                }

                if (twitchAccount.id === channelIdStr || existingAdminIDs.has(twitchAccount.id)) {
                    continue;
                }

                if (!deduped.has(twitchAccount.id)) {
                    deduped.set(twitchAccount.id, {
                        id: twitchAccount.id,
                        login: twitchAccount.name,
                        display_name: twitchAccount.name
                    });
                }
            }

            const result = Array.from(deduped.values());

            return res.status(200).json({
                error: false,
                message: 'Users fetched successfully',
                status: 200,
                data: result
            });
        } catch (error) {
            console.error('Error in GET /:channelID/search:', {
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

router.get('/:channelID/:adminID', authMiddleware as any, async (req: AdminRequest, res: Response) => {
        try {
            const { channelID, adminID } = req.params;
            const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
            const adminIdStr = Array.isArray(adminID) ? adminID[0] : adminID;
            const requesterID = req.user?.id;

            if (!requesterID) {
                return res.status(401).json({
                    error: true,
                    message: 'Unauthorized',
                    status: 401
                });
            }

            const access = await getAccess(requesterID, channelIdStr);
            if (access === 'none') {
                return res.status(403).json({
                    error: true,
                    message: 'You do not have permission to view this admin',
                    status: 403
                });
            }

            const cacheClient = await getDragonflyClient();
            const adminData = await cacheClient.hGetAll(`${channelIdStr}:admins:${adminIdStr}`);

            if (!adminData || Object.keys(adminData).length === 0) {
                const adminFromDB = await AdminSchema.findOne({
                    channelID: channelIdStr,
                    adminID: adminIdStr
                }).lean();

                if (!adminFromDB) {
                    return res.status(404).json({
                        error: true,
                        message: "Admin not found",
                        status: 404
                    });
                }

                return res.status(200).json({
                    error: false,
                    message: 'Admin fetched successfully',
                    status: 200,
                    data: adminFromDB
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

router.post('/:channelID', authMiddleware as any, async (req: AdminRequest, res: Response) => {
        try {
            const { channelID } = req.params;
            const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
            const requesterID = req.user?.id;
            const { channelName, adminName } = req.body;

            if (!requesterID) {
                return res.status(401).json({
                    error: true,
                    message: 'Unauthorized',
                    status: 401
                });
            }

            if (requesterID !== channelIdStr) {
                return res.status(403).json({
                    error: true,
                    message: 'Only the channel owner can add admins',
                    status: 403
                });
            }

            if (!channelName || !adminName) {
                return res.status(400).json({
                    error: true,
                    message: "Missing parameters. Both channelName and adminName are required",
                    status: 400
                });
            }

            const normalizedAdminName = String(adminName).trim().toLowerCase();
            if (!normalizedAdminName) {
                return res.status(400).json({
                    error: true,
                    message: "Invalid adminName",
                    status: 400
                });
            }

            const matchedUser = await UsersSchema.findOne({
                accounts: {
                    $elemMatch: {
                        type: 'twitch',
                        name: normalizedAdminName
                    }
                }
            })
                .select('accounts')
                .lean();

            if (!matchedUser) {
                return res.status(404).json({
                    error: true,
                    message: 'Registered user not found',
                    status: 404
                });
            }

            const twitchAccount = matchedUser.accounts.find(
                (account) => account.type === 'twitch' && account.name === normalizedAdminName
            );

            if (!twitchAccount || !twitchAccount.id || !twitchAccount.name) {
                return res.status(404).json({
                    error: true,
                    message: 'Registered user not found',
                    status: 404
                });
            }

            const exists = await AdminSchema.findOne({ channelID: channelIdStr, adminID: twitchAccount.id });
            if (exists) {
                return res.status(400).json({
                    error: true,
                    message: "Admin already exists",
                    status: 400
                });
            }

            const adminData = new AdminSchema({
                channelID: channelIdStr,
                channelName,
                adminID: twitchAccount.id,
                adminName: twitchAccount.name,
                permissions: ['*'],
                actived: true
            });

            await adminData.save();

            const cacheClient = await getDragonflyClient();
            const adminId = twitchAccount.id;
            await cacheClient.sAdd(`${channelIdStr}:admins:ids`, adminId);
            await cacheClient.sAdd(`${channelIdStr}:admins`, twitchAccount.name);
            await cacheClient.hSet(`${channelIdStr}:admins:${adminId}`, 'adminID', adminId);
            await cacheClient.hSet(`${channelIdStr}:admins:${adminId}`, 'adminName', twitchAccount.name);
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

router.delete('/:channelID/:adminID', authMiddleware as any, async (req: AdminRequest, res: Response) => {
        try {
            const { channelID, adminID } = req.params;
            const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
            const adminIdStr = Array.isArray(adminID) ? adminID[0] : adminID;
            const requesterID = req.user?.id;

            if (!requesterID) {
                return res.status(401).json({
                    error: true,
                    message: 'Unauthorized',
                    status: 401
                });
            }

            if (requesterID !== channelIdStr) {
                return res.status(403).json({
                    error: true,
                    message: 'Only the channel owner can remove admins',
                    status: 403
                });
            }

            const cacheClient = await getDragonflyClient();
            const adminData = await AdminSchema.findOne({ channelID: channelIdStr, adminID: adminIdStr }).lean();

            if (!adminData) {
                return res.status(404).json({
                    error: true,
                    message: "Admin not found",
                    status: 404
                });
            }

            await AdminSchema.findOneAndDelete({ channelID: channelIdStr, adminID: adminIdStr });
            await cacheClient.del(`${channelIdStr}:admins:${adminIdStr}`);
            await cacheClient.sRem(`${channelIdStr}:admins`, adminData.adminName);
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
