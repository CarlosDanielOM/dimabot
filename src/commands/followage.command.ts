import { getTwitchUserByLogin } from '../functions/users/index.js';
import TwitchStreamers from '../classes/twitch_streamers.class.js';
import { getTwitchStreamerHeaderById } from '../utils/header.js';
import { getTwitchHelixUrl } from '../utils/links.js';
import { error as logError } from '../utils/logger.js';

interface FollowageResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

export async function followageCommand(channelID: string, user: string): Promise<FollowageResponse> {
    try {
        const userObj = await getTwitchUserByLogin(user.toLowerCase());
        if (userObj.error || !userObj.data) {
            return {
                error: true,
                message: userObj.message,
                status: userObj.status
            };
        }

        const streamer = await TwitchStreamers.getTwitchAccountById(channelID);
        if (!streamer) {
            return {
                error: true,
                message: 'Streamer not found',
                status: 404,
                type: 'error'
            };
        }

        const params = new URLSearchParams();
        params.append('broadcaster_id', channelID);
        params.append('user_id', userObj.data.id);

        const streamerHeaderResult = await getTwitchStreamerHeaderById(channelID);
        if (streamerHeaderResult.error || !streamerHeaderResult.header) {
            return {
                error: true,
                message: streamerHeaderResult.message,
                status: 401,
                type: 'error'
            };
        }

        const response = await fetch(getTwitchHelixUrl('channels/followers', params.toString()), {
            headers: streamerHeaderResult.header as unknown as Record<string, string>
        });

        const data = await response.json();

        if (data.error) {
            return {
                error: true,
                message: data.message,
                status: data.status,
                type: data.type
            };
        }

        if (!data.data || data.data.length < 1) {
            return {
                error: true,
                message: `${user} is not following the channel`,
                status: 404,
                type: 'not_found'
            };
        }

        const followData = data.data[0];
        const followDate = new Date(followData.followed_at);
        const currentDate = new Date();

        const diff = currentDate.getTime() - followDate.getTime();

        const hour = 1000 * 3600;
        const day = 24;
        const month = 30.5;
        const year = 12;

        let hours = Math.floor(diff / hour);
        const days = Math.floor(hours / day);
        hours = Math.floor(hours % day);
        const months = Math.floor(days / month);
        const remainingDays = Math.floor(days % month);
        const years = Math.floor(months / year);
        const remainingMonths = Math.floor(months % year);

        const followage = {
            days: remainingDays,
            months: remainingMonths,
            years: years
        };

        let message = `${user} has been following ${streamer.name} for: `;

        if (followage.years > 0) {
            message += `${followage.years} years, `;
        }

        if (followage.months > 0) {
            message += `${followage.months} months, `;
        }

        if (followage.days > 0) {
            message += `${followage.days} days, `;
        }

        message += `${hours} hours`;

        return {
            error: false,
            message: message,
            status: 200,
            type: 'success'
        };
    } catch (err) {
        await logError({
            function: 'followageCommand',
            channelID,
            user,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
        }, { channelId: channelID, destination: 'both' });

        return {
            error: true,
            message: 'Internal server error'
        };
    }
}
