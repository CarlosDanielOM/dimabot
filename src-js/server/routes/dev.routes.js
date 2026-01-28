const express = require('express');
const router = express.Router();

const commandSchema = require('../../../schema/command');
const eventsubSchema = require('../../../schema/eventsub');
const Channel = require('../../../schema/channel');
const RedemptionReward = require('../../../schema/redemptionreward');

const STREAMERS = require('../../../class/streamer');
const JSONCOMMANDS = require('../../../config/reservedcommands.json');
const { getUrl } = require('../../../util/dev');
const { getEventsubs } = require('../../../util/eventsub');
const { getUserById } = require('../../../function/user/getuser');
const { getStreamerHeaderById } = require('../../../util/header');
const { getTwitchHelixUrl } = require('../../../util/link');

router.patch('/rewards/:id', async (req, res) => {
    const {id} = req.params;
    const body = req.body;

    let updatedReward = await PatchTwitchReward('533538623', body, id);
    if(updatedReward.error) {
        return res.status(400).send({
            error: 'Bad Request',
            message: updatedReward.error,
            status: 400
        });
    }

    if(body.background_color && Object.keys(body).length === 1) {
        return res.status(200).send({
            error: false,
            data: updatedReward
        });
    }

    try {
        return res.status(200).send({
            error: false,
            data: updatedReward
        });
    } catch (error) {
        console.error('Error updating reward: ', error);
        return res.status(500).send({
            error: 'Internal Server Error',
            message: 'Error updating reward',
            status: 500
        });
    }
});

router.get('/:userId', async(req, res) => {
    const { userId } = req.params;
    const user = await getUserById(userId);
    res.send(user);
});

router.get('/eventsubs', async(req, res) => {
    const eventsubs = await getEventsubs();
    res.send(eventsubs);
});

router.get('/rewards', async(req, res) => {
    let channels = await STREAMERS.getStreamerIds();

    for(let i = 0; i < channels.length; i++) {
        fetch(`${getUrl()}/dev/migrate/redemption-rewards?channelID=${channels[i]}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
        });
    }

    res.status(200).send({
        error: false,
        message: 'Rewards fetched successfully',
        data: channels
    });
});

router.post('/update/channels', async(req, res) => {
    try {
        // First, update channels that don't have chat_enabled field
        const result1 = await Channel.updateMany(
            { chat_enabled: { $exists: false } },
            [{ $set: { chat_enabled: "$actived" } }]
        );

        // Then, update all channels to match their actived status
        const result2 = await Channel.updateMany(
            {},
            [{ $set: { chat_enabled: "$actived" } }]
        );

        res.send(`Updated ${result1.modifiedCount} new channels and synchronized ${result2.modifiedCount} existing channels with actived status`);
    } catch (error) {
        res.status(500).send(`Error updating channels: ${error.message}`);
    }
});

router.post('/create/commands', async(req, res) => {
    const streamer = await STREAMERS.getStreamerNames();

    streamer.forEach(async streamer => {
        let result = await fetch(`${getUrl()}/dev/create/command/${streamer}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
        });
    })

    res.send('Commands created');
});

router.post('/create/command/:streamer', async(req, res) => {
    const { streamer } = req.params;

    let channel = await STREAMERS.getStreamerByName(streamer);
    if(!channel) return res.status(404).send('Streamer not found');

    let commandsJSON = JSONCOMMANDS.commands;
    
    for (const command of commandsJSON) {
        let commandExists = await commandSchema.exists({channelID: channel.user_id, name: JSONCOMMANDS[command].name})

        if(commandExists) continue;

        let newCommand = new commandSchema({
            name: JSONCOMMANDS[command].name,
            cmd: JSONCOMMANDS[command].cmd,
            func: JSONCOMMANDS[command].func,
            type: JSONCOMMANDS[command].type,
            channel: channel.name,
            channelID: channel.user_id,
            cooldown: JSONCOMMANDS[command].cooldown,
            enabled: JSONCOMMANDS[command].enabled,
            userLevel: JSONCOMMANDS[command].userLevel,
            userLevelName: JSONCOMMANDS[command].userLevelName,
            reserved: JSONCOMMANDS[command].reserved,
        })

        await newCommand.save();
        
    }

    res.send('Commands created');

});

// Migrate redemption reward documents from old field names to new ones
router.post('/migrate/redemption-rewards', async (req, res) => {
	try {
		const channelID = req.body?.channelID || req.query?.channelID || null;
		const filter = channelID ? { channelID } : {};

		// Map of legacy -> new field names
		const legacyToNew = {
			rewardTitle: 'title',
            rewardType: 'type',
			rewardPrompt: 'prompt',
            rewardOriginalCost: 'originalCost',
			rewardCost: 'cost',
            rewardIsEnabled: 'isEnabled',
			rewardMessage: 'message',
			rewardCostChange: 'costChange',
			rewardReturnToOriginalCost: 'returnToOriginalCost',
			rewardDuration: 'duration',
			rewardCooldown: 'cooldown',
		};

		// Build $set stage using $ifNull to preserve existing new values
		const setStage = {};
		for (const [oldKey, newKey] of Object.entries(legacyToNew)) {
			setStage[newKey] = { $ifNull: [ `$${oldKey}`, `$${newKey}` ] };
		}

		const unsetKeys = Object.keys(legacyToNew);

		const result = await RedemptionReward.updateMany(
			filter,
			[
				{ $set: setStage },
				{ $unset: unsetKeys }
			]
		);

		return res.status(200).send({
			error: false,
			message: 'Redemption rewards migrated successfully',
			matchedCount: result.matchedCount ?? result.nMatched ?? 0,
			modifiedCount: result.modifiedCount ?? result.nModified ?? 0,
			scoped: !!channelID,
			channelID: channelID || undefined
		});
	} catch (error) {
		return res.status(500).send({
			error: true,
			message: `Migration failed: ${error.message}`
		});
	}
});

module.exports = router;

async function PatchTwitchReward(channelID, body, rewardID) {
    let streamerHeader = await getStreamerHeaderById(channelID);

    let newBody = TwitchBodyParser(body);

    let params = new URLSearchParams(newBody);
    params.append('broadcaster_id', channelID);
    params.append('id', rewardID);

    let response = await fetch(getTwitchHelixUrl('channel_points/custom_rewards', params), {
        method: 'PATCH',
        headers: streamerHeader,
        body: JSON.stringify(newBody)
    });

    console.log(response);

    let result = await response.json();

    console.log(result);

    if(result.error) {
        console.error(`Error updating reward for ${channelID}: ${result.error} | ${result.message}`);
        return result;
    }

    let data = result.data[0];

    return data;
}

function TwitchBodyParser(body) {
    if('isEnabled' in body) {
        body.is_enabled = body.isEnabled;
    }
    
    if(body.skipQueue) {
        body.should_redemptions_skip_request_queue = true;
    }

    if(body.cooldown && body.cooldown > 0 && body.cooldown !== 0) {
        body.is_global_cooldown_enabled = true;
        body.global_cooldown_seconds = body.cooldown;
    } else if(body.cooldown && body.cooldown === 0) {
        body.is_global_cooldown_enabled = false;
        body.global_cooldown_seconds = 0;
    }

    if(body.userInput) {
        body.is_user_input_required = body.userInput;
    }
    
    return body;
}