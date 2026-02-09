import express, { type Request, type Response } from "express";
import { getIO } from "../websocket.js";

const router = express.Router();

    // GET /overlays/triggers/:channelID - Serve trigger.html
router.get('/overlays/triggers/:channelID', async (req: Request, res: Response) => {
        try {
            res.sendFile(process.cwd() + '/src/server/routes/public/trigger.html');
        } catch (error) {
            console.error('Error serving trigger overlay:', {
                channelID: req.params.channelID,
                error: error instanceof Error ? error.message : String(error),
                timestamp: new Date().toISOString()
            });

            res.status(500).json({
                error: true,
                message: 'Error loading trigger overlay',
                status: 500
            });
        }
    });

    // GET /overlays/furry/:channelID - Serve furry.html
router.get('/overlays/furry/:channelID', async (req: Request, res: Response) => {
        try {
            res.sendFile(process.cwd() + '/src/server/routes/public/furry.html');
        } catch (error) {
            console.error('Error serving furry overlay:', {
                channelID: req.params.channelID,
                error: error instanceof Error ? error.message : String(error),
                timestamp: new Date().toISOString()
            });

            res.status(500).json({
                error: true,
                message: 'Error loading furry overlay',
                status: 500
            });
        }
    });

    // POST /overlays/furry/:channelID - Emit furry event via websocket
router.post('/overlays/furry/:channelID', async (req: Request, res: Response) => {
        try {
            const { channelID } = req.params;
            const { username, value } = req.body;

            if (!username || !value) {
                return res.status(400).json({
                    error: true,
                    message: 'Username and value are required',
                    status: 400
                });
            }

            const io = getIO();

            if (!io) {
                return res.status(500).json({
                    error: true,
                    message: 'Websocket not initialized',
                    status: 500
                });
            }

            io.of(`/overlays/furry/${channelID}`).emit('furry', { username, value });

            res.status(200).json({ message: 'Furry event triggered' });
        } catch (error) {
            console.error('Error triggering furry event:', {
                channelID: req.params.channelID,
                body: req.body,
                error: error instanceof Error ? error.message : String(error),
                timestamp: new Date().toISOString()
            });

            res.status(500).json({
                error: true,
                message: 'Internal server error',
                status: 500
            });
        }
    });

export const overlayRoute = router;
