import express, { type Request, type Response } from "express";
import { promo } from "../../functions/promo/index.js";
import path from "path";
import { getDirname } from "../../utils/pollyfills.js";

export const clipRoute = (app: express.Application): void => {
    const __dirname = getDirname(import.meta.url);
    const htmlPath = path.join(__dirname, 'routes', 'public');

    // GET /clip/:channelID - Serve clip.html
    app.get('/clip/:channelID', async (req: Request, res: Response) => {
        try {
            const { channelID } = req.params;
            const designId = req.query.design as string;

            // For now, only support default designs (1, 2, 3)
            // Custom designs will be added when ClipDesign schema is migrated
            if (designId && designId !== '1' && designId !== '2' && designId !== '3') {
                // Serve default design if invalid design ID
                return res.status(200).sendFile(path.join(htmlPath, 'clip.html'));
            }

            res.status(200).sendFile(path.join(htmlPath, 'clip.html'));
        } catch (error) {
            console.error('Error serving clip page:', {
                channelID: req.params.channelID,
                error: error instanceof Error ? error.message : String(error),
                timestamp: new Date().toISOString()
            });
            res.status(500).json({
                error: true,
                message: 'Error loading clip page',
                status: 500
            });
        }
    });

    // POST /clip/test - Test endpoint for promo
    app.post('/clip/test', async (req: Request, res: Response) => {
        try {
            const { channelID, streamer } = req.body;

            if (!channelID || !streamer) {
                return res.status(400).json({
                    error: true,
                    message: 'channelID and streamer are required',
                    status: 400
                });
            }

            const result = await promo(channelID, streamer);

            if (result.error) {
                return res.status(result.status || 500).json(result);
            }

            res.status(200).json(result);
        } catch (error) {
            console.error('Error in clip test:', {
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
};
