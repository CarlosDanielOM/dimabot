const express = require('express');
const router = express.Router();

const commandSchema = require('../../../schema/command');

const auth = require('../../../middleware/auth');
const { getClient } = require('../../../util/database/dragonfly');

router.use(auth);

router.get('/', async (req, res) => {
    let query = req.query;

    let limit = query.limit ? parseInt(query.limit) : 100;
    let skip = query.skip ? parseInt(query.skip) : 0;

    try {
        const commands = await commandSchema.find().skip(skip).limit(limit);
        res.send({
            message: 'Commands fetched',
            commands: commands,
            status: 200,
            total: commands.length
        });
    } catch (error) {
        res.status(500).send({
            message: 'Error fetching commands',
            error: error,
            status: 500
        });
    }
});

router.get('/:channelID', async (req, res) => {
    const { channelID } = req.params;
    let query = req.query;

    let limit = query.limit ? parseInt(query.limit) : 100;
    let skip = query.skip ? parseInt(query.skip) : 0;

    try {
        const commands = await commandSchema.find({ channelID: channelID }).skip(skip).limit(limit);

        res.send({
            message: 'Commands fetched from database',
            commands: commands,
            status: 200,
            total: commands.length
        });
    } catch (error) {
        res.status(500).send({
            message: 'Error fetching commands',
            error: error,
            status: 500
        });
    }
});

router.post('/:channelID', async (req, res) => {
    const cacheClient = getClient();
    const { channelID } = req.params;
    let body = req.body;

    if (!body.name || !body.cmd || !body.func || !body.message || !body.channel) {
        return res.status(400).send({
            error: 'Missing required fields',
            message: 'Missing required fields',
            status: 400
        });
    }

    // Check if the command already exists in the database
    const existingCommand = await commandSchema.findOne({
        channelID: channelID,
        cmd: body.cmd
    });

    if (existingCommand) {
        return res.status(409).send({
            error: 'Command already exists',
            message: 'Command already exists',
            command: existingCommand,
            status: 409
        });
    }

    let newCommand = new commandSchema({
        name: body.name,
        cmd: body.cmd,
        func: body.func,
        message: body.message,
        responses: body.responses ?? [],
        type: body.type ?? 'command',
        reserved: body.reserved ?? false,
        description: body.description ?? '',
        cooldown: body.cooldown ?? 10,
        enabled: body.enabled ?? true,
        userLevelName: body.userLevelName ?? 'everyone',
        userLevel: body.userLevel ?? 1,
        channelID: channelID,
        channel: body.channel,
    })
    
    try {
        await newCommand.save();
        await cacheClient.del(`${channelID}:commands:${body.cmd}`);
        await cacheClient.del(`${channelID}:commands:${body.name}`);

        res.send({
            message: 'Command created',
            command: newCommand,
            status: 200
        });
    } catch (error) {
        res.status(500).send({
            message: 'Error creating command',
            error: error,
            status: 500
        });
    }
});

router.put('/:channelID/:commandID', async (req, res) => {
    const { channelID, commandID } = req.params;
    let body = req.body;

    const cacheClient = getClient();

    try {
        const updatedCommand = await commandSchema.findOneAndUpdate(
            { channelID: channelID, _id: commandID },
            body,
            { new: true }
        );
        
        if (!updatedCommand) {
            return res.status(404).send({
                error: 'Not found',
                message: 'Command not found for this channel',
                status: 404
            });
        }

        await cacheClient.del(`${channelID}:commands:${updatedCommand.cmd}`);

        res.send({
            message: 'Command updated',
            command: updatedCommand,
            status: 200
        });
    } catch (error) {
        res.status(500).send({
            message: 'Error updating command',
            error: error,
            status: 500
        });
    }
});

router.delete('/:channelID/:commandID', async (req, res) => {
    const { channelID, commandID } = req.params;
    const cacheClient = getClient();

    try {
        const deletedCommand = await commandSchema.findOneAndDelete({ channelID: channelID, _id: commandID });
        
        if (!deletedCommand) {
            return res.status(404).send({
                error: 'Not found',
                message: 'Command not found for this channel',
                status: 404
            });
        }

        await cacheClient.del(`${channelID}:commands:${deletedCommand.cmd}`);

        res.send({
            message: 'Command deleted',
            command: deletedCommand,
            status: 200
        }); 
    } catch (error) {
        res.status(500).send({
            message: 'Error deleting command',
            error: error,
            status: 500
        });
    }
});



module.exports = router;