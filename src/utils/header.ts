import TwitchStreamers from '../classes/twitch_streamers.class.js';
import { getAppToken, getBotToken } from './tokens.js';
import { notifyDevelopers } from './notifications.js';
import { debug } from './logger.js';

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
        await debug({ function: 'getTwitchStreamerHeaderById', streamerId, error: 'Streamer not found' }, { destination: 'cache' });
        return {
            error: true,
            message: `[⚠️] Streamer not found for ID: ${streamerId} [/⚠️]`
        };
    }

    if (streamer.has_permissions !== 'true') {
        await debug({ function: 'getTwitchStreamerHeaderById', streamerId, error: 'No permissions', has_permissions: streamer.has_permissions }, { destination: 'cache' });
        return {
            error: true,
            message: '[⚠️] Streamer does not have valid permissions to access this feature, please reauthorize streamer again in https://domdimabot.com [/⚠️]'
        };
    }

    const accessToken = await TwitchStreamers.getAccountTokenById(streamerId, 'twitch');
    
    if (!accessToken) {
        await debug({ function: 'getTwitchStreamerHeaderById', streamerId, error: 'Failed to get access token (refresh may have failed)' }, { destination: 'cache' });
        return {
            error: true,
            message: '[⚠️] Streamer does not have valid permissions token to access this feature, please reauthorize streamer again in https://domdimabot.com [/⚠️]'
        };
    }

    await debug({ function: 'getTwitchStreamerHeaderById', streamerId, success: true, tokenLength: accessToken.length }, { destination: 'cache' });

    return {
        error: false,
        message: 'Success',
        header: {
            'Client-Id': process.env.CLIENT_ID!,
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        }
    };
};

export { twitchAppHeader, twitchStreamerHeader };
export type { TwitchHeaderResult };
