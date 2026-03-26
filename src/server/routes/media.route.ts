import express, { type Request, type Response } from 'express';
import { MediaAssetSchema } from '../../schemas/media_asset.schema.js';
import { getS3PublicObjectUrl } from '../../utils/s3.js';

const router = express.Router();

router.get('/:mediaID', async (req: Request, res: Response) => {
    try {
        const { mediaID } = req.params;
        const mediaIdStr = Array.isArray(mediaID) ? mediaID[0] : mediaID;

        if (!mediaIdStr) {
            return res.status(400).json({
                error: true,
                message: 'mediaID is required',
                status: 400
            });
        }

        const asset = await MediaAssetSchema.findOne({
            _id: mediaIdStr,
            deletedAt: null
        }).select('s3Key storageUrl').lean();

        if (!asset) {
            return res.status(404).json({
                error: true,
                message: 'Media not found',
                status: 404
            });
        }

        const destinationUrl = asset.s3Key ? getS3PublicObjectUrl(asset.s3Key) : asset.storageUrl;
        if (!destinationUrl) {
            return res.status(404).json({
                error: true,
                message: 'Media URL not found',
                status: 404
            });
        }

        res.setHeader('Cache-Control', 'private, no-store');
        return res.redirect(307, destinationUrl);
    } catch (error) {
        console.error('Error in GET /media/:mediaID:', {
            mediaID: req.params.mediaID,
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

export const mediaRoute = router;
