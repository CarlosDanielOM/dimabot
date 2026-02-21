import express, { type Request, type Response } from "express";
import { promo } from "../../functions/promo/index.js";
import path from "path";
import { getDirname } from "../../utils/pollyfills.js";

const router = express.Router();
const __dirname = getDirname(import.meta.url);
const htmlPath = path.join(__dirname, 'public');

// GET /clip/:channelID - Serve clip.html
router.get('/:channelID', async (req: Request, res: Response) => {
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
router.post('/test', async (req: Request, res: Response) => {
    try {
        const { channelID, streamer } = req.body;

        if (!channelID || !streamer) {
            return res.status(400).json({
                error: true,
                message: 'channelID and streamer are required',
                status: 400
            });
        }

        const result = await promo(channelID, streamer, true);

        if (result.error) {
            return res.status(result.status || 500).json(result);
        }

        const clipMessage =
            typeof result.data?.clip?.message === 'string'
                ? result.data.clip.message.toLowerCase()
                : '';

        if (clipMessage.includes('obs not connected')) {
            return res.status(409).json({
                error: true,
                message: 'Clip overlay is not connected. Open the clip URL first and try again.',
                status: 409,
                data: {
                    reason: 'obs_not_connected'
                }
            });
        }

        res.status(200).json({
            error: false,
            message: 'Clip test queued successfully',
            status: 200,
            data: result.data
        });
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

export const clipRoute = router;
