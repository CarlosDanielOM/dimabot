import express, { type Request, type Response } from "express";
import mongoose from "mongoose";
import EventsubSchema from "../../schemas/eventsub.schema.js";
import { subscribeTwitchEvent, unsubscribeTwitchEvent } from "../../utils/eventsub.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";

export const eventsubRoute = (app: express.Application): void => {
    app.use(authMiddleware as any);

    app.get('/:channelID', async (req: Request, res: Response) => {
        try {
            const { channelID } = req.params;
            const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
            const query = req.query;
            const type = query.type as string | null;
            const id = query.id as string | null;

            let eventsub;

            if (id) {
                if (!mongoose.isValidObjectId(id)) {
                    return res.status(400).send({
                        error: 'Invalid ID',
                        message: 'ID is not a valid ObjectID',
                        status: 400
                    });
                }
                eventsub = await EventsubSchema.find({ channelID: channelIdStr, _id: id });
            } else if (type) {
                eventsub = await EventsubSchema.find({ channelID: channelIdStr, type });
            } else {
                eventsub = await EventsubSchema.find({ channelID: channelIdStr });
            }

            if (!eventsub || eventsub.length === 0) {
                return res.status(404).send({
                    error: 'Not Found',
                    message: 'No eventsub found',
                    status: 404
                });
            }

            return res.status(200).send({
                error: false,
                data: eventsub,
                total: eventsub.length
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
                message: 'Internal server error',
                status: 500
            });
        }
    });

    app.post('/:channelID', async (req: Request, res: Response) => {
        try {
            const { channelID } = req.params;
            const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
            const body = req.body;
            const type = body.type as string;
            const version = body.version as string;
            const condition = body.condition;
            const config = body.config ?? null;

            if (!type || !version || !condition) {
                return res.status(400).send({
                    error: 'Bad Request',
                    message: 'Missing type, version or condition',
                    status: 400
                });
            }

            const eventsub = await subscribeTwitchEvent(channelIdStr, type, version, condition, config);

            if (!eventsub || (eventsub as any).error) {
                return res.status(400).send({
                    error: 'Bad Request',
                    message: 'Failed to create eventsub',
                    status: 400
                });
            }

            return res.status(201).send({
                error: false,
                data: eventsub
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
                message: 'Internal server error',
                status: 500
            });
        }
    });

    app.delete('/:channelID/:id', async (req: Request, res: Response) => {
        try {
            const { channelID, id } = req.params;
            const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
            const idStr = Array.isArray(id) ? id[0] : id;

            const eventsub = await EventsubSchema.findOne({ channelID: channelIdStr, _id: idStr });

            if (!eventsub) {
                return res.status(404).send({
                    error: 'Not Found',
                    message: 'Eventsub not found',
                    status: 404
                });
            }

            const result = await unsubscribeTwitchEvent(eventsub.id);

            if ((result as any).error) {
                return res.status((result as any).status).send({
                    error: (result as any).error,
                    message: (result as any).message,
                    status: (result as any).status
                });
            }

            return res.status(200).send({
                error: false,
                message: 'Eventsub deleted',
                status: 200
            });
        } catch (error) {
            console.error('Error in DELETE /:channelID/:id:', {
                channelID: req.params.channelID,
                id: req.params.id,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString()
            });

            res.status(500).send({
                error: true,
                message: 'Internal server error',
                status: 500
            });
        }
    });

    app.patch('/:channelID/:id', async (req: Request, res: Response) => {
        try {
            const { channelID, id } = req.params;
            const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
            const idStr = Array.isArray(id) ? id[0] : id;

            if (!idStr) {
                return res.status(400).send({
                    error: 'Bad Request',
                    message: 'ID is required',
                    status: 400
                });
            } else {
                if (!mongoose.isValidObjectId(idStr)) {
                    return res.status(400).send({
                        error: 'Invalid ID',
                        message: 'ID is not a valid ObjectID',
                        status: 400
                    });
                }
            }

            const eventsub = await EventsubSchema.findOne({ _id: idStr });

            if (!eventsub) {
                return res.status(404).send({
                    error: 'Not Found',
                    message: 'Eventsub not found',
                    status: 404
                });
            }

            const update = await EventsubSchema.updateOne({ _id: idStr }, req.body);

            if (!update) {
                return res.status(400).send({
                    error: 'Bad Request',
                    message: 'Failed to update eventsub',
                    status: 400
                });
            }

            return res.status(200).send({
                error: false,
                data: update,
                status: 200
            });
        } catch (error) {
            console.error('Error in PATCH /:channelID/:id:', {
                channelID: req.params.channelID,
                id: req.params.id,
                body: req.body,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString()
            });

            res.status(500).send({
                error: true,
                message: 'Internal server error',
                status: 500
            });
        }
    });
};
