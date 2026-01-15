require('dotenv').config();
const COMMANDS = require('../command');
const categories = require('../function/search/categories')
const STREAMERS = require('../class/streamer');
const CHAT = require('../function/chat');
const CHANNEL = require('../function/channel');
const commandSchema = require('../schema/command');
const logger = require('../util/logger');
const chatHistory = require('../class/chatHistory');
const sendChatMessage = require('../function/chat/sendmessage');

const COOLDOWNS = require('../class/cooldown')

const commandsRegex = new RegExp(/^!([\p{L}\p{N}]+)(?:\W@?)?(.*)?$/u);
const linkRegex = new RegExp(/((http|https):\/\/)?(www\.)?[a-zA-Z-]+(\.[a-zA-Z-]{2})+(:\d+)?(\/\S*)?(\?\S+)?/gi);

const commandHandler = require('./command');
const { getClient } = require('../util/database/dragonfly');

const modID = '698614112';
let channelInstances = new Map();

let isMod = false;
let user = null;

let isAndoni = false;

//? Test imports
const flash8b = require('../util/ai/google/flash.8b');
const messageLogger = require('./messagelogger');
const { AiResponse } = require('../util/ai/openrouter/messages');
const formatBadges = require('../util/badges');
const router = require('../util/ai/openrouter/router');

async function message(client, channel, tags, message) {
    let streamer = await STREAMERS.getStreamerByName(channel);
    let channelID = streamer.user_id;

    if(channel == 'andonide') {
        if(message == 'a' && !isAndoni) {
            isAndoni = true;
            sendChatMessage(channelID, 'A la verga Power Rangerrrr!');
            setTimeout(() => {
                isAndoni = false;
            }, 10000);
        }
    }
    
    let cacheClient = getClient();
    let userLevel = await giveUserLevel(channel, tags, channelID);
    messageLogger(channelID, tags, message);

    let formattedBadges = formatBadges(tags);

    // Add message to chat history
    await chatHistory.addMessage(channelID, tags.username, message, formattedBadges);

    // Deletes links from chat if user is not a mod or streamer for certain channels
    let haslink = message.match(linkRegex);
    if(haslink && !tags.mod && tags.username !== channel && tags.username !== 'domdimabot') {
        if(channel == 'cdom201' || channel == 'ariascarletvt') {
            await CHAT.deleteMessage(tags.id, channelID, modID);
        }
    }

    let onCooldown = false;

    if(!channelInstances.has(channel)) {
        channelInstances.set(channel, new COOLDOWNS());
    }
    let channelInstance = channelInstances.get(channel);
    
    if(tags.mod || tags.username === channel) {
        isMod = true;
    }

    const [raw, command, argument] = message.match(commandsRegex) || [];

    if(!command) {
        if(message.startsWith('@domdimabot') || message.startsWith('@DomDimaBot') || message.includes('@domdimabot') || message.includes('@DomDimaBot')) {
            let aiInput = message.replace('@domdimabot', '');

            if(channel == 'ozbellvt' || channel == 'littlehuntervt') return;

            // Get recent messages based on channel tier
            const recentMessages = await chatHistory.getRecentMessages(channelID, streamer.premium_plus ? 15 : 7);

            let aiResponse = await router(channelID, aiInput, '@preset/router', recentMessages, tags, [{reasoning: {'effort': 'medium'}}, {usage: {'include': true}}, {'user': `${channelID}`}], streamer);

            sendChatMessage(channelID, aiResponse.message);
        }
        return;
    };

    // logger({command, argument, channel, channelID, user: tags.username}, true, channelID, 'command');

    let commandFunc = await cacheClient.hget(`${channelID}:commands:${command}`, 'func');
    let commandUserLevel = await cacheClient.hget(`${channelID}:commands:${command}`, 'level');
    let commandCD = await cacheClient.hget(`${channelID}:commands:${command}`, 'cooldown');
    let commandEnabled = await cacheClient.hget(`${channelID}:commands:${command}`, 'enabled');
    if(!commandFunc) {
        let commandData = await commandSchema.findOne({channelID, cmd: command});
        if(!commandData) {
            let cacheCommandData = {
                func: 'none',
                level: 0,
                cooldown: 0,
                enabled: 'false'
            }
            // Saves non existing command to cache as disabled
            await cacheClient.hset(`${channelID}:commands:${command}`, cacheCommandData);
            commandFunc = 'none';
            commandUserLevel = 0;
            commandCD = 0;
            commandEnabled = 'false';
        } else {
            let cacheCommandData = {
                func: commandData.func,
                level: commandData.userLevel,
                cooldown: commandData.cooldown,
                enabled: commandData.enabled ? 'true' : 'false'
            }
            // Saves command to cache
            await cacheClient.hset(`${channelID}:commands:${command}`, cacheCommandData);
            commandFunc = commandData.func;
            commandUserLevel = commandData.userLevel;
            commandCD = commandData.cooldown;
            commandEnabled = commandData.enabled ? 'true' : 'false';
        }
    }

    // Check if command is enabled (handles string "true"/"false", "0"/"1", boolean, null, undefined)
    if(commandEnabled === null || commandEnabled === undefined) {
        return;
    }
    
    // Convert to string for comparison (handles both string and number values from cache)
    const enabledStr = String(commandEnabled).toLowerCase().trim();
    
    // Only proceed if enabled is "true" or "1", otherwise return early
    if(enabledStr !== 'true' && enabledStr !== '1') {
        return;
    }
    
    if(!commandUserLevel) {
        console.log(`Command ${command} user level was not found for ${channel} `);
        commandUserLevel = 7;
    }

    if(userLevel < commandUserLevel && command !== 'game' && command !== 'title') {
        return;
    }

    if(channelInstance.hasCooldown(command)) {
        onCooldown = true;
    }

    if(onCooldown) {
        return;
    }
    
    let res = null;

    switch(commandFunc) {
        case 'ruletarusa':
            if((tags.username !== channel && !tags.mod) || !isMod) isMod = false;
            res = await COMMANDS.ruletarusa(channelID, tags.username, isMod);
            break;
        case 'anuncio':
            let announcementData = argument.split(';');
            let message = announcementData[0];
            let color = announcementData[1];

            res = await CHAT.announcement(channelID, modID, message, color);

            if(!res.error) res.message = '';
            
            break;
        case 'promo':
            res = await COMMANDS.promo(channelID, argument);
            break;
        case 'shoutout':
            res = await COMMANDS.shoutout(channelID, argument, 'purple');
            break;
        case 'predi':
            res = await COMMANDS.prediction('CREATE', channelID, argument);
            break;
        case 'endpredi':
            res = await COMMANDS.prediction('RESOLVED', channelID, argument);
            break;
        case 'cancelpredi':
            res = await COMMANDS.prediction('CANCELED', channelID, argument);
            break;
        case 'lockpredi':
            res = await COMMANDS.prediction('LOCKED', channelID, argument);
            break;
        case 'poll':
            res = await COMMANDS.poll('CREATE', channelID, argument);
            break;
        case 'cancelpoll':
            res = await COMMANDS.poll('ARCHIVED', channelID, argument);
            break;
        case 'endpoll':
            res = await COMMANDS.poll('TERMINATED', channelID, argument);
            break;
        case 'game':
            res = await COMMANDS.game(channelID, argument, userLevel, commandUserLevel);
            break;
        case 'title':
            res = await COMMANDS.title(channelID, argument, userLevel, commandUserLevel, streamer.premium);
            break;
        case 'speach':
            res = await COMMANDS.speach(channelID, tags, argument);
            if(!res.error) res.message = '';
            break;
        case 'sumimetro':
            res = await COMMANDS.sumimetro(channelID, tags['display-name'], argument || tags['display-name'], command);
            break;
        case 'memide':
            res = COMMANDS.memide(tags['display-name']);
            break;
        case 'amor':
            res = COMMANDS.amor(tags, argument);
            break;
        case 'ponerla':
            res = COMMANDS.ponerla(tags['display-name']);
            break;
        case 'mecabe':
            res = COMMANDS.mecabe(tags['display-name']);
            break;
        case 'onlyemotes':
            res = await COMMANDS.onlyEmotes(channelID, argument);
            break;
        case 'createCommand':
            res = await COMMANDS.createCommand(channelID, argument);
            break;
        case 'deleteCommand':
            res = await COMMANDS.deleteCommand(channelID, argument, userLevel);
            break;
        case 'editCommand':
            res = await COMMANDS.editCommand(channelID, argument, userLevel);
            break;
        case 'followage':
            res = await COMMANDS.followage(channelID, argument || tags['display-name']);
            break;
        case 'createClip':
            sendChatMessage(channelID, 'Saving clip...');
            res = await COMMANDS.createClip(channelID);
            break;
        case 'commands':
            res = await COMMANDS.commandList(channelID, userLevel);
            break;
        case 'clearChat':
            res = await CHAT.clearChat(channelID, channelID);
            break;
        case 'enableCommand':
            res = await COMMANDS.enableCommand(channelID, argument);
            break;
        case 'disableCommand':
            res = await COMMANDS.disableCommand(channelID, argument);
            break;
        case 'furrometro':
            res = await COMMANDS.furrometro(channelID, argument || tags['display-name']);
            break;
        case 'mod':
            res = await COMMANDS.addModerator(channelID, argument);
            break;
        case 'unmod':
            res = await COMMANDS.removeModerator(channelID, argument);
            break;
        case 'vip':
            res = await COMMANDS.addVIP(channelID, argument, tags);
            break;
        case 'unvip':
            res = await COMMANDS.removeVIP(channelID, argument);
            break;
        case 'createCommandTimer':
            res = await COMMANDS.createTimerCommand(channelID, argument);
            break;
        case 'deleteCommandTimer':
            res = await COMMANDS.deleteTimerCommand(channelID, argument);
            break;
        case 'editCommandTimer':
            res = await COMMANDS.editTimerCommand(channelID, argument);
            break;
        case 'spotifySongRequest':
            try {
                res = await COMMANDS.spotifySongRequest(channelID, argument);
            } catch (error) {
                console.log({error});
            }
            break;
        case 'countdownTimer':
            res = await COMMANDS.countdownTimer(channelID, argument);
            break;
        case 'vanish':
            res = await COMMANDS.vanish(channelID, tags);
            break;
        case 'duel':
            res = await COMMANDS.duel(channelID, tags['username'], tags.mod, argument);
            break;
        case 'pechos':
            res = await COMMANDS.pechos(channelID, tags);
            break;
        case 'miyuloot':
            res = await COMMANDS.miyuloot(channelID, tags);
            break;
        default:
            let cmdHandler = await commandHandler(channelID, tags, command, argument);
            if(cmdHandler.error) {
                res = cmdHandler;
                break;
            }
            let cmd = cmdHandler.command;
            res = cmdHandler;
            break;
    }

    if(commandCD !== 0) {
        channelInstance.setCooldown(command, commandCD);
    }

    if(res.error) {
        logger({error: true, message: res.message, response: res, username: tags.username, channel: channel}, true, channelID, `command-${channelID}-${command}-${tags.username}`);
    }
    
    if(!res.message) return;
    
    sendChatMessage(channelID, res.message)
    
}

module.exports = message;

async function giveUserLevel(channel, tags, channelID) {
    let userLevel = 1;
    let cacheClient = getClient();

    if(tags.subscriber) {
        userLevel = tags['badge-info'].subscriber + 1;
    }

    if(tags.vip) {
        userLevel = 5;
    }

    if (tags.subscriber) {
        if (tags['badge-info-raw'].split('/')[0] === 'founder') {
            userLevel = 6;
        }
    }

    if (tags.mod) {
        userLevel = 7;
    }

    let isEditor = await cacheClient.sismember(`${channelID}:channel:editors`, tags.username);
    if(isEditor == 1) {
        userLevel = 8;
    }

    // Admins level 9
    let isAdmin = await cacheClient.sismember(`${channelID}:admins`, tags.username);
    if(isAdmin == 1) {
        userLevel = 9;
    }

    if (tags.username === channel) {
        userLevel = 10;
    }
    
    return userLevel;
    
}