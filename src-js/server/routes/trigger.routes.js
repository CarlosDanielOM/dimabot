const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const {getUrl} = require('../../../util/dev');
const {getStreamerHeaderById} = require('../../../util/header');
const { uploadTriggerFileToS3, deleteTriggerFileFromS3 } = require('../../../util/s3');

const STREAMERS = require('../../../class/streamer');

const triggerSchema = require('../../../schema/trigger');
const triggerFileSchema = require('../../../schema/triggerfile');
const auth = require('../../../middleware/auth');
const { getIO } = require('../websocket');
const logger = require('../../../util/logger');

const acceptableMimeTypes = ['video/mp4', 'video/mov', 'video/avi', 'video/flv', 'video/wmv', 'video/webm', 'video/mkv', 'image/gif', 'image/jpg', 'image/jpeg', 'image/png', 'image/bmp', 'image/tiff', 'image/svg', 'image/webp', 'audio/mp3', 'audio/flac', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/wma', 'audio/m4a'];

router.use(auth);

router.get('/:channelID', async (req, res) => {
    const channelID = req.params.channelID;
    const query = req.query;
    const id = query.id || null;
    let trigger = [];

    if(id) {
        trigger = await triggerSchema.find({channelID: channelID, _id: id});
    } else {
        trigger = await triggerSchema.find({channelID: channelID});
    }

    res.status(200).send({
        data: trigger,
        total: trigger.length
    });
    
});

router.post('/:channelID', async (req, res) => {
    const {channelID} = req.params;
    const {name, file, type, mediaType, cost, prompt, fileID, cooldown, volume } = req.body;
    let body = req.body;

    let streamer = await STREAMERS.getStreamerById(channelID);
    if(!streamer) {
        return res.status(404).send({
            error: 'Not Found',
            message: 'Streamer not found',
            status: 404
        });
    }

    let fileData = await triggerFileSchema.findOne({name: file, channelID: channelID, fileType: mediaType});
    if(!fileData) {
        return res.status(400).send({
            error: 'Bad Request',
            message: 'File not found',
            status: 400
        });
    }
    body.title = name;
    delete body.name;
    if(!body.rewardType) body.rewardType = 'trigger';

    let streamerToken = await STREAMERS.getStreamerTokenById(channelID);

    let response = await fetch(`${getUrl()}/rewards/${channelID}`, {
        method: 'POST',
        headers: {
            'Authorization': `${streamerToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    })

    response = await response.json();
    if(response.error) {
        console.log({
            error: 'Bad Request',
            message: 'Error creating trigger',
            status: 400,
            response
        });
        return res.status(response.status).send(response);
    }
    
    let rewardData = response.data;

    let newTrigger = new triggerSchema({
        name: name,
        channel: streamer.name,
        channelID: channelID,
        rewardID: rewardData.rewardID,
        file,
        type,
        mediaType,
        cost,
        cooldown,
        volume,
        fileID: fileData._id,
    });

    try {
        await newTrigger.save();
    } catch (error) {
        console.log({
            error: 'Internal Server Error',
            message: 'Error saving trigger',
            status: 500,
            error
        });
        return res.status(500).send({
            error: 'Internal Server Error',
            message: 'Error saving trigger',
            status: 500
        });
    }

    res.status(201).send({
        data: newTrigger,
        status: 201
    });
    
});

router.post('/:channelID/send', async (req, res) => {
    const io = getIO();
    const {channelID} = req.params;
    const body = req.body;

    if (!io) {
        return res.status(500).send({
            error: true,
            message: 'Websocket not initialized',
            status: 500
        });
    }

    const namespacePath = `/overlays/triggers/${channelID}`;
    const namespace = io.of(namespacePath);

    try {
        namespace.emit('trigger', body);
    } catch (error) {
        return res.status(500).send({
            error: true,
            message: 'Error emitting trigger',
            status: 500
        });
    }

    res.status(200).send({
        error: false,
        message: 'Trigger sent',
        status: 200
    });
});

router.post('/:channelID/upload', async (req, res) => {
    const { channelID } = req.params;
    const streamer = await STREAMERS.getStreamerById(channelID);
    if(!streamer) {
        return res.status(404).send({
            error: 'Not Found',
            message: 'Streamer not found',
            status: 404
        });
    }

    // Validate triggerName - only allow a-z, A-Z, 0-9, spaces, and underscores
    if(req.body.triggerName) {
        const validNameRegex = /^[a-zA-Z0-9 ]+$/;
        if(!validNameRegex.test(req.body.triggerName)) {
            return res.status(400).send({
                error: 'Bad Request',
                message: 'Filename can only contain letters (a-z, A-Z), numbers (0-9), and spaces',
                status: 400
            });
        }
    }

    let MB = 5;
    if(streamer.premium == "true") {
        MB = 10;
    }
    if(streamer.premium_plus == "true") {
        MB = 20;
    }

    const MAX_FILE_SIZE = MB * 1024 * 1024;

    // Use multer memory storage to avoid saving to disk
    const storage = multer.memoryStorage();
    const fileFilter = async (req, file, cb) => {
        if(acceptableMimeTypes.includes(file.mimetype)) {
            if(await triggerFileSchema.exists({
                name: req.body.triggerName,
                fileType: file.mimetype,
            })) {
                cb(null, false);
                console.log(`File ${req.body.triggerName} already exists from ${streamer.name}`);
            } else {
                cb(null, true);
            }
        } else {
            cb(null, false);
            console.log(`File type ${file.mimetype} not allowed from ${streamer.name}`);
        }
    }
    multer({
        storage: storage,
        fileFilter: fileFilter,
        limits: { fileSize: MAX_FILE_SIZE }
    }).single('trigger')(req, res, async err => {
        if(err) {
            console.log({
                error: 'Bad Request',
                message: 'Error uploading file',
                status: 400,
                err
            });
            return res.status(400).send({
                error: 'Bad Request',
                message: 'Error uploading file',
                status: 400
            });
        }

        if(!req.file) {
            console.log({
                error: 'Bad Request',
                message: 'File type not allowed or file already exists',
                status: 400,
                channelID
            });
            return res.status(400).send({
                error: 'Bad Request',
                message: 'File type not allowed or file already exists',
                status: 400
            });
        }

        let exists = await triggerFileSchema.exists({
            name: req.body.triggerName,
            fileType: req.file.mimetype,
            channelID: channelID
        });

        if(exists) {
            console.log({
                error: 'Bad Request',
                message: 'File name already exists',
                status: 400,
                channelID
            });
            return res.status(400).send({
                error: 'Bad Request',
                message: 'File name already exists',
                status: 400
            });
        }

        // Directly upload to S3 from buffer
        // Keep original filename with spaces for database storage
        const filename = `${req.body.triggerName}.${req.file.mimetype.split('/')[1]}`;
        // Replace spaces with underscores for URL-friendly S3 key
        const s3SafeFilename = filename.replace(/\s+/g, '_');
        const s3Key = `${channelID}/triggers/${s3SafeFilename}`;
        let s3Url;
        try {
            s3Url = await uploadTriggerFileToS3(channelID, req.file.buffer, req.file.mimetype, s3Key);
        } catch (s3err) {
            console.log({
                error: 'Internal Server Error',
                message: 'Error uploading file to S3',
                status: 500,
                s3err
            });
            return res.status(500).send({
                error: 'Internal Server Error',
                message: 'Error uploading file to S3',
                status: 500
            });
        }

        let fileData = {
            name: req.body.triggerName,
            fileName: s3SafeFilename,
            fileSize: req.file.size,
            fileType: req.file.mimetype,
            fileUrl: s3Url,
            channel: streamer.name,
            channelID: channelID
        }

        let newFile = new triggerFileSchema(fileData);

        try {
            await newFile.save();
        } catch (error) {
            console.log({
                error: 'Internal Server Error',
                message: 'Error saving file',
                status: 500,
                error
            });
            return res.status(500).send({
                error: 'Internal Server Error',
                message: 'Error saving file',
                status: 500
            });
        }

        res.status(201).send({
            data: fileData,
            status: 201
        });
    });
});

router.delete('/:channelID/:triggerID', async (req, res) => {
    const {channelID, triggerID} = req.params;

    let trigger = await triggerSchema.findOne({channelID: channelID, _id: triggerID});
    if(!trigger) {
        return res.status(404).send({
            error: 'Not Found',
            message: 'Trigger not found',
            status: 404
        });
    }

    let streamerHeaders = await getStreamerHeaderById(channelID);
    let streamerToken = await STREAMERS.getStreamerTokenById(channelID);

    let response = await fetch(`${getUrl()}/rewards/${channelID}/${trigger.rewardID}`, {
        method: 'DELETE',
        headers: {
            'Authorization': `${streamerToken}`,
            'Content-Type': 'application/json'
        }
    });

    response = await response.json();
    if(response.error) {
        console.log({
            error: 'Bad Request',
            message: 'Error deleting trigger',
            status: 400,
            response
        });
        return res.status(400).send(response);
    }
    
    try {
        await trigger.deleteOne();
    } catch (error) {
        console.log({
            error: 'Internal Server Error',
            message: 'Error deleting trigger',
            status: 500,
            error
        });
        return res.status(500).send({
            error: 'Internal Server Error',
            message: 'Error deleting trigger',
            status: 500
        });
    }

    res.status(200).send({
        data: trigger,
        status: 200
    });
    
});

router.patch('/:channelID/:triggerID', async (req, res) => {
    const {channelID, triggerID} = req.params;
    const {name, file, type, mediaType, cost, prompt, fileID, cooldown, volume } = req.body;
    let body = req.body;

    let trigger = await triggerSchema.findOne({channelID: channelID, _id: triggerID});
    if(!trigger) {
        return res.status(404).send({
            error: 'Not Found',
            message: 'Trigger not found',
            status: 404
        });
    }

    body.title = name;
    delete body.name;
    body.prompt = prompt ?? '';

    let streamerHeaders = await getStreamerHeaderById(channelID);

    let response = await fetch(`${getUrl()}/rewards/${channelID}/${trigger.rewardID}`, {
        method: 'PATCH',
        headers: streamerHeaders,
        body: JSON.stringify(body)
    })

    response = await response.json();
    if(response.error) {
        console.log({
            error: 'Bad Request',
            message: 'Error updating trigger',
            status: 400,
            response
        });
        return res.status(response.status).send(response);
    }

    rewardData = response.data;

    try {
        let updateResult = await triggerSchema.findByIdAndUpdate(triggerID, {name, cost, prompt, cooldown, volume}, {new: true});
    } catch (error) {
        console.log({
            error: 'Internal Server Error',
            message: 'Error updating trigger',
            status: 500,
            error
        });
        return res.status(500).send({
            error: 'Internal Server Error',
            message: 'Error updating trigger',
            status: 500
        });
    }

    res.status(200).send({
        data: updateResult,
        status: 200
    });

    
});

router.get('/files/:channelID', async (req, res) => {
    const channelID = req.params.channelID;
    const query = req.query;
    const id = query.id || null;
    const name = query.name || null;

    let files = [];

    if(id) {
        files = await triggerFileSchema.find({channelID: channelID, _id: id});
    } else if (name) {
        files = await triggerFileSchema.find({channelID: channelID, name: name});
    } else {
        files = await triggerFileSchema.find({channelID: channelID});
    }

    res.status(200).send({
        data: files,
        total: files.length
    });
});

router.delete('/files/:channelID/:fileID', async (req, res) => {
    const {channelID, fileID} = req.params;

    let exists = await triggerSchema.exists({fileID: fileID});
    if(exists) {
        return res.status(400).send({
            error: 'Bad Request',
            message: 'File in use',
            status: 400
        });
    }

    let file = await triggerFileSchema.findOne({channelID: channelID, _id: fileID});
    if(!file) {
        return res.status(404).send({
            error: 'Not Found',
            message: 'File not found',
            status: 404
        });
    }

    try {
        if(file.fileUrl.includes('https://api.domdimabot.com/media')) {
            await file.deleteOne();
            return res.status(200).send({
                data: file,
                status: 200
            });
        }
        // Remove from S3 - replace spaces with underscores to match S3 key format
        const s3SafeFilename = file.fileName.replace(/\s+/g, '_');
        const s3Key = `${channelID}/triggers/${s3SafeFilename}`;
        await deleteTriggerFileFromS3(channelID, s3Key);
        await file.deleteOne();
    } catch (error) {
        console.log({
            error: 'Internal Server Error',
            message: 'Error deleting file',
            status: 500,
            error
        });
        return res.status(500).send({
            error: 'Internal Server Error',
            message: 'Error deleting file',
            status: 500
        });
    }

    res.status(200).send({
        data: file,
        status: 200
    });
    
});

module.exports = router;