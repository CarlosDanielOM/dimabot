import type { ExecutionContext } from '../types.js';
import { registerFunction, type FunctionHandler } from '../evaluator.js';
import * as UserFunctions from '../../../functions/users/index.js';
import TwitchStreamers from '../../../classes/twitch_streamers.class.js';
import { getTwitchHelixUrl } from '../../../utils/links.js';
import { executeHelixStreamerRequestWith401Retry } from '../../twitch_helix_retry.js';

const followageHandler: FunctionHandler = async (args, ctx) => {
    const eventData = ctx.eventData as Record<string, unknown> | undefined;
    const extraContext = ctx.extraContext as Record<string, unknown> | undefined;
    
    const user = args[0] || ctx.argument || 
        eventData?.chatter_user_name || 
        eventData?.chatter_user_login ||
        extraContext?.userName ||
        extraContext?.userLogin ||
        ctx.userDisplayName ||
        ctx.userLogin;
    
    if (!user) return '';
    
    try {
        const userResult = await UserFunctions.getTwitchUserByLogin(String(user).toLowerCase());
        if (userResult.error || !userResult.data) return '';
        
        const streamerData = await TwitchStreamers.getTwitchAccountById(ctx.broadcasterId);
        if (!streamerData) return '';
        
        const params = new URLSearchParams();
        params.append('broadcaster_id', ctx.broadcasterId);
        params.append('user_id', userResult.data.id);
        
        const request = await executeHelixStreamerRequestWith401Retry({
            worker: 'ast_parser',
            operation: 'followage_function',
            channelID: ctx.broadcasterId,
            context: { userId: userResult.data.id },
            requestUrl: getTwitchHelixUrl('channels/followers', params.toString()),
            requestMethod: 'GET',
            executeRequest: async (headers) => fetch(getTwitchHelixUrl('channels/followers', params.toString()), {
                headers
            })
        });

        if (request.error || !request.response) return '';

        const response = request.response;
        
        const data = await response.json();
        
        if (data.error || !data.data || data.data.length < 1) return '';
        
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
        
        let message = '';
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
        
        return message;
    } catch {
        return '';
    }
};

export function registerFollowageFunctions(): void {
    registerFunction('followage', followageHandler);
}
