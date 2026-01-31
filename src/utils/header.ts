import TwitchStreamers from '../classes/twitch_streamers.class.js';
import { getAppToken, getBotToken } from './tokens.js';
import { notifyDevelopers } from './notifications.js';

interface TwitchHeader {
    'Client-Id': string;
    'Authorization': string;
    'Content-Type': string;
}

interface TwitchHeaderResult {
    error: boolean;
    message: string;
    header?: TwitchHeader;
}

let twitchAppHeader: TwitchHeader = {
    'Client-Id': process.env.CLIENT_ID!,
    'Authorization': '',
    'Content-Type': 'application/json',
};

let twitchStreamerHeader: TwitchHeader = {
    'Client-Id': process.env.CLIENT_ID!,
    'Authorization': '',
    'Content-Type': 'application/json',
};

export const getTwitchAppHeader = async (): Promise<TwitchHeader> => {
    const appToken = await getAppToken('twitch');
    if (!appToken) {
        throw new Error('Failed to get Twitch app token');
    }

    twitchAppHeader.Authorization = `Bearer ${appToken}`;
    return twitchAppHeader;
};

export const getTwitchBotHeader = async (): Promise<TwitchHeaderResult> => {
    const botToken = await getBotToken();
    
    if (!botToken) {
        await notifyDevelopers('Bot does not have valid authentication. Please authorize the bot account.', 'error');
        return {
            error: true,
            message: "Bot's account does not have the permissions required"
        };
    }
    
    return {
        error: false,
        message: 'Success',
        header: {
            'Client-Id': process.env.CLIENT_ID!,
            'Authorization': `Bearer ${botToken}`,
            'Content-Type': 'application/json'
        }
    };
};

export const getTwitchStreamerHeaderById = async (streamerId: string): Promise<TwitchHeaderResult> => {
    const streamer = await TwitchStreamers.getTwitchAccountById(streamerId);
    if (!streamer) {
        return {
            error: true,
            message: `[⚠️] Streamer not found for ID: ${streamerId} [/⚠️]`
        };
    }

    if (!streamer.access_token) {
        return {
            error: true,
            message: '[⚠️] Streamer does not have valid permissions to access this feature, please reauthorize bot again in https://domdimabot.com [/⚠️]'
        };
    }

    if (streamer.has_permissions !== 'true') {
        return {
            error: true,
            message: '[⚠️] Streamer does not have valid permissions to access this feature, please reauthorize bot again in https://domdimabot.com [/⚠️]'
        };
    }

    twitchStreamerHeader.Authorization = `Bearer ${streamer.access_token}`;
    return {
        error: false,
        message: 'Success',
        header: twitchStreamerHeader
    };
};

export { twitchAppHeader, twitchStreamerHeader };
export type { TwitchHeaderResult };
