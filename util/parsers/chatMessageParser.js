require('dotenv').config();

const CLIENT = require('../client');
const messageHandler = require('../../handler/message');

// Bot's User ID - used for self detection
const BOT_USER_ID = process.env.BOT_USER_ID || '698614112';

/**
 * Maps EventSub badges array to TMI.js style badge boolean flags and objects
 * 
 * @param {Array} badges - EventSub badges array [{set_id: string, id: string, info: string}]
 * @returns {Object} Object containing badge flags and badge objects for TMI.js compatibility
 */
function mapBadges(badges) {
    const result = {
        // Boolean flags for permission checks
        mod: false,
        subscriber: false,
        vip: false,
        turbo: false,
        broadcaster: false,
        // TMI.js badges object (e.g., { moderator: '1', subscriber: '1000' })
        badges: {},
        // TMI.js badge-info object (e.g., { subscriber: '12' })
        'badge-info': {},
        // Raw badge-info string (e.g., 'subscriber/12')
        'badge-info-raw': ''
    };

    if (!badges || !Array.isArray(badges)) {
        return result;
    }

    const badgeInfoParts = [];

    for (const badge of badges) {
        const { set_id, id, info } = badge;

        // Populate the badges object with set_id as key and id as value
        result.badges[set_id] = id;

        // Set boolean flags based on set_id
        switch (set_id) {
            case 'moderator':
                result.mod = true;
                break;
            case 'subscriber':
                result.subscriber = true;
                // Store subscriber info (months) in badge-info
                if (info) {
                    result['badge-info'].subscriber = parseInt(info, 10) || 0;
                    badgeInfoParts.push(`subscriber/${info}`);
                } else {
                    result['badge-info'].subscriber = 0;
                    badgeInfoParts.push(`subscriber/0`);
                }
                break;
            case 'founder':
                result.subscriber = true; // Founders are also subscribers
                if (info) {
                    result['badge-info'].subscriber = parseInt(info, 10) || 0;
                    badgeInfoParts.push(`founder/${info}`);
                }
                break;
            case 'vip':
                result.vip = true;
                break;
            case 'turbo':
                result.turbo = true;
                break;
            case 'broadcaster':
                result.broadcaster = true;
                result.mod = true; // Broadcasters have mod permissions
                break;
            case 'sub-gifter':
                // Store sub-gifter info if present
                if (info) {
                    result['badge-info']['sub-gifter'] = parseInt(info, 10) || 0;
                }
                break;
        }
    }

    // Build badge-info-raw string
    result['badge-info-raw'] = badgeInfoParts.join(',');

    return result;
}

/**
 * Parses an EventSub channel.chat.message payload into TMI.js format
 * 
 * @param {Object} event - The EventSub event payload
 * @returns {Object} Object containing { channel, tags, message, self }
 */
function parseEventSubMessage(event) {
    // Map badges to TMI.js format
    const badgeData = mapBadges(event.badges);

    // Build tags object (TMI.js userstate)
    const tags = {
        // User identification
        'user-id': event.chatter_user_id,
        'room-id': event.broadcaster_user_id,
        'username': event.chatter_user_login,
        'display-name': event.chatter_user_name,
        
        // Message identification
        'id': event.message_id,
        
        // Badge boolean flags for permission checks
        'mod': badgeData.mod,
        'subscriber': badgeData.subscriber,
        'vip': badgeData.vip,
        'turbo': badgeData.turbo,
        'broadcaster': badgeData.broadcaster,
        
        // Badge objects for detailed badge information
        'badges': badgeData.badges,
        'badge-info': badgeData['badge-info'],
        'badge-info-raw': badgeData['badge-info-raw'],
        
        // Color (if provided)
        'color': event.color || '',
        
        // Message type
        'message-type': event.message_type || 'chat',
        
        // Emotes (if present in message)
        'emotes': parseEmotes(event.message?.fragments),
        
        // First message flag
        'first-msg': event.source_badges?.some(b => b.set_id === 'firstmessage') || false,
        
        // Returning chatter flag
        'returning-chatter': event.message_type === 'returning_chatter'
    };

    // Extract message text
    const message = event.message?.text || '';

    // Channel name (without # prefix, as handler expects it without)
    const channel = event.broadcaster_user_login;

    // Self detection - compare chatter_user_id with bot's user ID
    const self = event.chatter_user_id === BOT_USER_ID;

    return {
        channel,
        tags,
        message,
        self
    };
}

/**
 * Parses EventSub message fragments to build TMI.js emotes format
 * 
 * @param {Array} fragments - Message fragments from EventSub
 * @returns {Object|null} Emotes object in TMI.js format or null
 */
function parseEmotes(fragments) {
    if (!fragments || !Array.isArray(fragments)) {
        return null;
    }

    const emotes = {};
    let currentPosition = 0;

    for (const fragment of fragments) {
        const fragmentLength = fragment.text?.length || 0;

        if (fragment.type === 'emote' && fragment.emote) {
            const emoteId = fragment.emote.id;
            const startPos = currentPosition;
            const endPos = currentPosition + fragmentLength - 1;

            if (!emotes[emoteId]) {
                emotes[emoteId] = [];
            }
            emotes[emoteId].push(`${startPos}-${endPos}`);
        }

        currentPosition += fragmentLength;
    }

    return Object.keys(emotes).length > 0 ? emotes : null;
}

/**
 * Wrapper function that parses EventSub payload and calls the legacy messageHandler
 * 
 * @param {Object} event - The EventSub channel.chat.message event payload
 * @returns {Promise<void>}
 */
async function parseAndHandleChatMessage(event) {
    // Parse the EventSub event into TMI.js format
    const { channel, tags, message, self } = parseEventSubMessage(event);

    // Skip messages from the bot itself
    if (self) {
        return;
    }

    // Get the TMI client instance
    const client = CLIENT.getClient();

    // Call the legacy message handler with parsed data
    await messageHandler(client, channel, tags, message);
}

module.exports = {
    parseEventSubMessage,
    parseAndHandleChatMessage,
    mapBadges,
    BOT_USER_ID
};
