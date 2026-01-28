const express = require('express');
const router = express.Router();

const { getIO } = require('../websocket');

router.get('/:type/:channelID', (req, res) => {
    const { type, channelID } = req.params;
    res.sendFile(`${__dirname}/public/sumimetro.html`);
});

router.post('/:type/:channelID', (req, res) => {
    const { type, channelID } = req.params;
    const { username, value } = req.body || {username: null, value: null};

    if (username == null || value == null) {
        return res.status(400).json({ error: 'Missing parameters', message: 'Username and value are required' });
    }

    const io = getIO();
    
    io.of(`/sumimetro/${type}/${channelID}`).emit('sumimetro', { username, value });
    res.status(200).json({ message: 'Sumimetro event triggered' });
});

module.exports = router;