const express = require('express');
const router = express.Router();

const STREAMERS = require('../../../class/streamer');
const { getUserByLogin } = require('../../../function/user/getuser');
const logger = require('../../../util/logger');

const auth = require('../../../middleware/auth');
const { getClient } = require('../../../util/database/dragonfly')

const adminSchema = require('../../../schema/admin');

router.use(auth);

router.get('/:channelID', async (req, res) => {
    const cacheClient = getClient();
    const { channelID } = req.params;
    const query = req.query;
    let page = query.page || 1;
    let limit = query.limit || 10;
    let offset = (page - 1) * limit;
    let sort = query.sort || 'createdAt';
    let order = query.order || 'desc';
    let name = query.name;
    let id = query.id;

    if(name && id) {
        return res.status(400).json({
            error: true,
            message: "Invalid parameters",
            status: 400
        });
    }

    if(sort != 'createdAt' && sort != 'updatedAt') {
        return res.status(400).json({
            error: true,
            message: "Invalid sort parameter",
            status: 400
        });
    }

    if(order != 'asc' && order != 'desc') {
        return res.status(400).json({
            error: true,
            message: "Invalid order parameter",
            status: 400
        });
    }

    let admins = await cacheClient.smembers(`${channelID}:admins`);
    if(admins.length == 0) {
        return res.status(404).json({
            error: true,
            message: "No admins found",
            status: 404
        });
    }

    res.status(200).json({
        error: false,
        message: 'Admins fetched successfully',
        status: 200,
        data: admins
    });
});

router.get('/:channelID/:adminID', async (req, res) => {
    const cacheClient = getClient();
    const { channelID, adminID } = req.params;

    let adminData = await cacheClient.hgetall(`${channelID}:admins:${adminID}`);

    if(!adminData) {
        return res.status(404).json({
            error: true,
            message: "Admin not found",
            status: 404
        });
    }

    res.status(200).json({
        error: false,
        message: 'Admin fetched successfully',
        status: 200,
        data: adminData
    });
});

router.post('/:channelID', async (req, res) => {
    const cacheClient = getClient();
    const { channelID } = req.params;

    let body = req.body;

    let channelName = body.channelName;
    let adminName = body.adminName;

    if(!channelName || !adminName) {
        return res.status(400).json({
            error: true,
            message: "Missing parameters",
            status: 400
        });
    }

    let exists = await adminSchema.findOne({channelID, adminName});
    if(exists) {
        return res.status(400).json({
            error: true,
            message: "Admin already exists",
            status: 400
        });
    }

    let userData = await getUserByLogin(adminName);
    if (userData.error) {
        logger(userData, true, channelID, 'admin userData');
        res.status(userData.status).json(userData);
    }

    userData = userData.data;

    let adminData = new adminSchema({
        channelID: channelID,
        channelName: channelName,
        adminID: userData.id,
        adminName: adminName,
        permissions: ['*'],
        actived: true
    });

    try {
        await adminData.save();
        await cacheClient.sadd(`${channelID}:admins:ids`, userData.id);
        await cacheClient.sadd(`${channelID}:admins`, adminData.adminName);

        await cacheClient.hset(`${channelID}:admins:${userData.id}`, {
            adminID: userData.id,
            adminName: adminName,
            channelID: channelID,
            channelName: channelName,
            permissions: ['*'],
            actived: true
        });
        
    } catch (error) {
        logger({error}, true, channelID, `admin-${channelID}-${adminName}`);
    }

    res.status(201).json({
        error: false,
        message: 'Admin added successfully',
        status: 201
    });
    
});

router.delete('/:channelID/:adminID', async (req, res) => {
    const cacheClient = getClient();
    const { channelID, adminID } = req.params;

    let exists = await cacheClient.exists(`${channelID}:admins:${adminID}`);

    if(exists == 0) {
        return res.status(404).json({
            error: true,
            message: "Admin not found",
            status: 404
        });
    }

    let adminData = await cacheClient.hgetall(`${channelID}:admins:${adminID}`);

    try {
        await adminSchema.findOneAndDelete({channelID, adminID});
        await cacheClient.del(`${channelID}:admins:${adminID}`);
        await cacheClient.srem(`${channelID}:admins`, adminData.adminName);
        await cacheClient.srem(`${channelID}:admins:ids`, adminData.adminID);
    } catch (error) {
        logger({error: true, message: "Deleting document on DB went wrong"}, true, channelID, `admin-${channelID}-${adminID}-delete`);
    }
    
    res.status(200).json({
        error: false,
        message: 'Admin deleted successfully',
        status: 200
    });
})

module.exports = router;