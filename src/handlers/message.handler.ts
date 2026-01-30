import TwitchStreamers from "../classes/twitch_streamers.class.js";
import ChatHistory from "../classes/chat_history.js";
import { commandHandler } from "./commands.handler.js";

import { COOLDOWN } from "../classes/cooldown.class.js";

const commandsRegex = new RegExp(/^!([\p{L}\p{N}]+)(?:\W@?)?(.*)?$/u);
const linkRegex = new RegExp(/((http|https):\/\/)?(www\.)?[a-zA-Z-]+(\.[a-zA-Z-]{2})+(:\d+)?(\/\S*)?(\?\S+)?/gi);

//? TODO: Import commands
import { getDragonflyClient } from "../utils/databases/dragonfly.database.js";
import type { IChatMessage } from "../interfaces/twitch/eventsub.interface.js";
import { sendTwitchChatMessage } from "../functions/chats/send_message.chat.js";
import Commands from "../classes/command.class.js";
import { sumimetroCommand } from "../commands/sumimetro.command.js";
import { indexCommands } from "../commands/index.commands.js";

const modID = '698614112';
const CHANNEL_INSTANCES = new Map<string, COOLDOWN>();

let isMod = false;
let tries = 0;

export const messageHandler = async (channelID: string, messageEventData: IChatMessage) => {
    try {
        const STREAMER = await TwitchStreamers.getTwitchAccountById(channelID);
        const cache = await getDragonflyClient('MessageHandler');

        const userLevel = await giveUserLevel(channelID, messageEventData);

        let on_cooldown = false;
        if(!CHANNEL_INSTANCES.has(channelID)) {
            CHANNEL_INSTANCES.set(channelID, new COOLDOWN());
        }
        const channelInstance = CHANNEL_INSTANCES.get(channelID);
        if(!channelInstance) {
            return;
        }

        if(messageEventData.badges.some(badge => badge.set_id === 'moderator') || messageEventData.chatter_user_id === channelID) isMod = true;

        const [raw, command, argument] = messageEventData.message.text.match(commandsRegex) || [];

        if(!command) {
            //* TODO: AI response
            if(messageEventData.message.text.startsWith('@domdimabot') || messageEventData.message.text.startsWith('@DomDimaBot') || messageEventData.message.text.includes('@domdimabot') || messageEventData.message.text.includes('@DomDimaBot')) {
                sendTwitchChatMessage(channelID, 'Ando en mantenimiento, un bug cibernetico se comio mis circuitos');
            }
        }

        let commandFunc = 'none';
        let commandCD = '0';
        let commandEnabled = 'false';
        let commandLevel = '0';

        let commandDBData = await Commands.getCommandFromDB(channelID, command);
        if(!commandDBData.error && commandDBData.command) {
            commandFunc = commandDBData.command.func ?? 'none';
            commandCD = String(commandDBData.command.cooldown ?? 0);
            commandEnabled = String(commandDBData.command.enabled ?? false);
            commandLevel = String(commandDBData.command.userLevel ?? 0);
        }
        
        
        if(channelInstance!.hasCooldown(command)) {
            on_cooldown = true;
        }

        if(on_cooldown) return;
        
        let res = null;
        
        switch(commandFunc) {
            case 'sumimetro':
                res = await indexCommands.sumimetro(channelID, messageEventData.chatter_user_login!, messageEventData.message.text.split(`!${command}`)[1].trim(), command);
                break;
            default:
                const cmdResult = await commandHandler(channelID, messageEventData, command, argument);
                if (!cmdResult.error && cmdResult.message) {
                    res = { error: false, message: cmdResult.message };
                }
                break;
            }

        if(commandCD !== '0') {
            channelInstance!.setCooldown(command, parseInt(commandCD! ?? '0', 10));
        }

        if(commandEnabled !== 'true') {
            tries++; 
            if(tries % 50 == 0) {
                sendTwitchChatMessage(channelID, 'Ando en mantenimiento, un bug cibernetico se comio mis circuitos');
            }
            return;
        };

        if(res!.error) {
            // logger({error: true, message: res.message, response: res, username: messageEventData.chatter_user_name, channel: messageEventData.channel_name}, true, channelID, `command-${channelID}-${command}-${messageEventData.chatter_user_name}`);
        }
        
        if(!res!.message) return;
        
        sendTwitchChatMessage(channelID, res!.message)
    } catch (error) {
        console.error(error, 'MessageHandler');
    }
}

async function giveUserLevel(channelID: string, messageEventData: IChatMessage) {
    let userLevel = 1;
    let cache = await getDragonflyClient('UserLevel');

    if(messageEventData.badges.some(badge => badge.set_id === 'subscriber')) {
        userLevel = 2;
    }

    if(messageEventData.badges.some(badge => badge.set_id === 'vip')) {
        userLevel = 5;
    }

    if(messageEventData.badges.some(badge => badge.set_id === 'founder')) {
        userLevel = 6;
    }

    if(messageEventData.badges.some(badge => badge.set_id === 'moderator')) {
        userLevel = 7;
    }

    const isEditor = await cache.sIsMember(`${channelID}:channel:editors`, messageEventData.chatter_user_login!);
    if(isEditor) {
        userLevel = 8;
    }

    const isAdmin = await cache.sIsMember(`${channelID}:admins`, messageEventData.chatter_user_login!);
    if(isAdmin) {
        userLevel = 9;
    }

    return userLevel;
}