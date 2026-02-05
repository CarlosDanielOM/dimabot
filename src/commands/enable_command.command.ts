import Commands from '../classes/command.class.js';
import { getDragonflyClient } from '../utils/databases/dragonfly.database.js';

interface EnableCommandResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

export async function enableCommandCommand(channelID: string, argument: string): Promise<EnableCommandResponse> {
    try {
        const command = await Commands.getCommandFromDB(channelID, argument);

        if (command.error || !command.command) {
            return {
                error: true,
                message: 'Command not found',
                status: 404,
                type: 'command_not_found'
            };
        }

        if (command.command.enabled) {
            return {
                error: true,
                message: 'Command is already enabled',
                status: 400,
                type: 'command_enabled'
            };
        }

        const cache = await getDragonflyClient('enableCommandCommand');
        const cacheKey = `${channelID}:commands:${argument}`;
        const exists = await cache.exists(cacheKey);

        if (exists) {
            await cache.hSet(cacheKey, 'enabled', 'true');
        }

        await Commands.updateCommandInDB(channelID, argument, { enabled: true });

        return {
            error: false,
            message: `Command ${argument} is now enabled`,
            status: 200,
            type: 'command_enabled'
        };
    } catch (error) {
        console.error(`Error in enableCommandCommand:`, {
            channelID,
            argument,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });

        return {
            error: true,
            message: 'Internal server error',
            type: 'error'
        };
    }
}
