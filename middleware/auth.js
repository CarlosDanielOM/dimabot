require('dotenv').config();
const { getClient } = require("../util/database/dragonfly");

async function auth(req, res, next) {
    let cacheClient = getClient();

    let token = req.headers['authorization'] || req.headers['Authorization'];
    if (!token) {
        return res.status(401).send({
            error: 'Unauthorized',
            message: 'No token provided',
            status: 401
        });
    }

    // If token starts with "Bearer ", remove the prefix
    if (token.startsWith('Bearer ')) {
        token = token.slice(7); // Remove "Bearer " (7 characters)
    }

    let exists = await cacheClient.exists(`token:${token}`);

    if (exists) {
        return next();
    }

    let response = await fetch(`https://id.twitch.tv/oauth2/validate`, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });

    let data = await response.json();

    if (data.status === 401) {
        return res.status(401).send({
            error: 'Unauthorized',
            message: 'Invalid token',
            status: 401
        });
    }

    response = await fetch(`https://api.twitch.tv/helix/users`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Client-ID': process.env.CLIENT_ID
        }
    });

    response = await response.json();

    if (response.error) {
        return res.status(401).send({
            error: 'Unauthorized',
            message: 'Invalid token or user not found or invalid ID',
            status: 401
        });
    }
    if (response.data.length === 0) {
        return res.status(401).send({
            error: 'Unauthorized',
            message: 'Invalid token',
            status: 401
        });
    }

    data = response.data[0];

    try {
        await cacheClient.hmset(`token:${token}`, data)
        await cacheClient.expire(`token:${token}`, 14000);
    } catch (e) {
        logger({error: true, message: "Error saving token to cache"}, true, channelID, `auth-${channelID}-${token}`);
    }

    next();

}

module.exports = auth;