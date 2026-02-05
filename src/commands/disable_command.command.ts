import Commands from '../classes/command.class.js';
import { getDragonflyClient } from '../utils/databases/dragonfly.database.js';
import type { ICommandGetResponse } from '../interfaces/commands/command.response.interface.js';

interface DisableCommandResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

export async function disableCommandCommand(channelID: string, argument: string): Promise<DisableCommandResponse> {
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

        if (!command.command.enabled) {
            return {
                error: true,
                message: 'Command is already disabled',
                status: 400,
                type: 'command_disabled'
            };
        }

        const cache = await getDragonflyClient('disableCommandCommand');
        const cacheKey = `${channelID}:commands:${argument}`;
        const exists = await cache.exists(cacheKey);

        if (exists) {
            await cache.hSet(cacheKey, 'enabled', 'false');
        }

        await Commands.updateCommandInDB(channelID, argument, { enabled: false });

        return {
            error: false,
            message: `Command ${argument} is now disabled`,
            status: 200,
            type: 'command_disabled'
        };
    } catch (error) {
        console.error(`Error in disableCommandCommand:`, {
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
