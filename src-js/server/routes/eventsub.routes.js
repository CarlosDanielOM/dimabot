const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const eventsubSchema = require('../../../schema/eventsub');

const STREAMERS = require('../../../class/streamer');

const {subscribeTwitchEvent, unsubscribeTwitchEvent} = require('../../../util/eventsub');
const auth = require('../../../middleware/auth');

router.use(auth);

router.get('/:channelID', async (req, res) => {
    let channelID = req.params.channelID;

    let query = req.query;
    let type = query.type || null;
    let id = query.id || null;

    let eventsub;

    if(id) {
        if(!mongoose.isValidObjectId(id)) {
            return res.status(400).send({
                error: 'Invalid ID',
                message: 'ID is not a valid ObjectID',
                status: 400
            });
        }
        eventsub = await eventsubSchema.find({channelID: channelID, _id: id});
    } else if (type) {
        eventsub = await eventsubSchema.find({channelID: channelID, type: type});
    }
    else {
        eventsub = await eventsubSchema.find({channelID: channelID});
    }


    if (!eventsub) {
        return res.status(404).send({
            error: 'Not Found',
            message: 'No eventsub found',
            status: 404
        });
    }

    return res.status(200).send({
        data: eventsub,
        total: eventsub.length
    });
});

router.post('/:channelID', async (req, res) => {
    let channelID = req.params.channelID;
    let body = req.body;

    let type = body.type;
    let version = body.version;
    let condition = body.condition;
    let config = body.config ?? null;

    if(!type || !version || !condition) {
        return res.status(400).send({
            error: 'Bad Request',
            message: 'Missing type, version or condition',
            status: 400
        });
    }

    let eventsub = await subscribeTwitchEvent(channelID, type, version, condition, config);

    if (!eventsub) {
        return res.status(400).send({
            error: 'Bad Request',
            message: 'Failed to create eventsub',
            status: 400
        });
    }

    return res.status(201).send({
        data: eventsub
    });
});

router.delete('/:channelID/:id', async (req, res) => {
    const {channelID, id} = req.params;

    let eventsub = await eventsubSchema.findOne({channelID: channelID, _id: id});

    if (!eventsub) {
        return res.status(404).send({
            error: 'Not Found',
            message: 'Eventsub not found',
            status: 404
        });
    }

    let result = await unsubscribeTwitchEvent(eventsub.id);

    if(result.error) {
        return res.status(result.status).send({
            error: result.error,
            message: result.message,
            status: result.status
        });
    }

    return res.status(200).send({
        error: false,
        message: 'Eventsub deleted',
        status: 200
    });
    
});

router.patch('/:channelID/:id', async (req, res) => {
    const {channelID, id} = req.params;

    if(!id) {
        return res.status(400).send({
            error: 'Bad Request',
            message: 'ID is required',
            status: 400
        });
    } else {
        if(!mongoose.isValidObjectId(id)) {
            return res.status(400).send({
                error: 'Invalid ID',
                message: 'ID is not a valid ObjectID',
                status: 400
            });
        }
    } 

    let eventsub = await eventsubSchema.findOne({_id: id});

    if(!eventsub) {
        return res.status(404).send({
            error: 'Not Found',
            message: 'Eventsub not found',
            status: 404
        });
    }

    let update = await eventsubSchema.updateOne({_id: id}, req.body, {new: true});
    if(!update) {
        return res.status(400).send({
            error: 'Bad Request',
            message: 'Failed to update eventsub',
            status: 400
        });
    }

    res.status(200).send({
        error: false,
        data: update,
    })
    
});

module.exports = router;