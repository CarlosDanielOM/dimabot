const express = require('express');
const router = express.Router();
const ChannelAIPersonality = require('../../../schema/channelAIPersonality');
const Channel = require('../../../schema/channel');

// Get channel AI personality
router.get('/:channelID', async (req, res) => {
    try {
        const personality = await ChannelAIPersonality.findOne({ channelID: req.params.channelID });
        if (!personality) {
            return res.status(404).json({ error: true, message: 'Channel personality not found' });
        }

        // Get channel tier information
        const channel = await Channel.findOne({ twitch_user_id: req.params.channelID });
        if (!channel) {
            return res.status(404).json({ error: true, message: 'Channel not found' });
        }

        // Add tier information to response
        const response = personality.toObject();
        response.tier = {
            isPremiumPlus: channel.premium_plus,
            isPremium: channel.premium,
            limits: {
                rules: channel.premium_plus ? 'unlimited' : (channel.premium ? 5 : 3),
                knownUsers: channel.premium_plus ? 'unlimited' : (channel.premium ? 10 : 3),
                contextWindow: channel.premium_plus ? 15 : 7
            }
        };

        res.json({ error: false, data: response });
    } catch (error) {
        res.status(500).json({ error: true, message: 'Error fetching channel personality' });
    }
});

// Update channel AI personality
router.put('/:channelID', async (req, res) => {
    try {
        const { personality, rules, knownUsers } = req.body;
        const channel = await Channel.findOne({ twitch_user_id: req.params.channelID });
        
        if (!channel) {
            return res.status(404).json({ error: true, message: 'Channel not found' });
        }

        // Check limits before updating
        if (!channel.premium_plus) {
            if (channel.premium) {
                if (rules && rules.length > 5) {
                    return res.status(400).json({ 
                        error: true, 
                        message: 'Premium channels can only have up to 5 rules' 
                    });
                }
                if (knownUsers && knownUsers.length > 10) {
                    return res.status(400).json({ 
                        error: true, 
                        message: 'Premium channels can only have up to 10 known users' 
                    });
                }
            } else {
                if (rules && rules.length > 3) {
                    return res.status(400).json({ 
                        error: true, 
                        message: 'Free channels can only have up to 3 rules' 
                    });
                }
                if (knownUsers && knownUsers.length > 5) {
                    return res.status(400).json({ 
                        error: true, 
                        message: 'Free channels can only have up to 5 known users' 
                    });
                }
            }
        }

        const updateData = {
            personality,
            rules,
            knownUsers,
            contextWindow: channel.premium_plus ? 15 : 3,
            updatedAt: new Date()
        };

        const updatedPersonality = await ChannelAIPersonality.findOneAndUpdate(
            { channelID: req.params.channelID },
            updateData,
            { new: true, upsert: true }
        );

        res.json({ error: false, data: updatedPersonality });
    } catch (error) {
        res.status(500).json({ error: true, message: error.message || 'Error updating channel personality' });
    }
});

// Add or update known user
router.post('/:channelID/known-users', async (req, res) => {
    try {
        const { username, description, relationship } = req.body;
        const channel = await Channel.findOne({ twitch_user_id: req.params.channelID });
        
        if (!channel) {
            return res.status(404).json({ error: true, message: 'Channel not found' });
        }

        const personality = await ChannelAIPersonality.findOne({ channelID: req.params.channelID });
        if (!personality) {
            return res.status(404).json({ error: true, message: 'Channel personality not found' });
        }

        // Check limits before adding
        if (!channel.premium_plus) {
            const currentCount = personality.knownUsers.length;
            if (channel.premium && currentCount >= 10) {
                return res.status(400).json({ 
                    error: true, 
                    message: 'Premium channels can only have up to 10 known users' 
                });
            }
            if (!channel.premium && currentCount >= 3) {
                return res.status(400).json({ 
                    error: true, 
                    message: 'Free channels can only have up to 3 known users' 
                });
            }
        }

        const userIndex = personality.knownUsers.findIndex(u => u.username === username);
        if (userIndex >= 0) {
            personality.knownUsers[userIndex] = {
                username,
                description,
                relationship,
                lastInteraction: new Date()
            };
        } else {
            personality.knownUsers.push({
                username,
                description,
                relationship,
                lastInteraction: new Date()
            });
        }

        personality.updatedAt = new Date();
        await personality.save();

        res.json({ error: false, data: personality });
    } catch (error) {
        res.status(500).json({ error: true, message: error.message || 'Error updating known user' });
    }
});

module.exports = router; 