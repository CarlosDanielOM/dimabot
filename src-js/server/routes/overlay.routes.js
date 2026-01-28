const express = require('express');
const { getIO } = require('../websocket');
const router = express.Router();

const htmlPath = `${__dirname}/public`

router.get('/triggers/:channelID', (req, res) => {
    res.status(200).sendFile(`${htmlPath}/trigger.html`);
});

router.get('/furry/:channelID', (req, res) => {
    res.sendFile(`${htmlPath}/furry.html`);
});

router.post('/furry/:channelID', (req, res) => {
    const { channelID } = req.params;
    const { username, value } = req.body;

    if (!username || !value) {
        return res.status(400).json({ error: 'Username and value are required' });
    }

    let io = getIO();

    io.of(`/overlays/furry/${channelID}`).emit('furry', { username, value });
    res.status(200).json({ message: 'Furry event triggered' });
});

module.exports = router;