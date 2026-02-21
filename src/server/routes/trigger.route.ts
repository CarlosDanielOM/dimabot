import express, { type Request, type Response } from 'express';
import multer from 'multer';
import { TriggerSchema, type ITrigger } from '../../schemas/trigger.schema.js';
import { TriggerFileSchema, type ITriggerFile } from '../../schemas/trigger_file.schema.js';
import TwitchStreamers from '../../classes/twitch_streamers.class.js';
import { uploadTriggerFileToS3, deleteTriggerFileFromS3 } from '../../utils/s3.js';
import { getUrl } from '../../utils/dev.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { getIO } from '../../server/websocket.js';
import { error } from '../../utils/logger.js';
import { cleanupRewardArtifacts, createRewardWithEventsub } from '../services/reward_creation.service.js';

interface MulterRequest extends Request {
    file?: Express.Multer.File;
    body: {
        triggerName?: string;
    };
}

const router = express.Router();

const acceptableMimeTypes = [
    'video/mp4', 'video/mov', 'video/avi', 'video/flv', 'video/wmv', 'video/webm', 'video/mkv',
    'image/gif', 'image/jpg', 'image/jpeg', 'image/png', 'image/bmp', 'image/tiff', 'image/svg', 'image/webp',
    'audio/mp3', 'audio/flac', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/wma', 'audio/m4a'
];

router.get('/:channelID', authMiddleware as any, async (req: Request, res: Response) => {
    try {
        const { channelID } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
        const { id, name } = req.query;

        let query: any = { channelID: channelIdStr };
        if (id) {
            query._id = id;
        } else if (name) {
            query.name = name;
        }

        const triggers = await TriggerSchema.find(query);

        return res.status(200).json({
            data: triggers,
            total: triggers.length
        });
    } catch (err) {
        await error({
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            channelID: req.params.channelID,
            query: req.query,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

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
        const { name, file, type, mediaType, cost, prompt, cooldown, volume, createRedemption } = req.body;
        const body = { ...req.body };

        const streamer = await TwitchStreamers.getTwitchAccountById(channelIdStr);
        if (!streamer) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Streamer not found',
                status: 404
            });
        }

        const fileData = await TriggerFileSchema.findOne({ name: file, channelID: channelIdStr, fileType: mediaType });
        if (!fileData) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'File not found',
                status: 400
            });
        }

        const shouldCreateRedemption = createRedemption !== false;

        if (typeof name === 'string' && name.trim().length > 0) {
            body.title = name;
        }
        delete body.name;
        if (!body.rewardType) {
            body.rewardType = 'trigger';
        }

        let rewardData: any = null;

        if (shouldCreateRedemption) {
            const correlationId = `trigger-route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const result = await createRewardWithEventsub({
                channelID: channelIdStr,
                body,
                correlationId
            });

            if (result.error || !result.data) {
                await error({
                    error: 'Bad Request',
                    message: 'Error creating trigger',
                    status: result.status,
                    response: result
                }, { channelId: channelIdStr, destination: 'both' });
                return res.status(result.status).json({
                    error: true,
                    message: result.message,
                    status: result.status
                });
            }

            rewardData = result.data;

            if (!rewardData.rewardID || !rewardData.eventsubID) {
                if (rewardData.rewardID) {
                    await cleanupRewardArtifacts(channelIdStr, rewardData.rewardID, rewardData.eventsubID, correlationId);
                }

                await error({
                    error: 'Internal Server Error',
                    message: 'Reward created with invalid state',
                    status: 500,
                    rewardData: {
                        rewardID: rewardData.rewardID,
                        eventsubID: rewardData.eventsubID
                    }
                }, { channelId: channelIdStr, destination: 'both' });

                return res.status(500).json({
                    error: true,
                    message: 'Failed to create trigger reward state',
                    status: 500
                });
            }
        }

        const newTrigger = new TriggerSchema({
            name: name,
            channel: streamer.name,
            channelID: channelIdStr,
            rewardID: rewardData?.rewardID || '',
            file,
            type,
            mediaType,
            isEnabled: typeof rewardData?.isEnabled === 'boolean' ? rewardData.isEnabled : true,
            cost,
            cooldown,
            prompt: prompt ?? '',
            volume,
            fileID: fileData._id
        });

        try {
            await newTrigger.save();
        } catch (saveError) {
            if (shouldCreateRedemption && rewardData?.rewardID) {
                await cleanupRewardArtifacts(channelIdStr, rewardData.rewardID, rewardData.eventsubID, `trigger-route-cleanup-${Date.now()}`);
            }

            await error({
                error: 'Internal Server Error',
                message: 'Error saving trigger',
                status: 500,
                saveError: saveError instanceof Error ? saveError.message : String(saveError)
            }, { channelId: channelIdStr, destination: 'both' });
            return res.status(500).json({
                error: 'Internal Server Error',
                message: 'Error saving trigger',
                status: 500
            });
        }

        return res.status(201).json({
            data: newTrigger,
            status: 201
        });
    } catch (err) {
        await error({
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            channelID: req.params.channelID,
            body: req.body,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

        res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.patch('/:channelID/:triggerID', authMiddleware as any, async (req: Request, res: Response) => {
    try {
        const { channelID, triggerID } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
        const triggerIdStr = Array.isArray(triggerID) ? triggerID[0] : triggerID;
        const { name, prompt, cost, cooldown, volume, isEnabled } = req.body;
        const body = { ...req.body };

        const trigger = await TriggerSchema.findOne({ channelID: channelIdStr, _id: triggerIdStr });
        if (!trigger) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Trigger not found',
                status: 404
            });
        }

        if (typeof name === 'string' && name.trim().length > 0) {
            body.title = name;
        }
        delete body.name;

        if (prompt === undefined) {
            delete body.prompt;
        }

        const streamerHeader = await TwitchStreamers.getTwitchAccountById(channelIdStr);
        if (!streamerHeader) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Streamer not found',
                status: 404
            });
        }

        const response = await fetch(`${getUrl()}/rewards/${channelIdStr}/${trigger.rewardID}`, {
            method: 'PATCH',
            headers: {
                'Authorization': streamerHeader.access_token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        const result = await response.json();
        if (result.error) {
            await error({
                error: 'Bad Request',
                message: 'Error updating trigger',
                status: 400,
                response: result
            }, { channelId: channelIdStr, destination: 'both' });
            return res.status(result.status).json(result);
        }

        const rewardData = result.data;

        try {
            const updateDoc: Partial<ITrigger> = {};
            if (typeof name === 'string' && name.trim().length > 0) {
                updateDoc.name = name;
            }
            if (typeof cost === 'number') {
                updateDoc.cost = cost;
            }
            if (typeof prompt === 'string') {
                updateDoc.prompt = prompt;
            }
            if (typeof cooldown === 'number') {
                updateDoc.cooldown = cooldown;
            }
            if (typeof volume === 'number') {
                updateDoc.volume = volume;
            }
            if (typeof isEnabled === 'boolean') {
                updateDoc.isEnabled = isEnabled;
            }

            const updateResult = await TriggerSchema.findByIdAndUpdate(triggerIdStr, updateDoc, { new: true });

            return res.status(200).json({
                data: updateResult,
                status: 200
            });
        } catch (updateError) {
            await error({
                error: 'Internal Server Error',
                message: 'Error updating trigger',
                status: 500,
                updateError: updateError instanceof Error ? updateError.message : String(updateError)
            }, { channelId: channelIdStr, destination: 'both' });
            return res.status(500).json({
                error: 'Internal Server Error',
                message: 'Error updating trigger',
                status: 500
            });
        }
    } catch (err) {
        await error({
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            channelID: req.params.channelID,
            triggerID: req.params.triggerID,
            body: req.body,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

        res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.delete('/:channelID/:triggerID', authMiddleware as any, async (req: Request, res: Response) => {
    try {
        const { channelID, triggerID } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
        const triggerIdStr = Array.isArray(triggerID) ? triggerID[0] : triggerID;

        const trigger = await TriggerSchema.findOne({ channelID: channelIdStr, _id: triggerIdStr });
        if (!trigger) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Trigger not found',
                status: 404
            });
        }

        if (trigger.rewardID && trigger.rewardID.trim() !== '') {
            const streamerHeader = await TwitchStreamers.getTwitchAccountById(channelIdStr);
            if (!streamerHeader) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'Streamer not found',
                    status: 404
                });
            }

            const response = await fetch(`${getUrl()}/rewards/${channelIdStr}/${trigger.rewardID}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': streamerHeader.access_token,
                    'Content-Type': 'application/json'
                }
            });

            const result = await response.json();
            if (result.error) {
                await error({
                    error: 'Bad Request',
                    message: 'Error deleting trigger',
                    status: 400,
                    response: result
                }, { channelId: channelIdStr, destination: 'both' });
                return res.status(400).json(result);
            }
        }

        try {
            await TriggerSchema.deleteOne({ channelID: channelIdStr, _id: triggerIdStr });
        } catch (deleteError) {
            await error({
                error: 'Internal Server Error',
                message: 'Error deleting trigger',
                status: 500,
                deleteError: deleteError instanceof Error ? deleteError.message : String(deleteError)
            }, { channelId: channelIdStr, destination: 'both' });
            return res.status(500).json({
                error: 'Internal Server Error',
                message: 'Error deleting trigger',
                status: 500
            });
        }

        return res.status(200).json({
            data: trigger,
            status: 200
        });
    } catch (err) {
        await error({
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            channelID: req.params.channelID,
            triggerID: req.params.triggerID,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

        res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.post('/:channelID/send', authMiddleware as any, async (req: Request, res: Response) => {
    try {
        const io = getIO();
        const { channelID } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
        const body = req.body;

        if (!io) {
            return res.status(500).json({
                error: true,
                message: 'Websocket not initialized',
                status: 500
            });
        }

        const namespacePath = `/overlays/triggers/${channelIdStr}`;
        const namespace = io.of(namespacePath);
        const sockets = await namespace.fetchSockets();

        if (sockets.length === 0) {
            await error({
                error: 'No Connected Trigger Clients',
                message: 'No trigger overlay clients connected',
                status: 409,
                channelID: channelIdStr,
                namespacePath
            }, { channelId: channelIdStr, destination: 'both' });

            return res.status(409).json({
                error: true,
                message: 'No trigger overlay clients connected',
                status: 409,
                data: {
                    activeConnections: 0,
                    namespace: namespacePath
                }
            });
        }

        try {
            namespace.emit('trigger', body);
        } catch (emitError) {
            await error({
                error: 'Internal Server Error',
                message: 'Error emitting trigger',
                status: 500,
                emitError: emitError instanceof Error ? emitError.message : String(emitError)
            }, { channelId: channelIdStr, destination: 'both' });
            return res.status(500).json({
                error: true,
                message: 'Error emitting trigger',
                status: 500
            });
        }

        return res.status(200).json({
            error: false,
            message: 'Trigger sent',
            status: 200,
            data: {
                activeConnections: sockets.length,
                namespace: namespacePath
            }
        });
    } catch (err) {
        await error({
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            channelID: req.params.channelID,
            body: req.body,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

        res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.post('/:channelID/upload', authMiddleware as any, async (req: MulterRequest, res: Response) => {
    const { channelID } = req.params;
    const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;

    const streamer = await TwitchStreamers.getTwitchAccountById(channelIdStr);
    if (!streamer) {
        return res.status(404).json({
            error: 'Not Found',
            message: 'Streamer not found',
            status: 404
        });
    }

    if (req.body.triggerName) {
        const validNameRegex = /^[a-zA-Z0-9 ]+$/;
        if (!validNameRegex.test(req.body.triggerName)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Filename can only contain letters (a-z, A-Z), numbers (0-9), and spaces',
                status: 400
            });
        }
    }

    let maxFileSizeMB = 5;
    if (streamer.plan_tier === 'premium') {
        maxFileSizeMB = 10;
    } else if (streamer.plan_tier === 'pro') {
        maxFileSizeMB = 20;
    }

    const MAX_FILE_SIZE = maxFileSizeMB * 1024 * 1024;

    const storage = multer.memoryStorage();
    const fileFilter = async (req: any, file: any, cb: any) => {
        if (acceptableMimeTypes.includes(file.mimetype)) {
            const exists = await TriggerFileSchema.exists({
                name: req.body.triggerName,
                fileType: file.mimetype,
                channelID: channelIdStr
            });
            if (exists) {
                await error({
                    error: 'File already exists',
                    message: `File ${req.body.triggerName} already exists from ${streamer.name}`,
                    status: 400
                }, { channelId: channelIdStr, destination: 'both' });
                cb(null, false);
            } else {
                cb(null, true);
            }
        } else {
            await error({
                error: 'Invalid file type',
                message: `File type ${file.mimetype} not allowed from ${streamer.name}`,
                status: 400
            }, { channelId: channelIdStr, destination: 'both' });
            cb(null, false);
        }
    };

    multer({
        storage,
        fileFilter,
        limits: { fileSize: MAX_FILE_SIZE }
    }).single('trigger')(req as any, res as any, async (err: any) => {
        if (err) {
            await error({
                error: 'Bad Request',
                message: 'Error uploading file',
                status: 400,
                multerError: err instanceof Error ? err.message : String(err)
            }, { channelId: channelIdStr, destination: 'both' });
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Error uploading file',
                status: 400
            });
        }

        if (!req.file) {
            await error({
                error: 'Bad Request',
                message: 'File type not allowed or file already exists',
                status: 400,
                channelID: channelIdStr
            }, { channelId: channelIdStr, destination: 'both' });
            return res.status(400).json({
                error: 'Bad Request',
                message: 'File type not allowed or file already exists',
                status: 400
            });
        }

        const exists = await TriggerFileSchema.exists({
            name: req.body.triggerName,
            fileType: req.file.mimetype,
            channelID: channelIdStr
        });

        if (exists) {
            await error({
                error: 'Bad Request',
                message: 'File name already exists',
                status: 400,
                channelID: channelIdStr
            }, { channelId: channelIdStr, destination: 'both' });
            return res.status(400).json({
                error: 'Bad Request',
                message: 'File name already exists',
                status: 400
            });
        }

        try {
            const filename = `${req.body.triggerName}.${req.file.mimetype.split('/')[1]}`;
            const s3SafeFilename = filename.replace(/\s+/g, '_');
            const s3Key = `${channelIdStr}/triggers/${s3SafeFilename}`;
            let s3Url;
            try {
                s3Url = await uploadTriggerFileToS3(channelIdStr, req.file.buffer, req.file.mimetype, s3Key);
            } catch (s3err) {
                await error({
                    error: 'Internal Server Error',
                    message: 'Error uploading file to S3',
                    status: 500,
                    s3Error: s3err instanceof Error ? s3err.message : String(s3err)
                }, { channelId: channelIdStr, destination: 'both' });
                return res.status(500).json({
                    error: 'Internal Server Error',
                    message: 'Error uploading file to S3',
                    status: 500
                });
            }

            const fileData = {
                name: req.body.triggerName,
                fileName: s3SafeFilename,
                fileSize: req.file.size,
                fileType: req.file.mimetype,
                fileUrl: s3Url,
                channel: streamer.name,
                channelID: channelIdStr
            };

            const newFile = new TriggerFileSchema(fileData);

            try {
                await newFile.save();
            } catch (saveError) {
                await error({
                    error: 'Internal Server Error',
                    message: 'Error saving file',
                    status: 500,
                    saveError: saveError instanceof Error ? saveError.message : String(saveError)
                }, { channelId: channelIdStr, destination: 'both' });
                return res.status(500).json({
                    error: 'Internal Server Error',
                    message: 'Error saving file',
                    status: 500
                });
            }

            return res.status(201).json({
                data: fileData,
                status: 201
            });
        } catch (err) {
            await error({
                error: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined,
                channelID: channelIdStr,
                timestamp: new Date().toISOString()
            }, { destination: 'both' });

            res.status(500).json({
                error: true,
                message: 'Internal server error',
                status: 500
            });
        }
    });
});

router.get('/files/:channelID', authMiddleware as any, async (req: Request, res: Response) => {
    try {
        const { channelID } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
        const { id, name } = req.query;

        let query: any = { channelID: channelIdStr };
        if (id) {
            query._id = id;
        } else if (name) {
            query.name = name;
        }

        const files = await TriggerFileSchema.find(query);

        return res.status(200).json({
            data: files,
            total: files.length
        });
    } catch (err) {
        await error({
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            channelID: req.params.channelID,
            query: req.query,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

        res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.delete('/files/:channelID/:fileID', authMiddleware as any, async (req: Request, res: Response) => {
    try {
        const { channelID, fileID } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
        const fileIdStr = Array.isArray(fileID) ? fileID[0] : fileID;

        const exists = await TriggerSchema.exists({ fileID: fileIdStr });
        if (exists) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'File in use',
                status: 400
            });
        }

        const file = await TriggerFileSchema.findOne({ channelID: channelIdStr, _id: fileIdStr });
        if (!file) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'File not found',
                status: 404
            });
        }

        try {
            if (file.fileUrl.includes('https://api.domdimabot.com/media')) {
                await TriggerFileSchema.deleteOne({ channelID: channelIdStr, _id: fileIdStr });
                return res.status(200).json({
                    data: file,
                    status: 200
                });
            }

            const s3SafeFilename = file.fileName.replace(/\s+/g, '_');
            const s3Key = `${channelIdStr}/triggers/${s3SafeFilename}`;
            await deleteTriggerFileFromS3(channelIdStr, s3Key);
            await TriggerFileSchema.deleteOne({ channelID: channelIdStr, _id: fileIdStr });
        } catch (deleteError) {
            await error({
                error: 'Internal Server Error',
                message: 'Error deleting file',
                status: 500,
                deleteError: deleteError instanceof Error ? deleteError.message : String(deleteError)
            }, { channelId: channelIdStr, destination: 'both' });
            return res.status(500).json({
                error: 'Internal Server Error',
                message: 'Error deleting file',
                status: 500
            });
        }

        return res.status(200).json({
            data: file,
            status: 200
        });
    } catch (err) {
        await error({
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            channelID: req.params.channelID,
            fileID: req.params.fileID,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

        res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

export const triggerRoute = router;
