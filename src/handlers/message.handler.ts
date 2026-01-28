import TwitchStreamers from "../classes/twitch_streamers.class.js";
import ChatHistory from "../classes/chat_history.js";

import { COOLDOWN } from "../classes/cooldown.class.js";

const commandsRegex = new RegExp(/^!([\p{L}\p{N}]+)(?:\W@?)?(.*)?$/u);
const linkRegex = new RegExp(/((http|https):\/\/)?(www\.)?[a-zA-Z-]+(\.[a-zA-Z-]{2})+(:\d+)?(\/\S*)?(\?\S+)?/gi);

//? TODO: Import commands
import { getDragonflyClient } from "../utils/databases/dragonfly.database.js";
import type { IChatMessage } from "../interfaces/twitch/eventsub.interface.js";

const modID = '698614112';
const CHANNEL_INSTANCES = new Map<string, COOLDOWN>();

let isMod = false;

export const messageHandler = async (channelID: string, messageEventData: IChatMessage) => {
    const STREAMER = await TwitchStreamers.getTwitchAccountById(channelID);
    const cache = await getDragonflyClient('MessageHandler');

    let on_cooldown = false;
    if(!CHANNEL_INSTANCES.has(channelID)) {
        CHANNEL_INSTANCES.set(channelID, new COOLDOWN());
    }
    const channelInstance = CHANNEL_INSTANCES.get(channelID);

    if(messageEventData.badges.some(badge => badge.set_id === 'moderator') || messageEventData.chatter_user_id === channelID) isMod = true;

    const [raw, command, argument] = messageEventData.message.text.match(commandsRegex) || [];

    if(!command) {
        //* TODO: AI response
    }
}