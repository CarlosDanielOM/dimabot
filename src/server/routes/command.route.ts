import express, { type Request, type Response } from "express";
import { getDragonflyClient } from "../../utils/databases/dragonfly.database.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { CommandsSchema, type ICommands } from "../../schemas/commands.schema.js";

export const commandRoute = (app: express.Application): void => {
    app.get('/', async (req: Request, res: Response) => {
        try {
            const query = req.query;
            const limit = parseInt((query.limit as string) || '100');
            const skip = parseInt((query.skip as string) || '0');

            const commands = await CommandsSchema.find().skip(skip).limit(limit).lean();

            res.send({
                error: false,
                message: 'Commands fetched',
                commands: commands,
                status: 200,
                total: commands.length
            });
        } catch (error) {
            console.error('Error in GET /:', {
                query: req.query,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString()
            });

            res.status(500).send({
                error: true,
                message: 'Error fetching commands',
                status: 500
            });
        }
    });

    app.get('/:channelID', async (req: Request, res: Response) => {
        try {
            const { channelID } = req.params;
            const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
            const query = req.query;
            const limit = parseInt((query.limit as string) || '100');
            const skip = parseInt((query.skip as string) || '0');

            const commands = await CommandsSchema.find({ channelID: channelIdStr })
                .skip(skip)
                .limit(limit)
                .lean();

            res.send({
                error: false,
                message: 'Commands fetched from database',
                commands: commands,
                status: 200,
                total: commands.length
            });
        } catch (error) {
            console.error('Error in GET /:channelID:', {
                channelID: req.params.channelID,
                query: req.query,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString()
            });

            res.status(500).send({
                error: true,
                message: 'Error fetching commands',
                status: 500
            });
        }
    });

    app.post('/:channelID', authMiddleware as any, async (req: Request, res: Response) => {
        try {
            const { channelID } = req.params;
            const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
            const body = req.body;

            if (!body.name || !body.cmd || !body.func || !body.message || !body.channel) {
                return res.status(400).send({
                    error: true,
                    message: 'Missing required fields',
                    status: 400
                });
            }

            const existingCommand = await CommandsSchema.findOne({
                channelID: channelIdStr,
                cmd: body.cmd
            });

            if (existingCommand) {
                return res.status(409).send({
                    error: true,
                    message: 'Command already exists',
                    command: existingCommand,
                    status: 409
                });
            }

            const newCommand = new CommandsSchema({
                name: body.name,
                cmd: body.cmd,
                func: body.func,
                message: body.message,
                responses: body.responses ?? [],
                type: body.type ?? 'command',
                reserved: body.reserved ?? false,
                description: body.description ?? '',
                cooldown: body.cooldown ?? 10,
                enabled: body.enabled ?? true,
                userLevelName: body.userLevelName ?? 'everyone',
                userLevel: body.userLevel ?? 1,
                channelID: channelIdStr,
                channel: body.channel,
            });

            await newCommand.save();

            const cacheClient = await getDragonflyClient();
            await cacheClient.del(`${channelIdStr}:commands:${body.cmd}`);
            await cacheClient.del(`${channelIdStr}:commands:${body.name}`);

            res.send({
                error: false,
                message: 'Command created',
                command: newCommand,
                status: 200
            });
        } catch (error) {
            console.error('Error in POST /:channelID:', {
                channelID: req.params.channelID,
                body: req.body,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString()
            });

            res.status(500).send({
                error: true,
                message: 'Error creating command',
                status: 500
            });
        }
    });

    app.put('/:channelID/:commandID', authMiddleware as any, async (req: Request, res: Response) => {
        try {
            const { channelID, commandID } = req.params;
            const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
            const commandIdStr = Array.isArray(commandID) ? commandID[0] : commandID;
            const body = req.body;

            const cacheClient = await getDragonflyClient();

            const command = await CommandsSchema.findOne({
                channelID: channelIdStr,
                _id: commandIdStr
            });

            if (!command) {
                return res.status(404).send({
                    error: true,
                    message: 'Command not found for this channel',
                    status: 404
                });
            }

            if (command.reserved) {
                return res.status(403).send({
                    error: true,
                    message: 'Cannot update reserved command',
                    status: 403
                });
            }

            const updatedCommand = await CommandsSchema.findOneAndUpdate(
                { channelID: channelIdStr, _id: commandIdStr },
                body,
                { new: true }
            );

            if (!updatedCommand) {
                return res.status(404).send({
                    error: true,
                    message: 'Command not found for this channel',
                    status: 404
                });
            }

            await cacheClient.del(`${channelIdStr}:commands:${updatedCommand.cmd}`);

            res.send({
                error: false,
                message: 'Command updated',
                command: updatedCommand,
                status: 200
            });
        } catch (error) {
            console.error('Error in PUT /:channelID/:commandID:', {
                channelID: req.params.channelID,
                commandID: req.params.commandID,
                body: req.body,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString()
            });

            res.status(500).send({
                error: true,
                message: 'Error updating command',
                status: 500
            });
        }
    });

    app.delete('/:channelID/:commandID', authMiddleware as any, async (req: Request, res: Response) => {
        try {
            const { channelID, commandID } = req.params;
            const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
            const commandIdStr = Array.isArray(commandID) ? commandID[0] : commandID;

            const cacheClient = await getDragonflyClient();

            const command = await CommandsSchema.findOne({
                channelID: channelIdStr,
                _id: commandIdStr
            });

            if (!command) {
                return res.status(404).send({
                    error: true,
                    message: 'Command not found for this channel',
                    status: 404
                });
            }

            if (command.reserved) {
                return res.status(403).send({
                    error: true,
                    message: 'Cannot delete reserved command',
                    status: 403
                });
            }

            const deletedCommand = await CommandsSchema.findOneAndDelete({
                channelID: channelIdStr,
                _id: commandIdStr
            });

            if (!deletedCommand) {
                return res.status(404).send({
                    error: true,
                    message: 'Command not found for this channel',
                    status: 404
                });
            }

            await cacheClient.del(`${channelIdStr}:commands:${deletedCommand.cmd}`);

            res.send({
                error: false,
                message: 'Command deleted',
                command: deletedCommand,
                status: 200
            });
        } catch (error) {
            console.error('Error in DELETE /:channelID/:commandID:', {
                channelID: req.params.channelID,
                commandID: req.params.commandID,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString()
            });

            res.status(500).send({
                error: true,
                message: 'Error deleting command',
                status: 500
            });
        }
    });
};
