import type { ITwitchEventData } from '../interfaces/twitch/eventsub.interface.js';
import Commands from '../classes/command.class.js';
import TwitchStreamers from '../classes/twitch_streamers.class.js';
import * as ChannelFunctions from '../functions/channels/index.js';
import * as ChatFunctions from '../functions/chats/index.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Command data structure from database
 */
interface ICommandData {
    enabled: boolean;
    message: string;
    type?: string;
    count?: number;
    [key: string]: any;
}

/**
 * Standard response object for command handling
 */
interface ICommandResponse {
    error: boolean;
    message: string;
    status: number;
    type: string;
    command?: ICommandData;
}

/**
 * Streamer data structure
 */
interface IStreamerData {
    id?: string;
    name?: string;
    [key: string]: any;
}

/**
 * Context object for command resolution
 */
interface ICommandContext {
    channelID: string;
    broadcasterID: string;
    broadcasterName: string;
    messageEventData: ITwitchEventData;
    streamer?: IStreamerData | null;
    argument?: string;
    count?: number;
    variables: Record<string, string>;
    userPlan?: 'free' | 'premium' | 'pro';
}

/**
 * Result from special commands parsing
 */
interface ISpecialCommandsResult {
    cmdFunc: string;
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

const MOD_ID = '698614112';

// ============================================================================
// MAIN COMMAND HANDLER EXPORT
// ============================================================================

async function commandHandler(
    channelID: string,
    messageEventData: ITwitchEventData,
    command: string,
    argument?: string
): Promise<ICommandResponse> {
    const cmdDB = await Commands.getCommandFromDB(channelID, command);
    
    if (cmdDB.error || !cmdDB.command) {
        return {
            error: true,
            message: cmdDB.message,
            status: cmdDB.status,
            type: 'command_not_found'
        };
    }

    const commandData: ICommandData = {
        enabled: cmdDB.command.enabled,
        message: cmdDB.command.message || '',
        type: cmdDB.command.type,
        count: cmdDB.command.count || 0
    };

    if (!commandData.enabled) {
        return {
            error: true,
            message: 'Command is disabled',
            status: 400,
            type: 'command_disabled'
        };
    }

    const specialRes = await specialCommands(
        channelID,
        messageEventData,
        argument || '',
        commandData.message,
        commandData.count || 0
    );

    if (commandData.type === 'countable') {
        await Commands.updateCountableCommandInDB(channelID, command, specialRes.count);
    }
    commandData.message = specialRes.cmdFunc;

    return {
        error: false,
        message: commandData.message,
        status: 200,
        type: 'success',
        command: commandData
    };
}

export { commandHandler };

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
 * Resolves a command using dot notation for flattened structure.
 * Includes plan checking from MANIFEST.
 */
async function resolveCommandSwitch(
    commandName: string,
    args: string[],
    ctx: ICommandContext
): Promise<string> {
    const { channelID, broadcasterID, broadcasterName, messageEventData, streamer, argument, count, variables } = ctx;

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
            return messageEventData.chatter_user_name || messageEventData.chatter_user_login || '';

        case 'touser': {
            const target = args[0] || argument;
            if (target) {
                return sanitizeInput(target);
            }
            return messageEventData.chatter_user_name || messageEventData.chatter_user_login || '';
        }

        case 'random': {
            const maxNumber = parseInt(args[0] || '100', 10) || 100;
            return String(Math.floor(Math.random() * maxNumber));
        }

        case 'randomuser':
            return '⚠️ This feature is being implemented';

        case 'vip':
            return '⚠️ This feature is being implemented';

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
            const result = await ChannelFunctions.getChannelInformation(channelID);
            if (result.error) {
                return `Error fetching game: ${result.message}`;
            }
            return result.data?.game_name || 'No game set';
        }

        case 'twitch.viewers':
            return '⚠️ This feature is being implemented';

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

        case 'raid':
            return '⚠️ This feature is being implemented';

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
// SPECIAL COMMANDS - Inside-Out Parser
// ============================================================================

/**
 * Parses and executes special commands using an Inside-Out Parser strategy.
 * Supports three tag types:
 * - $() - Command execution
 * - %() - Variable get/set
 * - *() - Logic operations
 */
async function specialCommands(
    channelID: string,
    messageEventData: ITwitchEventData,
    argument: string,
    cmdFunc: string,
    count: number = 0
): Promise<ISpecialCommandsResult> {
    const streamer = await TwitchStreamers.getTwitchAccountById(channelID);
    const variables: Record<string, string> = {};

    const ctx: ICommandContext = {
        channelID,
        broadcasterID: messageEventData.broadcaster_user_id || channelID,
        broadcasterName: messageEventData.broadcaster_user_name || '',
        messageEventData,
        streamer,
        argument,
        count,
        variables,
        userPlan: 'free'
    };

    const MAX_ITERATIONS = 100;
    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
        iterations++;

        const dollarIndex = cmdFunc.lastIndexOf('$(');
        const percentIndex = cmdFunc.lastIndexOf('%(');
        const asteriskIndex = cmdFunc.lastIndexOf('*(');

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
        const closeIndex = findClosingParenthesis(cmdFunc, parenOpenIndex);

        if (closeIndex === -1) {
            cmdFunc = cmdFunc.substring(0, openIndex) + cmdFunc.substring(openIndex + 2);
            continue;
        }

        const content = cmdFunc.substring(parenOpenIndex + 1, closeIndex);
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

        const fullTag = cmdFunc.substring(openIndex, closeIndex + 1);
        cmdFunc = cmdFunc.substring(0, openIndex) + replacement + cmdFunc.substring(closeIndex + 1);

        count = ctx.count || count;
    }

    if (iterations >= MAX_ITERATIONS) {
        console.warn('Special commands parser reached maximum iterations');
    }

    cmdFunc = unescapeInput(cmdFunc);

    return { cmdFunc, count };
}
