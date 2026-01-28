const express = require('express');
const router = express.Router();

const gtts = require('gtts');
const md = require('mp3-duration');
const fs = require('fs');

const { getUrl } = require('../../../util/dev');
const { getIO } = require('../websocket');
const { getClient } = require('../../../util/database/dragonfly');

let speachMap = new Map();

router.get('/:channelID', (req, res) => {
    res.status(200).sendFile(`${__dirname}/public/speach.html`);
});

router.get('/:channelID/:msgID', (req, res) => {
    const channelID = req.params.channelID;
    const msgID = req.params.msgID;

    res.status(200).sendFile(`${__dirname}/public/speach/${msgID}.mp3`);
});

router.post('/:channelID', async (req, res) => {
    const channelID = req.params.channelID;
    const {speach, msgID} = req.body;
    const lang = req.body.lang || 'es';
    const tts = new gtts(speach, lang);

    let io = getIO();
    let cacheClient = getClient();

    let messages = await cacheClient.scard(`${channelID}:speach`);
    
    tts.save(`${__dirname}/public/speach/${msgID}.mp3`, async (err, result) => {
        if(err) {
            console.log(err);
            return res.status(500).send({
                error: 'Error saving the file.',
                message: err,
                status: 500
            });
        }

        await cacheClient.sadd(`${channelID}:speach`, msgID);

        if(messages === 0) {
            io.of(`/speech/${channelID}`).emit('speach', { id: msgID });
        }
    });

    
    res.status(200).send({
        message: 'Speach saved',
        status: 200,
        messages: messages + 1
    });
});

// router.post('/send/:channelID', (req, res) => {
//     const channelID = req.params.channelID;
//     const { id } = req.body;

//     let io = getIO();
    
//     let channelMap = speachMap.get(channelID);
//     if(channelMap.length === 0) {
//         return res.status(200).send({
//             message: 'No speach to send',
//             status: 200
//         });
//     }

//     let newMsgID = channelMap.shift();
//     speachMap.set(channelID, channelMap);

//     md(`${__dirname}/public/speach/${newMsgID}.mp3`, (err, duration) => {
//         if(err) {
//             console.log(err);
//             return res.status(500).send({
//                 error: 'Error getting the duration of the file.',
//                 message: err,
//                 status: 500
//             });
//         }

//         io.of(`/speech/${channelID}`).emit('speach', { id: newMsgID });
//         //? Removes the file from the folder
//         setTimeout(() => {
//             fs.unlinkSync(`${__dirname}/public/speach/${newMsgID}.mp3`);
//         }, (duration * 1000) - 1000);
        
//         //? Send the next speach
//         setTimeout(() => {
//             fetch(`${getUrl()}/speech/send/${channelID}`, {
//                 method: 'POST',
//                 body: JSON.stringify({
//                     id: newMsgID
//                 })
//             });
//         }, duration * 1000);
//     });
    
//     res.status(200).send({
//         message: `Playing speech on ${channelID}`,
//         status: 200
//     });
// });

module.exports = router;