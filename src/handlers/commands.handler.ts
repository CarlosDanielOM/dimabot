import type { ITwitchEventData } from '../interfaces/twitch/eventsub.interface.js';
import Commands from '../classes/command.class.js';
import { parseSpecialCommands } from './special_parser.handler.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Command data structure from database
 */
interface ICommandData {
    enabled: boolean;
    name?: string;
    cmd?: string;
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

// ============================================================================
// MAIN COMMAND HANDLER EXPORT
// ============================================================================

async function commandHandler(
    channelID: string,
    messageEventData: ITwitchEventData | Record<string, unknown>,
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
        name: cmdDB.command.name,
        cmd: cmdDB.command.cmd,
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

    // Use the standalone special commands parser
    const specialRes = await parseSpecialCommands(commandData.message, {
        channelID,
        scopeType: 'command',
        scopeName: commandData.cmd || command,
        scopeAliases: commandData.name ? [commandData.name] : [],
        eventData: messageEventData,
        argument: argument || '',
        count: commandData.count || 0
    });

    if (commandData.type === 'countable') {
        await Commands.updateCountableCommandInDB(channelID, command, specialRes.count);
    }
    commandData.message = specialRes.parsedText;

    return {
        error: false,
        message: commandData.message,
        status: 200,
        type: 'success',
        command: commandData
    };
}

export { commandHandler };
