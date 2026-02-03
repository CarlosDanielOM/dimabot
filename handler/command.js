const COMMAND = require('../class/command');
const STREAMERS = require('../class/streamer');
const CHANNEL = require('../function/channel');
const CHAT = require('../function/chat');
const COMMANDS = require('../command');
const banUser = require('../function/moderation/ban');

const categories = require('../function/search/categories');
const { getUserByLogin } = require('../function/user/getuser');
const addVIPCommand = require('../command/addvip');
const { executeAiCommand } = require('../src/utils/ai/openrouter/command.ai.js');

// ============================================================================
// 1. MANIFEST & PLANS - Monetization Preparation
// ============================================================================

/**
 * Command manifest defining access tiers for each command.
 * All commands are set to 'free' for now, ready for future monetization.
 */
const MANIFEST = {
    // User & Target Commands
    'user': 'free',
    'touser': 'free',
    'random': 'free',
    'randomuser': 'free',

    // Moderation Commands
    'vip': 'free',
    'ban': 'free',

    // Counter Commands
    'count': 'free',
    'scount': 'free',

    // Twitch Data Commands (Dot Notation)
    'twitch.subs': 'free',
    'twitch.title': 'free',
    'twitch.game': 'free',
    'twitch.channel': 'free',
    'twitch.viewers': 'free',
    'twitch.follows': 'free',

    // Set Commands (Dot Notation)
    'set.game': 'free',
    'set.title': 'free',

    // Start Commands (Dot Notation)
    'start.prediction': 'free',
    'start.poll': 'free',

    // Raid Commands
    'raid': 'free',
    'unraid': 'free',

    // AI Placeholder
    'ai': 'free'
};

/**
 * Plan hierarchy for permission checking.
 * Higher numbers have access to lower tier features.
 */
const PLANS = {
    'free': 0,
    'premium': 1,
    'pro': 2
};

const MOD_ID = '698614112';

// ============================================================================
// 2. MAIN COMMAND HANDLER EXPORT
// ============================================================================

async function commandHandler(channelID, tags, command, argument) {
    let cmd = await COMMAND.getCommandFromDB(channelID, command);
    if (cmd.error) {
        return {
            error: true,
            message: cmd.message,
            status: cmd.status,
            type: cmd.type
        };
    }

    let commandData = cmd.command;
    if (!commandData.enabled) {
        return {
            error: true,
            message: 'Command is disabled',
            status: 400,
            type: 'command_disabled'
        };
    }

    let specialRes = await specialCommands(channelID, tags, argument, commandData.message, commandData.count);
    if (commandData.type == 'countable') {
        await COMMAND.updateCountableCommandInDB(channelID, command, specialRes.count);
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

module.exports = commandHandler;

// ============================================================================
// 3. HELPER FUNCTIONS - Utilities for Parser
// ============================================================================

/**
 * Finds the closing parenthesis for a tag starting at openIndex.
 * Handles nested parentheses properly.
 * 
 * @param {string} str - The string to search in
 * @param {number} openIndex - The index of the opening parenthesis
 * @returns {number} - The index of the closing parenthesis, or -1 if not found
 */
function findClosingParenthesis(str, openIndex) {
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
 * 
 * @param {string} input - The user input to sanitize
 * @returns {string} - Sanitized input
 */
function sanitizeInput(input) {
    if (typeof input !== 'string') return String(input || '');
    // Escape $ to prevent command injection
    // Also escape % and * to prevent variable/logic injection
    return input
        .replace(/\$/g, '\\$')
        .replace(/%/g, '\\%')
        .replace(/\*/g, '\\*');
}

/**
 * Restores escaped characters after processing.
 * 
 * @param {string} input - The string with escaped characters
 * @returns {string} - String with restored characters
 */
function unescapeInput(input) {
    if (typeof input !== 'string') return String(input || '');
    return input
        .replace(/\\\$/g, '$')
        .replace(/\\%/g, '%')
        .replace(/\\\*/g, '*');
}

/**
 * Safe comparison function for logic operations.
 * Handles type coercion and prevents injection.
 * 
 * @param {string} left - Left operand
 * @param {string} operator - Comparison operator
 * @param {string} right - Right operand
 * @returns {boolean} - Result of comparison
 */
function safeCompare(left, operator, right) {
    // Trim whitespace
    left = String(left).trim();
    right = String(right).trim();

    // Try to convert to numbers if both are numeric
    const leftNum = parseFloat(left);
    const rightNum = parseFloat(right);
    const bothNumeric = !isNaN(leftNum) && !isNaN(rightNum);

    switch (operator) {
        case '==':
        case '=':
            return bothNumeric ? leftNum === rightNum : left.toLowerCase() === right.toLowerCase();
        case '!=':
        case '<>':
            return bothNumeric ? leftNum !== rightNum : left.toLowerCase() !== right.toLowerCase();
        case '>':
            return bothNumeric ? leftNum > rightNum : left > right;
        case '<':
            return bothNumeric ? leftNum < rightNum : left < right;
        case '>=':
            return bothNumeric ? leftNum >= rightNum : left >= right;
        case '<=':
            return bothNumeric ? leftNum <= rightNum : left <= right;
        case '~=':
            // Contains operator (case-insensitive)
            return left.toLowerCase().includes(right.toLowerCase());
        default:
            return false;
    }
}

/**
 * Parses the content of a tag into command name and arguments.
 * 
 * @param {string} content - The content inside the parentheses
 * @returns {{commandName: string, args: string[]}} - Parsed command name and arguments
 */
function parseTagContent(content) {
    const trimmed = content.trim();
    
    // Split by spaces, but preserve quoted strings
    const parts = [];
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

    const commandName = parts[0] || '';
    const args = parts.slice(1);

    return { commandName, args };
}

// ============================================================================
// 4. LOGIC HANDLER - *() Operations
// ============================================================================

/**
 * Handles logic operations with *() syntax.
 * Supports: if/else logic with ==, !=, >, <, >=, <=, ~= operators.
 * 
 * Syntax: *(condition ? trueResult : falseResult)
 * Example: *($(user) == "Admin" ? "Hello Admin!" : "Hello User!")
 * 
 * @param {string} content - The content inside *()
 * @param {object} ctx - Context object with variables
 * @returns {string} - Result of the logic operation (raw string)
 */
function handleLogic(content, ctx) {
    const trimmed = content.trim();

    // Pattern: condition ? trueResult : falseResult
    // Find the ? and : separators (not inside nested structures)
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
        // No ternary, just evaluate as boolean
        return evaluateCondition(trimmed, ctx) ? 'true' : 'false';
    }

    const condition = trimmed.substring(0, questionIndex).trim();
    const trueResult = colonIndex !== -1 
        ? trimmed.substring(questionIndex + 1, colonIndex).trim()
        : trimmed.substring(questionIndex + 1).trim();
    const falseResult = colonIndex !== -1 
        ? trimmed.substring(colonIndex + 1).trim()
        : '';

    const result = evaluateCondition(condition, ctx);
    
    // Return raw string, do not wrap in $()
    return result ? trueResult : falseResult;
}

/**
 * Evaluates a condition string.
 * 
 * @param {string} condition - The condition to evaluate
 * @param {object} ctx - Context object
 * @returns {boolean} - Result of the condition
 */
function evaluateCondition(condition, ctx) {
    // Check for comparison operators
    const operators = ['==', '!=', '>=', '<=', '~=', '<>', '>', '<', '='];
    
    for (const op of operators) {
        const opIndex = condition.indexOf(op);
        if (opIndex !== -1) {
            const left = condition.substring(0, opIndex).trim();
            const right = condition.substring(opIndex + op.length).trim();
            return safeCompare(left, op, right);
        }
    }

    // No operator found, treat as truthy check
    const trimmed = condition.trim();
    return trimmed !== '' && trimmed !== '0' && trimmed.toLowerCase() !== 'false';
}

// ============================================================================
// 5. VARIABLE HANDLER - %() Operations
// ============================================================================

/**
 * Handles variable operations with %() syntax.
 * Getter: %(name) - Returns the value of the variable
 * Setter: %(name value) - Sets the variable and returns empty string
 * 
 * @param {string} content - The content inside %()
 * @param {object} variables - Variable storage object
 * @returns {string} - Value for getter, empty string for setter
 */
function handleVariable(content, variables) {
    const trimmed = content.trim();
    const spaceIndex = trimmed.indexOf(' ');

    if (spaceIndex === -1) {
        // Getter: %(name)
        const varName = trimmed;
        return variables[varName] !== undefined ? String(variables[varName]) : '';
    } else {
        // Setter: %(name value)
        const varName = trimmed.substring(0, spaceIndex);
        const value = trimmed.substring(spaceIndex + 1).trim();
        variables[varName] = value;
        // Setters return empty string
        return '';
    }
}

// ============================================================================
// 6. COMMAND SWITCH RESOLVER - Dot Notation
// ============================================================================

/**
 * Resolves a command using dot notation for flattened structure.
 * Includes plan checking from MANIFEST.
 * 
 * @param {string} commandName - The command name (e.g., 'twitch.subs', 'set.game')
 * @param {string[]} args - Array of arguments
 * @param {object} ctx - Context object containing channelID, tags, streamer, etc.
 * @returns {Promise<string>} - Result of the command
 */
async function resolveCommandSwitch(commandName, args, ctx) {
    const { channelID, tags, streamer, argument, count, variables } = ctx;

    // Check manifest permissions
    const requiredPlan = MANIFEST[commandName];
    if (requiredPlan === undefined) {
        // Command not in manifest, unknown command
        return `[Unknown command: ${commandName}]`;
    }

    // Get user's plan (default to 'free' for now)
    const userPlan = ctx.userPlan || 'free';
    const userPlanLevel = PLANS[userPlan] || 0;
    const requiredPlanLevel = PLANS[requiredPlan] || 0;

    if (userPlanLevel < requiredPlanLevel) {
        return `[This feature requires ${requiredPlan} plan]`;
    }

    // Resolve command
    switch (commandName) {
        // ================================================================
        // User & Target Commands
        // ================================================================
        case 'user':
            return tags['display-name'] || tags.username || '';

        case 'touser': {
            // Use provided arg or fall back to argument, then to user
            const target = args[0] || argument;
            if (target) {
                // Sanitize the touser input to prevent injection
                return sanitizeInput(target);
            }
            return tags['display-name'] || tags.username || '';
        }

        case 'random': {
            const maxNumber = parseInt(args[0], 10) || 100;
            return String(Math.floor(Math.random() * maxNumber));
        }

        case 'randomuser': {
            const chatters = await CHAT.getChatters(channelID, channelID);
            if (chatters.error) {
                return chatters.message;
            }
            if (!chatters.chatters || chatters.chatters.length === 0) {
                return tags['display-name'] || 'Unknown';
            }
            const randomChatter = chatters.chatters[Math.floor(Math.random() * chatters.chatters.length)];
            return randomChatter.user_name || randomChatter.user_login || 'Unknown';
        }

        // ================================================================
        // Moderation Commands
        // ================================================================
        case 'vip': {
            const user = args.join(' ') || argument || '';
            if (!user) return '';
            
            const vipAction = await addVIPCommand(channelID, user, tags);
            if (vipAction.error) {
                const randomUser = user.split(' ')[0];
                return `${vipAction.message} ${randomUser}`;
            }
            return vipAction.message;
        }

        case 'ban': {
            try {
                const rawArgs = args.join(' ') || argument || '';
                if (!rawArgs.trim()) return '';

                const [rawUser, rawSeconds] = rawArgs.trim().split(/[;\s]+/);
                if (!rawUser) return '';

                const login = rawUser.replace(/^@/, '').toLowerCase();
                const userData = await getUserByLogin(login);
                if (userData.error) {
                    return userData.message;
                }

                let duration = null;
                if (rawSeconds && /^\d+$/.test(rawSeconds)) {
                    duration = parseInt(rawSeconds, 10);
                }

                const banRes = await banUser(channelID, userData.data.id, MOD_ID, duration);
                if (banRes.error) {
                    return banRes.message;
                }
                return '';
            } catch (error) {
                console.error('Ban command error:', error);
                return '';
            }
        }

        // ================================================================
        // Counter Commands
        // ================================================================
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

        // ================================================================
        // Twitch Data Commands (Dot Notation)
        // ================================================================
        case 'twitch.subs': {
            const totalSubs = await CHANNEL.getSubscriptions(channelID);
            return String(totalSubs.total || 0);
        }

        case 'twitch.title': {
            const info = await CHANNEL.getInformation(channelID);
            return info.data?.title || '';
        }

        case 'twitch.game': {
            const info = await CHANNEL.getInformation(channelID);
            return info.data?.game_name || '';
        }

        case 'twitch.channel': {
            return streamer?.name || '';
        }

        case 'twitch.viewers': {
            const viewers = await CHAT.getChatters(channelID, channelID);
            if (viewers.error) {
                return viewers.message;
            }
            return String(viewers.chatters?.length || 0);
        }

        case 'twitch.follows': {
            const followers = await CHANNEL.getFollowers(channelID);
            if (followers.error) {
                return followers.message;
            }
            return String(followers.total || 0);
        }

        // ================================================================
        // Set Commands (Dot Notation)
        // ================================================================
        case 'set.game': {
            const gameName = args.join(' ') || argument || '';
            if (!gameName) return '';

            const category = await categories(gameName);
            if (category.error) {
                console.log('Set game error:', category.message);
                return '';
            }

            if (!category.data || category.data.length === 0) {
                return '';
            }

            const gameData = {
                game_name: category.data[0].name,
                game_id: category.data[0].id
            };

            const updateGame = await CHANNEL.setInformation(channelID, gameData);
            if (updateGame.error) {
                console.log('Update game error:', updateGame.message);
                return '';
            }

            return gameData.game_name;
        }

        case 'set.title': {
            const title = args.join(' ') || argument || '';
            if (!title) return '';

            const updateTitle = await CHANNEL.setInformation(channelID, { title });
            if (updateTitle.error) {
                console.log('Update title error:', updateTitle.message);
                return '';
            }

            return title;
        }

        // ================================================================
        // Start Commands (Dot Notation)
        // ================================================================
        case 'start.prediction': {
            const predictionArgs = args.join(' ') || argument || '';
            const predictionData = await COMMANDS.prediction('CREATE', channelID, predictionArgs);
            return predictionData.message || '';
        }

        case 'start.poll': {
            const pollArgs = args.join(' ') || argument || '';
            const pollData = await COMMANDS.poll('CREATE', channelID, pollArgs);
            return pollData.message || '';
        }

        // ================================================================
        // Raid Commands
        // ================================================================
        case 'raid': {
            const raidTarget = args[0] || argument || '';
            if (!raidTarget) return '';

            const raidUserData = await getUserByLogin(raidTarget);
            if (raidUserData.error) {
                return raidUserData.message;
            }

            const streamerID = raidUserData.data.id;
            const raidData = await CHANNEL.raid(channelID, streamerID);
            if (raidData.error) {
                return raidData.message;
            }
            return '';
        }

        case 'unraid': {
            const unraidData = await CHANNEL.unraid(channelID);
            if (unraidData.error) {
                return unraidData.message;
            }
            return '';
        }

        // ================================================================
        // AI Command - OpenRouter Integration
        // ================================================================
        case 'ai': {
            // Extract prompt from args or argument
            const prompt = args.join(' ') || argument || '';
            if (!prompt || prompt.trim() === '') {
                return '[AI: No prompt provided]';
            }
            
            // Build user context from tags
            const userContext = {
                username: tags['display-name'] || tags.username || 'Anonymous',
                badges: '' // Badges optional for command mode
            };
            
            // Execute AI command with tiered model selection
            const aiResult = await executeAiCommand(streamer, userContext, prompt);
            
            if (aiResult.error) {
                return aiResult.message;
            }
            
            // Return sanitized AI response (sanitization done in executeAiCommand)
            return aiResult.message;
        }

        default:
            return `[Unknown command: ${commandName}]`;
    }
}

// ============================================================================
// 7. SPECIAL COMMANDS - Inside-Out Parser
// ============================================================================

/**
 * Parses and executes special commands using an Inside-Out Parser strategy.
 * Uses lastIndexOf to find the innermost tag first, processes it, then continues.
 * 
 * Supports three tag types:
 * - $() - Command execution
 * - %() - Variable get/set
 * - *() - Logic operations
 * 
 * @param {string} channelID - The channel ID
 * @param {object} tags - User tags from Twitch
 * @param {string} argument - The command argument (user input after command)
 * @param {string} cmdFunc - The command function string to parse
 * @param {number} count - Current count for countable commands
 * @returns {Promise<{cmdFunc: string, count: number}>} - Parsed result
 */
async function specialCommands(channelID, tags, argument, cmdFunc, count = 0) {
    // Get streamer data for context
    const streamer = await STREAMERS.getStreamerById(channelID);

    // Variable storage for %() operations
    const variables = {};

    // Context object for command resolution
    const ctx = {
        channelID,
        tags,
        streamer,
        argument,
        count,
        variables,
        userPlan: 'free' // Default to free, can be overridden
    };

    // Maximum iterations to prevent infinite loops
    const MAX_ITERATIONS = 100;
    let iterations = 0;

    // Inside-Out Parser: Find innermost tags first using lastIndexOf
    while (iterations < MAX_ITERATIONS) {
        iterations++;

        // Find the last occurrence of each tag type opener
        const dollarIndex = cmdFunc.lastIndexOf('$(');
        const percentIndex = cmdFunc.lastIndexOf('%(');
        const asteriskIndex = cmdFunc.lastIndexOf('*(');

        // Find the innermost (last) tag
        const maxIndex = Math.max(dollarIndex, percentIndex, asteriskIndex);

        // No more tags found
        if (maxIndex === -1) {
            break;
        }

        // Determine the tag type based on which had the highest index
        let tagType;
        let openIndex;

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

        // Find the opening parenthesis (right after the tag character)
        const parenOpenIndex = openIndex + 1;

        // Find the closing parenthesis
        const closeIndex = findClosingParenthesis(cmdFunc, parenOpenIndex);

        if (closeIndex === -1) {
            // Malformed tag, skip it by removing just the opener
            cmdFunc = cmdFunc.substring(0, openIndex) + cmdFunc.substring(openIndex + 2);
            continue;
        }

        // Extract the content inside the parentheses
        const content = cmdFunc.substring(parenOpenIndex + 1, closeIndex);

        // Process based on tag type
        let replacement = '';

        switch (tagType) {
            case '$': {
                // Command execution
                const { commandName, args } = parseTagContent(content);

                // Handle dot notation for nested commands
                // Check if it's a compound command (e.g., twitch subs -> twitch.subs)
                let resolvedCommand = commandName;
                let resolvedArgs = args;

                // Check for subcommands that should use dot notation
                if (['twitch', 'set', 'start'].includes(commandName) && args.length > 0) {
                    const subCommand = args[0];
                    resolvedCommand = `${commandName}.${subCommand}`;
                    resolvedArgs = args.slice(1);
                }

                replacement = await resolveCommandSwitch(resolvedCommand, resolvedArgs, ctx);
                break;
            }

            case '%': {
                // Variable operation
                replacement = handleVariable(content, variables);
                break;
            }

            case '*': {
                // Logic operation
                replacement = handleLogic(content, ctx);
                break;
            }
        }

        // Replace the entire tag with the result
        const fullTag = cmdFunc.substring(openIndex, closeIndex + 1);
        cmdFunc = cmdFunc.substring(0, openIndex) + replacement + cmdFunc.substring(closeIndex + 1);

        // Update count in context if it changed
        count = ctx.count;
    }

    if (iterations >= MAX_ITERATIONS) {
        console.warn('Special commands parser reached maximum iterations');
    }

    // Unescape any escaped characters from sanitization
    cmdFunc = unescapeInput(cmdFunc);

    return { cmdFunc, count };
}
