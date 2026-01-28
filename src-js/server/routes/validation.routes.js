const express = require('express');
const router = express.Router();

const STREAMERS = require('../../../class/streamer');
const { getUserByLogin } = require('../../../function/user/getuser');
const logger = require('../../../util/logger');

const auth = require('../../../middleware/auth');
const { getClient } = require('../../../util/database/dragonfly')

router.use(auth);

router.post('/:channelID', async (req, res) => {
    const cacheClient = getClient();
    const { channelID } = req.params;
    const token = req.headers.authorization;

    if(!token) {
        logger({error: true, message: "Missing token"}, true, channelID, 'validation-token');
        return res.status(400).json({
            error: true,
            message: "Missing token",
            access: false,
            status: 400
        });
    }

    let userCacheID = await cacheClient.hget(`token:${token}`, 'id');
    let userCacheLogin = await cacheClient.hget(`token:${token}`, 'login');

    if(!userCacheID || !userCacheLogin) {
        return res.status(400).json({
            error: true,
            message: "Invalid token",
            access: false,
            status: 400
        });
    }

    if(channelID == userCacheID) {
        return res.status(200).json({
            error: false,
            message: 'Validation successful',
            access: true,
            status: 200
        });
    }

    let existsAdmin = await cacheClient.sismember(`${channelID}:admins`, userCacheLogin);

    if(existsAdmin == 0) {
        return res.status(403).json({
            error: true,
            message: "User is not an admin",
            access: false,
            status: 403
        });
    }

    let exists = await cacheClient.exists(`${channelID}:admins:${userCacheID}`);

    if(exists == 0) {
        return res.status(403).json({
            error: true,
            message: "User is not an admin",
            access: false,
            status: 403
        });
    }
    
    res.status(200).json({
        error: false,
        message: 'Validation successful',
        access: true,
        status: 200
    });
});

module.exports = router;