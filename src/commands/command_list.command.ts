import { CommandsSchema } from '../schemas/commands.schema.js';

interface CommandListResponse {
    error: boolean;
    message: string;
}

export async function commandListCommand(channelID: string, userLevel: number = 1, type: string = 'all'): Promise<CommandListResponse> {
    try {
        const commands = await CommandsSchema.find({ channelID, enabled: true });

        if (!commands) {
            return {
                error: true,
                message: 'No commands found'
            };
        }

        const commandNames = commands.map(command => {
            if (command.type === 'timer' || command.userLevel >= userLevel) return undefined;
            if (command.type !== 'timer' && command.userLevel <= userLevel) return command.cmd;
            return undefined;
        });

        const filteredCommands = commandNames.filter(cmd => cmd !== undefined);

        return {
            error: false,
            message: `List of commands available are: ${filteredCommands.join(', ')}`
        };
    } catch (error) {
        console.error(`Error in commandListCommand:`, {
            channelID,
            userLevel,
            type,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });

        return {
            error: true,
            message: 'Internal server error'
        };
    }
}
