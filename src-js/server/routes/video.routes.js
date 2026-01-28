const express = require('express');
const router = express.Router();
const fs = require('fs');

router.get('/clip/:channelID', (req, res) => {
    const channelID = req.params.channelID;
    res.status(200).sendFile(`${__dirname}/public/downloads/${channelID}-clip.mp4`);
});

router.get('/trigger/:channelID/:triggerName', (req, res) => {
    const channelID = req.params.channelID;
    const triggerName = req.params.triggerName;
    if(!fs.existsSync(`${__dirname}/public/uploads/triggers/${channelID}/${triggerName}.mp4`)) {
        return res.status(404).send({
            error: 'File not found',
            message: `The file ${triggerName} does not exist in the ${channelID} channel`
        });
    }
    res.status(200).sendFile(`${__dirname}/public/uploads/triggers/${channelID}/${triggerName}.mp4`);
});

module.exports = router;