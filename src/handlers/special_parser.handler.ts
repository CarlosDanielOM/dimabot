import type { ITwitchEventData } from '../interfaces/twitch/eventsub.interface.js';
import type { IEventsub } from '../schemas/eventsub.schema.js';
import TwitchStreamers from '../classes/twitch_streamers.class.js';
import * as ChannelFunctions from '../functions/channels/index.js';
import * as ChatFunctions from '../functions/chats/index.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Streamer data structure
 */
interface IStreamerData {
    id?: string;
    name?: string;
    [key: string]: any;
}

/**
 * Flexible context for special command parsing
 * Simplified to accept the raw event data and eventsub configuration
 */
export interface ISpecialParserContext {
    channelID: string;
    eventData?: ITwitchEventData | any;
    eventsubData?: IEventsub | any;
    argument?: string;
    count?: number;
    variables?: Record<string, string>;
    userPlan?: 'free' | 'premium' | 'pro';
    // Extra context for overrides if needed
    extraContext?: Record<string, any>;
}

/**
 * Internal context object for command resolution
 */
interface ICommandContext {
    channelID: string;
    broadcasterID: string;
    broadcasterName: string;
    eventData: ITwitchEventData | any;
    eventsubData?: IEventsub | any;
    streamer?: IStreamerData | null;
    argument?: string;
    count?: number;
    variables: Record<string, string>;
    userPlan?: 'free' | 'premium' | 'pro';
    extraContext?: Record<string, any>;
}

/**
 * Result from special commands parsing
 */
export interface ISpecialParserResult {
    parsedText: string;
    count: number;
}

/**
 * Parsed command name and arguments from tag content
 */
interface IParsedTagContent {
    commandName: string;
    args: string[];
}

/**
 * Plan levels for monetization
 */
type PlanLevel = 'free' | 'premium' | 'pro';

/**
 * Command manifest with plan requirements
 */
type ICommandManifest = Record<string, PlanLevel>;

/**
 * Plan hierarchy for permission checking
 */
type ICommandPlans = Record<PlanLevel, number>;

/**
 * Comparison operators for logic operations
 */
type ComparisonOperator = '==' | '=' | '!=' | '<>' | '>' | '<' | '>=' | '<=' | '~=';

/**
 * Tag types for parser
 */
type TagType = '$' | '%' | '*';

// ============================================================================
// CONSTANTS
// ============================================================================

const MANIFEST: ICommandManifest = {
    'user': 'free',
    'touser': 'free',
    'random': 'free',
    'randomuser': 'free',
    'vip': 'free',
    'ban': 'free',
    'count': 'free',
    'scount': 'free',
    'bits': 'free',
    'twitch.subs': 'free',
    'twitch.title': 'free',
    'twitch.game': 'free',
    'twitch.channel': 'free',
    'twitch.viewers': 'free',
    'twitch.follows': 'free',
    'set.game': 'free',
    'set.title': 'free',
    'start.prediction': 'free',
    'start.poll': 'free',
    'raid': 'free',
    'unraid': 'free',
    'ai': 'free'
};

const PLANS: ICommandPlans = {
    'free': 0,
    'premium': 1,
    'pro': 2
};

// ============================================================================
// EVENT DATA EXTRACTION HELPERS
// ============================================================================

/**
 * Extracted user information from event data
 */
interface IExtractedUserInfo {
    userName?: string;
    userLogin?: string;
    userID?: string;
}

/**
 * Extracted broadcaster information from event data
 */
interface IExtractedBroadcasterInfo {
    broadcasterName?: string;
    broadcasterLogin?: string;
    broadcasterID?: string;
}

/**
 * Extracted numeric fields from event data
 */
interface IExtractedNumericInfo {
    bits?: number;
    viewers?: number;
}

/**
 * Extracts user information from any Twitch event data.
 * Priority: chatter > generic user > from_broadcaster (raid) > moderator
 */
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

/**
 * Extracts broadcaster information from any Twitch event data.
 * Priority: broadcaster > to_broadcaster (raid target)
 */
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

/**
 * Extracts numeric fields from any Twitch event data.
 * Handles bits (from cheer events) and viewers (from raid events)
 */
function extractNumericFields(eventData: any): IExtractedNumericInfo {
    if (!eventData) return {};
    
    // Extract bits from different possible locations
    const bits = eventData.bits || 
                 eventData.cheer?.bits;
    
    // Extract viewers from raid events
    const viewers = eventData.viewers;
    
    return {
        bits: bits !== undefined ? Number(bits) : undefined,
        viewers: viewers !== undefined ? Number(viewers) : undefined
    };
}

// ============================================================================
// HELPER FUNCTIONS - Utilities for Parser
// ============================================================================

/**
 * Finds the closing parenthesis for a tag starting at openIndex.
 * Handles nested parentheses properly.
 */
function findClosingParenthesis(str: string, openIndex: number): number {
    let depth = 1;
    for (let i = openIndex + 1; i < str.length; i++) {
        if (str[i] === '(') {
            depth++;
        } else if (str[i] === ')') {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
    }
    return -1;
}

/**
 * Sanitizes user input to prevent command injection.
 * Escapes $ symbols and other special characters.
 */
function sanitizeInput(input: unknown): string {
    if (typeof input !== 'string') return String(input || '');
    return input
        .replace(/\$/g, '\\$')
        .replace(/%/g, '\\%')
        .replace(/\*/g, '\\*');
}

/**
 * Restores escaped characters after processing.
 */
function unescapeInput(input: unknown): string {
    if (typeof input !== 'string') return String(input || '');
    return input
        .replace(/\\\$/g, '$')
        .replace(/\\%/g, '%')
        .replace(/\\\*/g, '*');
}

/**
 * Safe comparison function for logic operations.
 * Handles type coercion and prevents injection.
 */
function safeCompare(left: string, operator: ComparisonOperator, right: string): boolean {
    const trimmedLeft = String(left).trim();
    const trimmedRight = String(right).trim();

    const leftNum = parseFloat(trimmedLeft);
    const rightNum = parseFloat(trimmedRight);
    const bothNumeric = !isNaN(leftNum) && !isNaN(rightNum);

    switch (operator) {
        case '==':
        case '=':
            return bothNumeric ? leftNum === rightNum : trimmedLeft.toLowerCase() === trimmedRight.toLowerCase();
        case '!=':
        case '<>':
            return bothNumeric ? leftNum !== rightNum : trimmedLeft.toLowerCase() !== trimmedRight.toLowerCase();
        case '>':
            return bothNumeric ? leftNum > rightNum : trimmedLeft > trimmedRight;
        case '<':
            return bothNumeric ? leftNum < rightNum : trimmedLeft < trimmedRight;
        case '>=':
            return bothNumeric ? leftNum >= rightNum : trimmedLeft >= trimmedRight;
        case '<=':
            return bothNumeric ? leftNum <= rightNum : trimmedLeft <= trimmedRight;
        case '~=':
            return trimmedLeft.toLowerCase().includes(trimmedRight.toLowerCase());
        default:
            return false;
    }
}

/**
 * Parses the content of a tag into command name and arguments.
 */
function parseTagContent(content: string): IParsedTagContent {
    const trimmed = content.trim();
    const parts: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < trimmed.length; i++) {
        const char = trimmed[i];

        if ((char === '"' || char === "'") && !inQuotes) {
            inQuotes = true;
            quoteChar = char;
        } else if (char === quoteChar && inQuotes) {
            inQuotes = false;
            quoteChar = '';
        } else if (char === ' ' && !inQuotes) {
            if (current) {
                parts.push(current);
                current = '';
            }
        } else {
            current += char;
        }
    }

    if (current) {
        parts.push(current);
    }

    return {
        commandName: parts[0] || '',
        args: parts.slice(1)
    };
}

// ============================================================================
// LOGIC HANDLER - *() Operations
// ============================================================================

/**
 * Handles logic operations with *() syntax.
 * Syntax: *(condition ? trueResult : falseResult)
 */
function handleLogic(content: string, ctx: ICommandContext): string {
    const trimmed = content.trim();

    let questionIndex = -1;
    let colonIndex = -1;
    let depth = 0;

    for (let i = 0; i < trimmed.length; i++) {
        const char = trimmed[i];
        if (char === '(' || char === '[' || char === '{') {
            depth++;
        } else if (char === ')' || char === ']' || char === '}') {
            depth--;
        } else if (depth === 0) {
            if (char === '?' && questionIndex === -1) {
                questionIndex = i;
            } else if (char === ':' && questionIndex !== -1 && colonIndex === -1) {
                colonIndex = i;
            }
        }
    }

    if (questionIndex === -1) {
        return evaluateCondition(trimmed, ctx) ? 'true' : 'false';
    }

    const condition = trimmed.substring(0, questionIndex).trim();
    const trueResult = colonIndex !== -1
        ? trimmed.substring(questionIndex + 1, colonIndex).trim()
        : trimmed.substring(questionIndex + 1).trim();
    const falseResult = colonIndex !== -1
        ? trimmed.substring(colonIndex + 1).trim()
        : '';

    return evaluateCondition(condition, ctx) ? trueResult : falseResult;
}

/**
 * Evaluates a condition string.
 */
function evaluateCondition(condition: string, ctx: ICommandContext): boolean {
    const operators: ComparisonOperator[] = ['==', '!=', '>=', '<=', '~=', '<>', '>', '<', '='];

    for (const op of operators) {
        const opIndex = condition.indexOf(op);
        if (opIndex !== -1) {
            const left = condition.substring(0, opIndex).trim();
            const right = condition.substring(opIndex + op.length).trim();
            return safeCompare(left, op, right);
        }
    }

    const trimmed = condition.trim();
    return trimmed !== '' && trimmed !== '0' && trimmed.toLowerCase() !== 'false';
}

// ============================================================================
// VARIABLE HANDLER - %() Operations
// ============================================================================

/**
 * Handles variable operations with %() syntax.
 * Getter: %(name) - Returns the value of the variable
 * Setter: %(name value) - Sets the variable and returns empty string
 */
function handleVariable(content: string, variables: Record<string, string>): string {
    const trimmed = content.trim();
    const spaceIndex = trimmed.indexOf(' ');

    if (spaceIndex === -1) {
        const varName = trimmed;
        return variables[varName] !== undefined ? String(variables[varName]) : '';
    } else {
        const varName = trimmed.substring(0, spaceIndex);
        const value = trimmed.substring(spaceIndex + 1).trim();
        variables[varName] = value;
        return '';
    }
}

// ============================================================================
// COMMAND SWITCH RESOLVER - Dot Notation
// ============================================================================

/**
 * Helper to get user name from context (supports both eventData and extraContext)
 */
function getUserName(ctx: ICommandContext): string {
    // First try eventData
    if (ctx.eventData?.chatter_user_name) {
        return ctx.eventData.chatter_user_name;
    }
    if (ctx.eventData?.chatter_user_login) {
        return ctx.eventData.chatter_user_login;
    }
    // Fall back to extraContext
    if (ctx.extraContext?.userName) {
        return ctx.extraContext.userName;
    }
    if (ctx.extraContext?.userLogin) {
        return ctx.extraContext.userLogin;
    }
    return '';
}

/**
 * Resolves a command using dot notation for flattened structure.
 * Includes plan checking from MANIFEST.
 */
async function resolveCommandSwitch(
    commandName: string,
    args: string[],
    ctx: ICommandContext
): Promise<string> {
    const { channelID, broadcasterID, broadcasterName, eventData, streamer, argument, count, variables, extraContext } = ctx;

    const requiredPlan = MANIFEST[commandName];
    if (requiredPlan === undefined) {
        return `[Unknown command: ${commandName}]`;
    }

    const userPlan = ctx.userPlan || 'free';
    const userPlanLevel = PLANS[userPlan] || 0;
    const requiredPlanLevel = PLANS[requiredPlan] || 0;

    if (userPlanLevel < requiredPlanLevel) {
        return `[This feature requires ${requiredPlan} plan]`;
    }

    switch (commandName) {
        case 'user':
            return getUserName(ctx);

        case 'touser': {
            const target = args[0] || argument;
            if (target) {
                return sanitizeInput(target);
            }
            return getUserName(ctx);
        }

        case 'random': {
            const maxNumber = parseInt(args[0] || '100', 10) || 100;
            return String(Math.floor(Math.random() * maxNumber));
        }

        case 'randomuser': {
            const chattersResult = await ChatFunctions.getChatters(channelID, channelID);
            if (chattersResult.error) {
                return chattersResult.message;
            }
            if (!chattersResult.chatters || chattersResult.chatters.length === 0) {
                return getUserName(ctx) || 'Unknown';
            }
            const randomChatter = chattersResult.chatters[Math.floor(Math.random() * chattersResult.chatters.length)];
            return randomChatter.user_name || randomChatter.user_login || 'Unknown';
        }

        case 'vip': {
            const user = args.join(' ') || argument;
            if (!user) return '';
            
            const vipResult = await ChannelFunctions.addChannelVIP(channelID, user);
            if (vipResult.error) {
                return vipResult.message;
            }
            return vipResult.message;
        }

        case 'ban':
            return '⚠️ This feature is being implemented';

        case 'count': {
            let incrementArg = args[0] || argument || '0';
            if (incrementArg !== '0') {
                incrementArg = incrementArg.replace(/\+/g, '');
            }
            const increment = parseInt(incrementArg, 10) || 0;
            const currentCount = ctx.count || 0;
            const newCount = currentCount + increment;
            ctx.count = newCount;
            return String(newCount);
        }

        case 'scount': {
            const currentCount = (ctx.count || 0) + 1;
            ctx.count = currentCount;
            return String(currentCount);
        }

        case 'bits': {
            // Return bits from extraContext (auto-extracted from event data)
            if (extraContext?.bits !== undefined) {
                return String(extraContext.bits);
            }
            return '0';
        }

        case 'twitch.subs': {
            const result = await ChannelFunctions.getChannelSubscriptions(channelID);
            if (result.error) {
                return `Error fetching subscribers: ${result.message}`;
            }
            return String(result.total || 0);
        }

        case 'twitch.title': {
            const result = await ChannelFunctions.getChannelInformation(channelID);
            if (result.error) {
                return `Error fetching channel title: ${result.message}`;
            }
            return result.data?.title || 'No title set';
        }

        case 'twitch.game': {
            // First check extraContext (for raid events that already have game info)
            if (extraContext?.game) {
                return extraContext.game;
            }
            const result = await ChannelFunctions.getChannelInformation(channelID);
            if (result.error) {
                return `Error fetching game: ${result.message}`;
            }
            return result.data?.game_name || 'No game set';
        }

        case 'twitch.viewers': {
            // First check extraContext (for raid events that have viewer count)
            if (extraContext?.viewers !== undefined) {
                return String(extraContext.viewers);
            }
            const viewersResult = await ChatFunctions.getChatters(channelID, channelID);
            if (viewersResult.error) {
                return viewersResult.message;
            }
            return String(viewersResult.chatters?.length || 0);
        }

        case 'twitch.follows': {
            const result = await ChannelFunctions.getTwitchFollowers(channelID);
            if (result.error) {
                return `Error fetching followers: ${result.message}`;
            }
            return String(result.total || 0);
        }

        case 'set.game':
            return '⚠️ This feature is being implemented';

        case 'set.title': {
            const newTitle = args[0] || '';
            if (!newTitle) {
                return 'Usage: $(set.title new title)';
            }
            const result = await ChannelFunctions.setChannelInformation(channelID, { title: newTitle });
            if (result.error) {
                return `Error setting title: ${result.message}`;
            }
            await ChatFunctions.sendTwitchChatMessage(channelID, `Title updated to: ${newTitle}`);
            return '';
        }

        case 'start.prediction':
            return '⚠️ This feature is being implemented';

        case 'start.poll':
            return '⚠️ This feature is being implemented';

        case 'raid': {
            const raidTarget = args[0] || argument || '';
            if (!raidTarget) return ''; 
            
            const raidUserData = await TwitchStreamers.getTwitchAccountById(raidTarget);
            if (!raidUserData) {
                return 'User not found';
            }

            const raidResult = await ChannelFunctions.raid(channelID, raidUserData.id || '');
            if (raidResult.error) {
                return raidResult.message || 'Error raiding channel';
            }
            return '';
        }

        case 'unraid': {
            const result = await ChannelFunctions.unraid(channelID);
            if (result.error) {
                return `Error cancelling raid: ${result.message}`;
            }
            await ChatFunctions.sendTwitchChatMessage(channelID, 'Raid cancelled!');
            return '';
        }

        case 'ai':
            return '⚠️ This feature is being implemented';

        default:
            return `[Unknown command: ${commandName}]`;
    }
}

// ============================================================================
// MAIN EXPORT - Special Commands Parser
// ============================================================================

/**
 * Parses and executes special commands using an Inside-Out Parser strategy.
 * Supports three tag types:
 * - $() - Command execution
 * - %() - Variable get/set
 * - *() - Logic operations
 * 
 * This is a standalone function that can be called from any handler
 * (commands, raid, bits, etc.) to parse text with special variables.
 * 
 * @param text - The text to parse (e.g., "Hello $(user)! You brought $(twitch.viewers) viewers!")
 * @param context - The context for parsing (channelID required, other fields optional)
 * @returns Parsed text and updated count
 */
export async function parseSpecialCommands(
    text: string,
    context: ISpecialParserContext
): Promise<ISpecialParserResult> {
    const streamer = await TwitchStreamers.getTwitchAccountById(context.channelID);
    const variables: Record<string, string> = context.variables || {};
    let count = context.count || 0;

    // Auto-extract information from event data
    const extracted = {
        ...extractUserInfo(context.eventData || {}),
        ...extractBroadcasterInfo(context.eventData || {}),
        ...extractNumericFields(context.eventData || {})
    };

    // Merge extracted data with explicit extraContext (extraContext takes precedence)
    const mergedExtraContext = {
        ...extracted,
        ...context.extraContext
    };

    // Build internal context with defaults
    const ctx: ICommandContext = {
        channelID: context.channelID,
        broadcasterID: mergedExtraContext.broadcasterID || context.channelID,
        broadcasterName: mergedExtraContext.broadcasterName || '',
        eventData: context.eventData || {},
        eventsubData: context.eventsubData,
        streamer,
        argument: context.argument,
        count,
        variables,
        userPlan: context.userPlan || 'free',
        extraContext: mergedExtraContext
    };

    let parsedText = text;
    const MAX_ITERATIONS = 100;
    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
        iterations++;

        const dollarIndex = parsedText.lastIndexOf('$(');
        const percentIndex = parsedText.lastIndexOf('%(');
        const asteriskIndex = parsedText.lastIndexOf('*(');

        const maxIndex = Math.max(dollarIndex, percentIndex, asteriskIndex);

        if (maxIndex === -1) {
            break;
        }

        let tagType: TagType;
        let openIndex: number;

        if (maxIndex === dollarIndex) {
            tagType = '$';
            openIndex = dollarIndex;
        } else if (maxIndex === percentIndex) {
            tagType = '%';
            openIndex = percentIndex;
        } else {
            tagType = '*';
            openIndex = asteriskIndex;
        }

        const parenOpenIndex = openIndex + 1;
        const closeIndex = findClosingParenthesis(parsedText, parenOpenIndex);

        if (closeIndex === -1) {
            parsedText = parsedText.substring(0, openIndex) + parsedText.substring(openIndex + 2);
            continue;
        }

        const content = parsedText.substring(parenOpenIndex + 1, closeIndex);
        let replacement = '';

        switch (tagType) {
            case '$': {
                const { commandName, args } = parseTagContent(content);

                let resolvedCommand = commandName;
                let resolvedArgs = args;

                if (['twitch', 'set', 'start'].includes(commandName) && args.length > 0) {
                    const subCommand = args[0];
                    resolvedCommand = `${commandName}.${subCommand}`;
                    resolvedArgs = args.slice(1);
                }

                replacement = await resolveCommandSwitch(resolvedCommand, resolvedArgs, ctx);
                break;
            }

            case '%': {
                replacement = handleVariable(content, variables);
                break;
            }

            case '*': {
                replacement = handleLogic(content, ctx);
                break;
            }
        }

        parsedText = parsedText.substring(0, openIndex) + replacement + parsedText.substring(closeIndex + 1);

        count = ctx.count || count;
    }

    if (iterations >= MAX_ITERATIONS) {
        console.warn('Special commands parser reached maximum iterations');
    }

    parsedText = unescapeInput(parsedText);

    return { parsedText, count };
}

// Legacy export for backward compatibility with commands.handler.ts
export { parseSpecialCommands as specialCommands };
