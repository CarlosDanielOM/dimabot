/**
 * Message Parsers Module
 * 
 * This module provides utilities for parsing different message formats
 * into the legacy TMI.js format used by the message handler.
 */

const {
    parseEventSubMessage,
    parseAndHandleChatMessage,
    mapBadges,
    BOT_USER_ID
} = require('./chatMessageParser');

module.exports = {
    // EventSub to TMI.js adapter
    parseEventSubMessage,
    parseAndHandleChatMessage,
    mapBadges,
    BOT_USER_ID
};
