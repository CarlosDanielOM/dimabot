import type { ITwitchEventData } from '../interfaces/twitch/eventsub.interface.js';
import type { IEventsub } from '../schemas/eventsub.schema.js';
import TwitchStreamers from '../classes/twitch_streamers.class.js';
import { createExecutionContext, renderAstWithSourceReference } from '../utils/ast_parser/index.js';
import { registerAllFunctions } from '../utils/ast_parser/functions/index.js';
import type { ExecutionContext } from '../utils/ast_parser/types.js';

export interface ISpecialParserContext {
    channelID: string;
    eventData?: ITwitchEventData | any;
    eventsubData?: IEventsub | any;
    argument?: string;
    count?: number;
    variables?: Record<string, string>;
    userPlan?: 'free' | 'premium' | 'pro';
    userLevel?: number;
    extraContext?: Record<string, any>;
}

export interface ISpecialParserResult {
    parsedText: string;
    count: number;
}

interface IExtractedUserInfo {
    userName?: string;
    userLogin?: string;
    userID?: string;
}

interface IExtractedBroadcasterInfo {
    broadcasterName?: string;
    broadcasterLogin?: string;
    broadcasterID?: string;
}

interface IExtractedNumericInfo {
    bits?: number;
    viewers?: number;
}

function extractUserInfo(eventData: any): IExtractedUserInfo {
    if (!eventData) return {};
    
    return {
        userName: eventData.chatter_user_name || 
                  eventData.user_name || 
                  eventData.from_broadcaster_user_name || 
                  eventData.moderator_user_name,
        userLogin: eventData.chatter_user_login || 
                   eventData.user_login || 
                   eventData.from_broadcaster_user_login || 
                   eventData.moderator_user_login,
        userID: eventData.chatter_user_id || 
                eventData.user_id || 
                eventData.from_broadcaster_user_id || 
                eventData.moderator_user_id
    };
}

function extractBroadcasterInfo(eventData: any): IExtractedBroadcasterInfo {
    if (!eventData) return {};
    
    return {
        broadcasterName: eventData.broadcaster_user_name || 
                         eventData.to_broadcaster_user_name,
        broadcasterLogin: eventData.broadcaster_user_login || 
                          eventData.to_broadcaster_user_login,
        broadcasterID: eventData.broadcaster_user_id || 
                       eventData.to_broadcaster_user_id
    };
}

function extractNumericFields(eventData: any): IExtractedNumericInfo {
    if (!eventData) return {};
    
    const bits = eventData.bits || eventData.cheer?.bits;
    const viewers = eventData.viewers;
    
    return {
        bits: bits !== undefined ? Number(bits) : undefined,
        viewers: viewers !== undefined ? Number(viewers) : undefined
    };
}

function unescapeInput(input: unknown): string {
    if (typeof input !== 'string') return String(input || '');
    return input
        .replace(/\\\$/g, '$')
        .replace(/\\%/g, '%')
        .replace(/\\\*/g, '*');
}

export async function parseSpecialCommands(
    text: string,
    context: ISpecialParserContext
): Promise<ISpecialParserResult> {
    registerAllFunctions();
    
    const streamer = await TwitchStreamers.getTwitchAccountById(context.channelID);
    
    const extracted = {
        ...extractUserInfo(context.eventData || {}),
        ...extractBroadcasterInfo(context.eventData || {}),
        ...extractNumericFields(context.eventData || {})
    };
    
    const mergedExtraContext = {
        ...extracted,
        ...context.extraContext
    };
    
    const variables = new Map<string, unknown>();
    if (context.variables) {
        for (const [key, value] of Object.entries(context.variables)) {
            variables.set(key, value);
        }
    }
    
    const astContext: ExecutionContext = createExecutionContext({
        broadcasterId: context.channelID,
        userId: extracted.userID || '',
        userLogin: extracted.userLogin || '',
        userDisplayName: extracted.userName || '',
        userPlan: context.userPlan || 'free',
        userLevel: context.userLevel || 1,
        argument: context.argument,
        count: context.count || 0,
        eventData: context.eventData || {},
        eventsubData: context.eventsubData,
        extraContext: mergedExtraContext,
        streamer: streamer ? { id: streamer.id, name: streamer.name } : null,
        variables
    });
    
    const { parsedText: renderedText, context: resultContext } = await renderAstWithSourceReference(
        text,
        astContext
    );

    const parsedText = unescapeInput(String(renderedText || ''));
    
    return { 
        parsedText, 
        count: resultContext.count 
    };
}

export { parseSpecialCommands as specialCommands };
