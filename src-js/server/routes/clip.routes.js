const express = require('express');
const router = express.Router();
const fs = require('fs');
const { getIO } = require('../websocket');
const logger = require('../../../util/logger');
const { exec } = require('node:child_process');
const ClipDesign = require('../../../schema/clipDesign');
const { downloadClip, deleteOldClip, checkIfClipExists } = require('../../../util/video');
const { getClient } = require('../../../util/database/dragonfly');

const DOWNLOADPATH = `${__dirname}/public/downloads`;
const HTMLPATH = `${__dirname}/public`;

let soSent = [];

router.get('/:channelID', async (req, res) => {
    try {
        // Get design from query parameter
        const designId = req.query.design;
        let design = null;

        if (designId) {
            if(designId != '1' && designId != '2' && designId != '3') {
                // Try to find custom design
                design = await ClipDesign.findOne({
                    $or: [
                        { _id: designId, channelID: req.params.channelID },
                        { _id: designId, isPublic: true }
                    ]
                });
            }
        }

        // If no custom design found, use default design
        if (!design) {
            return res.status(200).sendFile(`${HTMLPATH}/clip.html`);
        }

        res.status(200).sendFile(`${HTMLPATH}/clip.html`);
    } catch (error) {
        logger({ error: true, message: error.message, status: 500, type: 'error' }, true, req.params.channelID, 'get clip error');
        res.status(500).json({
            error: true,
            message: 'Error loading clip page',
            status: 500
        });
    }
});

router.post('/test', async (req, res) => {
    let promoCommand = require('../../../command/promo');
    // let shoutoutCommand = require('../../../command/shoutout');

    let channelID = req.body.channelID;
    let streamer = req.body.streamer;

    if(!channelID || !streamer) {
        return res.status(400).json({
            error: true,
            message: 'The channelID and streamer are required.',
            status: 400
        });
    }

    let promo = await promoCommand(channelID, streamer);
    if(promo.error) {
        return res.status(promo.status).json(promo);
    }

    res.status(200).json(promo);
});

router.post('/:channelID', async (req, res) => {
    let io = getIO();
    let channelID = req.params.channelID;
    const cacheClient = getClient();
    const { duration, clipUrl, title, game, streamer, profileImg, streamerColor, description } = req.body;
    let body = req.body;
    
    if(!clipUrl) {
        return res.status(400).json({
            error: true,
            message: 'The clipUrl is required.',
            status: 400,
            type: 'error'
        });
    }

    //Delete old clip
    await deleteOldClip(channelID, DOWNLOADPATH);

    //Check if clip exists
    let clipExists = await checkIfClipExists(channelID, DOWNLOADPATH);

    if(clipExists) {
        await deleteOldClip(channelID, DOWNLOADPATH);

        //? make a half a second delay
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    try {
        let clip = await downloadClip(clipUrl, channelID, DOWNLOADPATH);
        if(!clip) {
            logger({error: true, message: 'The clipUrl is invalid.', status: 400, type: 'error', channelID, clipUrl}, true, channelID, 'clip invalid');
            return res.status(400).json({
                error: true,
                message: 'The clipUrl is invalid.',
                status: 400,
                type: 'error'
            });
        }

        io.of(`/clip/${channelID}`).emit('play-clip', body);
        soSent.push(channelID);
        
        res.status(200).json({
            error: false,
            message: 'The clip has been sent successfully. To: ' + channelID,
            status: 200,
            type: 'success'
        });
    } catch (error) {
        logger({error: true, message: 'Something went wrong on our end.', status: 500, type: 'error', channelID, clipUrl}, true, channelID, 'clip error');
        return res.status(500).json({
            error: true,
            message: 'Something went wrong on our end.',
            status: 500,
            type: 'error'
        });
    }
});

module.exports = router;