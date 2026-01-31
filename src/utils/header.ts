import TwitchStreamers from '../classes/twitch_streamers.class.js';
import { getAppToken } from './tokens.js';

interface TwitchHeader {
    'Client-Id': string;
    'Authorization': string;
    'Content-Type': string;
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

export const getTwitchStreamerHeaderById = async (streamerId: string): Promise<TwitchHeader> => {
    const streamer = await TwitchStreamers.getTwitchAccountById(streamerId);
    if (!streamer) {
        throw new Error(`Streamer not found for ID: ${streamerId}`);
    }

    if (!streamer.access_token) {
        throw new Error(`No access token for streamer: ${streamer.name}`);
    }

    twitchStreamerHeader.Authorization = `Bearer ${streamer.access_token}`;
    return twitchStreamerHeader;
};

export { twitchAppHeader, twitchStreamerHeader };
