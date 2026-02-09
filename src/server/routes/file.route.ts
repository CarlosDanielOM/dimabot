import express, { type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import { getDirname } from "../../utils/pollyfills.js";

const __dirname = getDirname(import.meta.url);

const router = express.Router();
const publicDir = path.join(__dirname, 'public');

router.get('/clip/:channelID', async (req: Request, res: Response) => {
        try {
            const { channelID } = req.params;

            if (!channelID) {
                return res.status(400).json({
                    error: true,
                    message: 'channelID is required',
                    status: 400
                });
            }

            const videoPath = path.join(publicDir, 'downloads', `${channelID}-clip.mp4`);

            if (!fs.existsSync(videoPath)) {
                console.error(`Video file not found at: ${videoPath}`);
                return res.status(404).json({
                    error: true,
                    message: 'Clip not found',
                    status: 404
                });
            }

            const stat = fs.statSync(videoPath);
            const fileSize = stat.size;
            const range = req.headers.range;

            if (range) {
                const parts = range.replace(/bytes=/, "").split("-");
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

                if (start >= fileSize) {
                    return res.status(416).json({
                        error: true,
                        message: 'Requested range not satisfiable',
                        status: 416
                    });
                }

                const chunksize = (end - start) + 1;
                const file = fs.createReadStream(videoPath, { start, end });

                const head = {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunksize,
                    'Content-Type': 'video/mp4'
                };

                res.writeHead(206, head);
                file.pipe(res);
            } else {
                res.sendFile(videoPath);
            }
        } catch (error) {
            console.error('Error serving video clip:', {
                channelID: req.params.channelID,
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

export const fileRoute = router;
