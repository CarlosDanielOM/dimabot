const express = require('express');
const router = express.Router();

const { getStreamerById } = require('../../../class/streamer');
const { getStreamerHeaderById } = require('../../../util/header');
const { getTwitchHelixUrl } = require('../../../util/link');
const auth = require('../../../middleware/auth');

router.use(auth);

router.get('/rewards', async (req, res) => {
    const channelID = req.query.channelID;
    const rewardID = req.query.rewardID || null;
    const name = req.query.name || null;
    const limit = req.query.limit || 100;
    const offset = req.query.offset || 0;

    if(name && rewardID) return res.status(400).send('Cannot use both name and rewardID');

    if(!channelID) return res.status(400).send('Missing channelID');

    let streamer = await getStreamerById(channelID);
    if(!streamer) return res.status(404).send('Streamer not found');

    let params = new URLSearchParams();
    params.append('broadcaster_id', channelID);

    let headers = await getStreamerHeaderById(channelID);

    let response = await fetch(getTwitchHelixUrl('channel_points/custom_rewards', params), {
        headers: headers
    });

    let data = await response.json();

    if(rewardID) {
        data = data.filter(reward => reward.id === rewardID);
    }

    if(name) {
        data = data.filter(reward => reward.title.toLowerCase().includes(name.toLowerCase()));
    }

    data = data.slice(offset, offset + limit);

    res.json(data);
});

module.exports = router;

