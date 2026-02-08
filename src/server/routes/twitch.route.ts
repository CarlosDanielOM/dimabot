import express, { type Request, type Response } from "express";
import TwitchStreamers from "../../classes/twitch_streamers.class.js";
import { getTwitchStreamerHeaderById } from "../../utils/header.js";
import { getTwitchHelixUrl } from "../../utils/links.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";

export const twitchRoute = (app: express.Application): void => {
    // GET /twitch/rewards - Get channel point rewards from Twitch API
    app.get('/twitch/rewards', authMiddleware as any, async (req: Request, res: Response) => {
        try {
            const channelID = req.query.channelID as string;
            const rewardID = req.query.rewardID as string | undefined;
            const name = req.query.name as string | undefined;
            const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
            const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

            if (name && rewardID) {
                return res.status(400).send('Cannot use both name and rewardID');
            }

            if (!channelID) {
                return res.status(400).send('Missing channelID');
            }

            const streamer = await TwitchStreamers.getTwitchAccountById(channelID);
            if (!streamer) {
                return res.status(404).send('Streamer not found');
            }

            let params = new URLSearchParams();
            params.append('broadcaster_id', channelID);

            const streamerHeader = await getTwitchStreamerHeaderById(channelID);

            let response = await fetch(getTwitchHelixUrl('channel_points/custom_rewards', params.toString()), {
                headers: streamerHeader as unknown as Record<string, string>
            });

            let data = await response.json();

            if (data.error) {
                return res.status(400).send({
                    error: 'Bad Request',
                    message: data.error,
                    status: 400
                });
            }

            if (rewardID) {
                data = data.filter((reward: any) => reward.id === rewardID);
            }

            if (name) {
                data = data.filter((reward: any) => reward.title.toLowerCase().includes(name.toLowerCase()));
            }

            data = data.slice(offset, offset + limit);

            res.json(data);
        } catch (error) {
            console.error('Error fetching Twitch rewards:', {
                channelID: req.query.channelID,
                query: req.query,
                error: error instanceof Error ? error.message : String(error),
                timestamp: new Date().toISOString()
            });

            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Error fetching rewards',
                status: 500
            });
        }
    });
};
