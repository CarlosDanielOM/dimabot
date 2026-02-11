import express, { type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { RedemptionRewardSchema, type IRedemptionReward } from '../../schemas/redemption_reward.schema.js';
import TwitchStreamers from '../../classes/twitch_streamers.class.js';
import { getTwitchStreamerHeaderById } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';
import { subscribeTwitchEvent } from '../../utils/eventsub.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';

const router = express.Router();

function twitchBodyParser(body: any): any {
    const parsed = { ...body };

    if ('isEnabled' in parsed) {
        parsed.is_enabled = parsed.isEnabled;
        delete parsed.isEnabled;
    }

    if (parsed.skipQueue) {
        parsed.should_redemptions_skip_request_queue = true;
        delete parsed.skipQueue;
    }

    if (parsed.cooldown && parsed.cooldown > 0) {
        parsed.is_global_cooldown_enabled = true;
        parsed.global_cooldown_seconds = parsed.cooldown;
        delete parsed.cooldown;
    } else if (parsed.cooldown === 0) {
        parsed.is_global_cooldown_enabled = false;
        parsed.global_cooldown_seconds = 0;
        delete parsed.cooldown;
    }

    if (parsed.userInput !== undefined) {
        parsed.is_user_input_required = parsed.userInput;
        delete parsed.userInput;
    }

    return parsed;
}

async function createTwitchReward(channelID: string, body: any): Promise<any> {
    const streamerHeaderResult = await getTwitchStreamerHeaderById(channelID);

    if (streamerHeaderResult.error || !streamerHeaderResult.header) {
        return { error: streamerHeaderResult.message };
    }

    const parsedBody = twitchBodyParser(body);

    const params = new URLSearchParams();
    params.append('broadcaster_id', channelID);

    const response = await fetch(
        getTwitchHelixUrl('channel_points/custom_rewards', params.toString()),
        {
            method: 'POST',
            headers: streamerHeaderResult.header as unknown as Record<string, string>,
            body: JSON.stringify(parsedBody)
        }
    );

    const result = await response.json();

    if (result.error) {
        console.error(`Error creating reward for ${channelID}: ${result.error}`);
        return result;
    }

    return result.data[0];
}

async function patchTwitchReward(channelID: string, body: any, rewardID: string): Promise<any> {
    const streamerHeaderResult = await getTwitchStreamerHeaderById(channelID);

    if (streamerHeaderResult.error || !streamerHeaderResult.header) {
        return { error: streamerHeaderResult.message };
    }

    const parsedBody = twitchBodyParser(body);

    const params = new URLSearchParams();
    params.append('broadcaster_id', channelID);
    params.append('id', rewardID);

    const response = await fetch(
        getTwitchHelixUrl('channel_points/custom_rewards', params.toString()),
        {
            method: 'PATCH',
            headers: streamerHeaderResult.header as unknown as Record<string, string>,
            body: JSON.stringify(parsedBody)
        }
    );

    const result = await response.json();

    if (result.error) {
        console.error(`Error updating reward for ${channelID}: ${result.error} | ${result.message}`);
        return result;
    }

    return result.data[0];
}

router.get('/twitch/:channelID', authMiddleware as any, async (req: Request, res: Response) => {
    try {
        const { channelID } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;

        const params = new URLSearchParams();
        params.append('broadcaster_id', channelIdStr);

        const streamerHeaderResult = await getTwitchStreamerHeaderById(channelIdStr);

        if (streamerHeaderResult.error || !streamerHeaderResult.header) {
            return res.status(500).json({
                error: true,
                message: streamerHeaderResult.message,
                status: 500
            });
        }

        const response = await fetch(
            getTwitchHelixUrl('channel_points/custom_rewards', params.toString()),
            {
                headers: streamerHeaderResult.header as unknown as Record<string, string>
            }
        );

        const data = await response.json();

        if (data.error) {
            return res.status(400).json({
                error: 'Bad Request',
                message: data.error,
                status: 400
            });
        }

        return res.status(200).json({
            error: false,
            data: data.data,
            total: data.total
        });
    } catch (error) {
        console.error('Error in GET /twitch/:channelID:', {
            channelID: req.params.channelID,
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

router.get('/:channelID', authMiddleware as any, async (req: Request, res: Response) => {
    try {
        const { channelID } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;

        const { type, id } = req.query;

        if (id) {
            if (!mongoose.Types.ObjectId.isValid(id as string)) {
                return res.status(400).json({
                    error: true,
                    message: 'Invalid ID',
                    status: 400
                });
            }
            const reward = await RedemptionRewardSchema.find({ channelID: channelIdStr, _id: id });
            return res.status(200).json({
                data: reward,
                total: reward.length
            });
        } else if (type) {
            const rewards = await RedemptionRewardSchema.find({ channelID: channelIdStr, type: type });
            return res.status(200).json({
                data: rewards,
                total: rewards.length
            });
        } else {
            const rewards = await RedemptionRewardSchema.find({ channelID: channelIdStr });
            return res.status(200).json({
                data: rewards,
                total: rewards.length
            });
        }
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

router.post('/:channelID', authMiddleware as any, async (req: Request, res: Response) => {
    try {
        const { channelID } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
        const body = req.body;

        const streamer = await TwitchStreamers.getTwitchAccountById(channelIdStr);
        if (!streamer) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Streamer not found',
                status: 404
            });
        }

        if (!body.title || body.cost === undefined) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Title and cost are required',
                status: 400
            });
        }

        if (body.title.length > 45) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Title is too long',
                status: 400
            });
        }

        if (body.cost < 0) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Cost must be greater than 0',
                status: 400
            });
        }

        let rewardData = await createTwitchReward(channelIdStr, body);

        const eventsubData = await subscribeTwitchEvent(
            channelIdStr,
            'channel.channel_points_custom_reward_redemption.add',
            '1',
            { broadcaster_user_id: channelIdStr, reward_id: rewardData.id } as any
        );

        if (rewardData.error || (eventsubData as any).error) {
            return res.status(400).json({
                error: 'Bad Request',
                message: rewardData.error,
                status: 400
            });
        }

        const priceIncrease = body.priceIncrease || 0;
        const rewardMessage = body.message || '';
        const returnToOriginalCost = body.returnToOriginalCost || false;
        const eventsubId = (eventsubData as any).id;

        let newReward = new RedemptionRewardSchema({
            eventsubID: eventsubId,
            channelID: channelIdStr,
            channel: streamer.name,
            rewardID: rewardData.id,
            title: rewardData.title,
            prompt: rewardData.prompt,
            cost: rewardData.cost,
            originalCost: rewardData.cost,
            isEnabled: rewardData.is_enabled,
            costChange: priceIncrease,
            message: rewardMessage,
            returnToOriginalCost: returnToOriginalCost,
            cooldown: body.cooldown || 0,
            createdFrom: body.createdFrom || 'domdimabot',
            createdFor: body.createdFor || 'twitch'
        });

        if (body.type) {
            newReward.type = body.type;
        }
        if (body.duration) {
            newReward.duration = body.duration;
        }

        try {
            await newReward.save();
        } catch (error) {
            console.error('Error saving new reward: ', error);
            return res.status(500).json({
                error: 'Internal Server Error',
                message: 'Error saving new reward',
                status: 500
            });
        }

        return res.status(201).json({
            error: false,
            data: newReward
        });
    } catch (error) {
        console.error('Error in POST /:channelID:', {
            channelID: req.params.channelID,
            body: req.body,
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

router.delete('/:channelID/:id', authMiddleware as any, async (req: Request, res: Response) => {
    try {
        const { channelID, id } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
        const rewardIdStr = Array.isArray(id) ? id[0] : id;

        let reward = await RedemptionRewardSchema.findOne({ channelID: channelIdStr, rewardID: rewardIdStr });
        if (!reward) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Reward not found',
                status: 404
            });
        }

        const streamerHeaderResult = await getTwitchStreamerHeaderById(channelIdStr);

        if (streamerHeaderResult.error || !streamerHeaderResult.header) {
            return res.status(500).json({
                error: true,
                message: streamerHeaderResult.message,
                status: 500
            });
        }

        let params = new URLSearchParams();
        params.append('broadcaster_id', channelIdStr);
        params.append('id', rewardIdStr);

        let response = await fetch(
            getTwitchHelixUrl('channel_points/custom_rewards', params.toString()),
            {
                method: 'DELETE',
                headers: streamerHeaderResult.header as unknown as Record<string, string>
            }
        );

        if (response.status !== 204) {
            const data = await response.json();
            console.log(`Error deleting reward ${rewardIdStr} for ${channelIdStr}: ${data.error}`);
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Error deleting reward',
                status: 400
            });
        }

        try {
            await RedemptionRewardSchema.deleteOne({ channelID: channelIdStr, rewardID: rewardIdStr });
        } catch (error) {
            console.error('Error deleting reward: ', error);
            return res.status(500).json({
                error: 'Internal Server Error',
                message: 'Error deleting reward',
                status: 500
            });
        }

        return res.status(200).json({
            error: false,
            message: 'Reward deleted',
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

        res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.patch('/:channelID/:id', authMiddleware as any, async (req: Request, res: Response) => {
    try {
        const { channelID, id } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
        const rewardIdStr = Array.isArray(id) ? id[0] : id;
        const body = req.body;

        let reward = await RedemptionRewardSchema.findOne({ channelID: channelIdStr, rewardID: rewardIdStr });
        if (!reward) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Reward not found',
                status: 404
            });
        }

        let updatedReward = await patchTwitchReward(channelIdStr, body, rewardIdStr);
        if (updatedReward.error) {
            return res.status(400).json({
                error: 'Bad Request',
                message: updatedReward.error,
                status: 400
            });
        }

        if (body.background_color && Object.keys(body).length === 1) {
            return res.status(200).json({
                error: false,
                data: updatedReward
            });
        }

        try {
            let updatedRewardDB = await RedemptionRewardSchema.findOneAndUpdate(
                { channelID: channelIdStr, rewardID: rewardIdStr },
                body,
                { new: true }
            );

            return res.status(200).json({
                error: false,
                data: updatedRewardDB
            });
        } catch (error) {
            console.error('Error updating reward: ', error);
            return res.status(500).json({
                error: 'Internal Server Error',
                message: 'Error updating reward',
                status: 500
            });
        }
    } catch (error) {
        console.error('Error in PATCH /:channelID/:id:', {
            channelID: req.params.channelID,
            id: req.params.id,
            body: req.body,
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

export const rewardRoute = router;
