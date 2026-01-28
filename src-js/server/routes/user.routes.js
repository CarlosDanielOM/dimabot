const express = require('express');
const router = express.Router();
const channelSchema = require('../../../schema/channel');
const STREAMERS = require('../../../class/streamer');
const { getClient } = require('../../../util/database/dragonfly');

const { getUserByLogin } = require('../../../function/user/getuser');
const { connectChannel, disconnectChannel } = require('../../../util/client');

const auth = require('../../../middleware/auth');
const logger = require('../../../util/logger');
const { incrementSiteAnalytics, decrementSiteAnalytics } = require('../../../util/siteanalytics');
const getscopes = require('../../../function/user/getscopes');

router.get('/scopes/:userID', async (req, res) => {
    const { userID } = req.params;
    let scopes = await getscopes(userID);
    if(scopes.error) {
        logger({error: true, message: 'Error fetching scopes', userID, scopes}, true, userID, `user-${userID}-scopes`);
        return res.status(scopes.status).json(scopes);
    }
    return res.status(200).json({
        error: false,
        message: 'Scopes fetched successfully',
        status: 200,
        data: scopes
    });
});

router.get('/', async (req, res) => {
    const cacheClient = getClient();
    let query = req.query;

    let username = query.username || null;

    if(!username) {
        return res.status(400).json({
            error: true,
            message: "Missing parameters",
            status: 400
        });
    }

    let userData = await getUserByLogin(username);
    if (userData.error) {
        return res.status(userData.status).json(userData);
    }

    userData = userData.data;

    let dataToSend = {
      username: userData.login,
      id: userData.id,
      display_name: userData.display_name,
      profile_image_url: userData.profile_image_url,
      offline_image_url: userData.offline_image_url,
    }

    return res.status(200).json({
        error: false,
        data: dataToSend,
        status: 200
    });
    
});

router.get('/:channelID', async (req, res) => {
  const { channelID } = req.params;

  let streamer = await STREAMERS.getStreamerById(channelID);

  if(!streamer) return res.status(404).json({ error: true, reason: 'Streamer not found' });

  delete streamer.refresh_token;

  return res.status(200).json({ error: false, streamer: streamer });
});

router.post('/premium', async (req, res) => {
    const { channel, channelID } = req.body;
    let exists = await channelSchema.findOne({ name: channel, twitch_user_id: channelID }, 'premium premium_plus');

    if (!exists) {
      res.status(400).json({ error: true, reason: 'Channel not found' });
      return false;
    }

    if (exists.premium_plus) {
        return res.status(200).json({ error: false, message: 'Channel is premium plus', premium: 'premium_plus' });
      } else if (exists.premium) {
        return res.status(200).json({ error: false, message: 'Channel is premium', premium: 'premium' });
      } else {
        return res.status(200).json({ error: false, message: 'Channel is not premium', premium: 'none' });
      }
});

router.get('/active/:channel', async (req, res) => {
  const { channel } = req.params;
  let exists = await channelSchema.findOne({ name: channel });

  if (!exists) return res.status(404).json({ message: 'Channel not found', error: true });

  if (exists.actived) {
    res.status(200).json({ message: 'Channel is active', active: true, error: false });
  } else {
    res.status(200).json({ message: 'Channel is not active', active: false, error: false });
  }
});

router.put('/active/:channelID', auth, async (req, res) => {
  const { channelID } = req.params;
  const { active } = req.body;
  const streamer = await STREAMERS.getStreamerById(channelID);

  if (typeof active !== 'boolean') {
    return res.status(400).json({ message: 'Active parameter must be a boolean', error: true });
  }

  await channelSchema.findOneAndUpdate({ twitch_user_id: channelID }, { actived: active });

  // Update analytics based on activation status
  if (active) {
    await incrementSiteAnalytics('active', 1);
  } else {
    await decrementSiteAnalytics('active', 1);
  }

  try {
    await fetch('http://localhost:3355/user/active', {
      method: 'PUT',
      body: JSON.stringify({
        channelID,
        active
      })
    })
  } catch (e) {
    logger({error: true, message: "Error on the localhost http request", channelID, e}, true, channelID, `user-${channelID}-active`);
  }

  return res.status(200).json({ message: 'Channel active status updated', error: false });
})

router.post('/chat/:channelID', async (req, res) => {
  const { channelID } = req.params;
  const { enabled } = req.body;

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ 
      message: 'Enabled parameter must be a boolean', 
      error: true 
    });
  }

  let exists = await channelSchema.findOne({ twitch_user_id: channelID });

  if (!exists) {
    return res.status(404).json({ 
      message: 'Channel not found', 
      error: true 
    });
  }

  try {
    await channelSchema.findOneAndUpdate(
      { twitch_user_id: channelID },
      { chat_enabled: enabled }
    );

    // Update the streamer in cache
    await STREAMERS.updateStreamerById(channelID);

    res.status(200).json({ 
      message: `Chat ${enabled ? 'enabled' : 'disabled'} for channel`, 
      error: false 
    });
  } catch (error) {
    res.status(500).json({ 
      message: 'Error updating chat status', 
      error: true 
    });
  }
});

module.exports = router;