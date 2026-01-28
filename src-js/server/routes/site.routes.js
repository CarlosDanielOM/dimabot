const express = require('express');
const router = express.Router();
const auth = require('../../../middleware/auth');
const { getClient } = require('../../../util/database/dragonfly');
const Event = require('../../../schema/event');
const mongoose = require('mongoose');

router.use(auth);

router.get('/', (req, res) => {
    let cacheClient = getClient();
});



// POST endpoint to create a new event
router.post('/events', async (req, res) => {
    try {
        const eventData = req.body;
        
        // Validate required fields
        const requiredFields = ['name', 'type', 'icon', 'color', 'textColor', 'description', 'config'];
        for (const field of requiredFields) {
            if (!eventData[field]) {
                return res.status(400).json({
                    success: false,
                    message: `Missing required field: ${field}`
                });
            }
        }

        // Validate description structure
        if (!eventData.description.EN || !eventData.description.ES) {
            return res.status(400).json({
                success: false,
                message: 'Description must include both EN and ES translations'
            });
        }

        // Validate config array
        if (!Array.isArray(eventData.config) || eventData.config.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Config must be a non-empty array'
            });
        }

        // Validate each config item
        for (const configItem of eventData.config) {
            if (!configItem.id || !configItem.label || !configItem.type || configItem.value === undefined) {
                return res.status(400).json({
                    success: false,
                    message: 'Each config item must have id, label, type, and value'
                });
            }
            
            if (!configItem.label.EN || !configItem.label.ES) {
                return res.status(400).json({
                    success: false,
                    message: 'Each config label must include both EN and ES translations'
                });
            }
        }

        // Check if event with same type already exists
        const existingEvent = await Event.findOne({ type: eventData.type });
        if (existingEvent) {
            return res.status(409).json({
                success: false,
                message: `Event with type '${eventData.type}' already exists`
            });
        }

        // Create new event
        const newEvent = new Event(eventData);
        const savedEvent = await newEvent.save();

        res.status(201).json({
            success: true,
            message: 'Event created successfully',
            data: savedEvent
        });

    } catch (error) {
        console.error('Error creating event:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// GET endpoint to retrieve all events
router.get('/events', async (req, res) => {
    try {
        const events = await Event.find().sort({ createdAt: -1 });
        
        res.status(200).json({
            success: true,
            data: events
        });
    } catch (error) {
        console.error('Error fetching events:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// GET endpoint to retrieve a specific event by type
router.get('/events/:type', async (req, res) => {
    try {
        const event = await Event.findOne({ type: req.params.type });
        
        if (!event) {
            return res.status(404).json({
                success: false,
                message: 'Event not found'
            });
        }

        res.status(200).json({
            success: true,
            data: event
        });
    } catch (error) {
        console.error('Error fetching event:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

router.patch('/events/:id', async (req, res) => {
    let event;
    try {
        if(!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).send({
                error: 'Invalid ID',
                message: 'ID is not a valid ObjectID',
                status: 400
            });
        }
        event = await Event.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if(!event) {
            return res.status(404).send({
                error: 'Event not found',
                message: 'Event not found',
                status: 404
            });
        }
    } catch (error) {
        console.error('Error updating event:', error);
        if(error.name === 'CastError') {
        res.status(500).json({
                success: false,
                message: 'Invalid ID',
                error: 'ID is not a valid ObjectID',
                status: 400
            });
        }
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
    res.status(200).json({
        success: true,
        message: 'Event updated successfully',
        data: event
    });
});

module.exports = router;