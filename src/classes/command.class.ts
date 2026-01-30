import { CommandsSchema, type ICommands } from '../schemas/commands.schema.js';
import { getDragonflyClient } from '../utils/databases/dragonfly.database.js';
import type {
    ICommandCreateResponse,
    ICommandDeleteResponse,
    ICommandGetResponse,
    ICommandUpdateResponse,
    ICommandExistsResponse
} from '../interfaces/commands/command.response.interface.js';

type DragonflyClient = Awaited<ReturnType<typeof getDragonflyClient>>;

class Commands {
    private cachePromise: ReturnType<typeof getDragonflyClient>;
    private readonly CACHE_TTL: number = 3600;

    constructor() {
        this.cachePromise = getDragonflyClient('Commands');
    }

    private async invalidateCache(channelID: string, cmd: string): Promise<void> {
        try {
            const cache = await this.cachePromise;
            const cacheKey = `${channelID}:commands:${cmd}`;
            await cache.del(cacheKey);
        } catch (error) {
            console.error(`Error invalidating cache for command ${cmd}: ${error}`);
        }
    }

    async createCommand(channelID: string, command: Partial<ICommands>): Promise<ICommandCreateResponse> {
        try {
            const exists = await CommandsSchema.findOne({ channelID, cmd: command.cmd });
            if (exists) {
                return {
                    error: true,
                    message: 'Command already exists',
                    status: 400,
                    type: 'command_already_exists'
                };
            }

            const commandData = new CommandsSchema(command);
            const saved = await commandData.save();

            if (!saved) {
                return {
                    error: true,
                    message: 'Error saving command',
                    status: 500,
                    type: 'error_saving_command'
                };
            }

            const cache = await this.cachePromise;
            const cacheKey = `${channelID}:commands:${command.cmd}`;
            await cache.set(cacheKey, JSON.stringify(saved), { EX: this.CACHE_TTL });

            return {
                error: false,
                created: true,
                command: saved,
                message: 'Command created successfully',
                status: 200,
                type: 'command_created'
            };
        } catch (error) {
            console.error(`Error creating command: ${error} for channelID: ${channelID}`);
            return {
                error: true,
                message: 'Error creating command',
                status: 500,
                type: 'error_creating_command'
            };
        }
    }

    async deleteCommand(channelID: string, command: string): Promise<ICommandDeleteResponse> {
        try {
            const deleted = await CommandsSchema.findOne({ channelID, cmd: command });
            if (!deleted) {
                return {
                    error: true,
                    message: 'Command does not exist',
                    status: 400,
                    type: 'command_does_not_exist'
                };
            }

            await deleted.deleteOne();
            await this.invalidateCache(channelID, command);

            return {
                error: false,
                deleted: true,
                command: deleted,
                message: 'Command deleted successfully',
                status: 200,
                type: 'command_deleted'
            };
        } catch (error) {
            console.error(`Error deleting command: ${error} for channelID: ${channelID}`);
            return {
                error: true,
                message: 'Error deleting command',
                status: 500,
                type: 'error_deleting_command'
            };
        }
    }

    async getCommandFromDB(channelID: string, commandCMD: string): Promise<ICommandGetResponse> {
        try {
            const cache = await this.cachePromise;
            const cacheKey = `${channelID}:commands:${commandCMD}`;

            const cached = await cache.get(cacheKey);
            if (cached) {
                return {
                    error: false,
                    command: JSON.parse(cached),
                    message: 'Command retrieved from cache',
                    status: 200,
                    type: 'command_retrieved'
                };
            }

            const command = await CommandsSchema.findOne({ channelID, cmd: commandCMD });
            if (!command) {
                return {
                    error: true,
                    message: 'Command does not exist',
                    status: 400,
                    type: 'command_does_not_exist'
                };
            }

            await cache.set(cacheKey, JSON.stringify(command), { EX: this.CACHE_TTL });

            return {
                error: false,
                command,
                message: 'Command retrieved',
                status: 200,
                type: 'command_retrieved'
            };
        } catch (error) {
            console.error(`Error getting command: ${error} for channelID: ${channelID}`);
            return {
                error: true,
                message: 'Error retrieving command',
                status: 500,
                type: 'error_retrieving_command'
            };
        }
    }

    async getReservedCommandFromDB(channelID: string, commandCMD: string): Promise<ICommandGetResponse> {
        try {
            const cache = await this.cachePromise;
            const cacheKey = `${channelID}:commands:${commandCMD}`;

            const cached = await cache.get(cacheKey);
            if (cached) {
                return {
                    error: false,
                    command: JSON.parse(cached),
                    message: 'Reserved command retrieved from cache',
                    status: 200,
                    type: 'command_retrieved'
                };
            }

            const command = await CommandsSchema.findOne({ channelID, cmd: commandCMD, reserved: true });
            if (!command) {
                return {
                    error: true,
                    message: 'Command does not exist',
                    status: 400,
                    type: 'command_does_not_exist'
                };
            }

            await cache.set(cacheKey, JSON.stringify(command), { EX: this.CACHE_TTL });

            return {
                error: false,
                command,
                message: 'Reserved command retrieved',
                status: 200,
                type: 'command_retrieved'
            };
        } catch (error) {
            console.error(`Error getting reserved command: ${error} for channelID: ${channelID}`);
            return {
                error: true,
                message: 'Error retrieving reserved command',
                status: 500,
                type: 'error_retrieving_command'
            };
        }
    }

    async checkIfCommandExists(channelID: string, commandCMD: string): Promise<ICommandExistsResponse> {
        try {
            const cache = await this.cachePromise;
            const cacheKey = `${channelID}:commands:${commandCMD}`;

            const cached = await cache.get(cacheKey);
            if (cached) {
                return {
                    error: false,
                    command: JSON.parse(cached),
                    message: 'Command exists',
                    status: 200,
                    type: 'command_exists'
                };
            }

            const command = await CommandsSchema.findOne({ channelID, cmd: commandCMD });
            if (!command) {
                return {
                    error: true,
                    message: 'Command does not exist',
                    status: 400,
                    type: 'command_does_not_exist'
                };
            }

            await cache.set(cacheKey, JSON.stringify(command), { EX: this.CACHE_TTL });

            return {
                error: false,
                command,
                message: 'Command exists',
                status: 200,
                type: 'command_exists'
            };
        } catch (error) {
            console.error(`Error checking command existence: ${error} for channelID: ${channelID}`);
            return {
                error: true,
                message: 'Error checking command',
                status: 500,
                type: 'error_checking_command'
            };
        }
    }

    async checkIfReservedCommandExists(channelID: string, commandCMD: string): Promise<ICommandExistsResponse> {
        try {
            const cache = await this.cachePromise;
            const cacheKey = `${channelID}:commands:${commandCMD}`;

            const cached = await cache.get(cacheKey);
            if (cached) {
                return {
                    error: false,
                    command: JSON.parse(cached),
                    message: 'Reserved command exists',
                    status: 200,
                    type: 'command_exists'
                };
            }

            const command = await CommandsSchema.findOne({ channelID, cmd: commandCMD, reserved: true });
            if (!command) {
                return {
                    error: true,
                    message: 'Command does not exist',
                    status: 400,
                    type: 'command_does_not_exist'
                };
            }

            await cache.set(cacheKey, JSON.stringify(command), { EX: this.CACHE_TTL });

            return {
                error: false,
                command,
                message: 'Reserved command exists',
                status: 200,
                type: 'command_exists'
            };
        } catch (error) {
            console.error(`Error checking reserved command existence: ${error} for channelID: ${channelID}`);
            return {
                error: true,
                message: 'Error checking command',
                status: 500,
                type: 'error_checking_command'
            };
        }
    }

    async updateCommandInDB(channelID: string, commandCMD: string, updateData: Partial<ICommands>): Promise<ICommandUpdateResponse> {
        try {
            const command = await CommandsSchema.findOne({ channelID, cmd: commandCMD });
            if (!command) {
                return {
                    error: true,
                    message: 'Command does not exist',
                    status: 400,
                    type: 'command_does_not_exist'
                };
            }

            await command.updateOne(updateData);
            await this.invalidateCache(channelID, commandCMD);

            return {
                error: false,
                message: 'Command updated',
                status: 200,
                type: 'command_updated'
            };
        } catch (error) {
            console.error(`Error updating command: ${error} for channelID: ${channelID}`);
            return {
                error: true,
                message: 'Error updating command',
                status: 500,
                type: 'error_updating_command'
            };
        }
    }

    async updateCountableCommandInDB(channelID: string, commandCMD: string, countData: number): Promise<ICommandUpdateResponse> {
        try {
            const command = await CommandsSchema.findOne({ channelID, cmd: commandCMD });
            if (!command) {
                return {
                    error: true,
                    message: 'Command does not exist',
                    status: 400,
                    type: 'command_does_not_exist'
                };
            }

            await command.updateOne({ count: countData });
            await this.invalidateCache(channelID, commandCMD);

            return {
                error: false,
                message: 'Command count updated',
                status: 200,
                type: 'command_updated'
            };
        } catch (error) {
            console.error(`Error updating command count: ${error} for channelID: ${channelID}`);
            return {
                error: true,
                message: 'Error updating command',
                status: 500,
                type: 'error_updating_command'
            };
        }
    }

    async updateCommandAvailability(channelID: string, commandCMD: string, availability: boolean): Promise<ICommandUpdateResponse> {
        try {
            const command = await CommandsSchema.findOne({ channelID, cmd: commandCMD });
            if (!command) {
                return {
                    error: true,
                    message: 'Command does not exist',
                    status: 400,
                    type: 'command_does_not_exist'
                };
            }

            await command.updateOne({ enabled: availability });
            await this.invalidateCache(channelID, commandCMD);

            return {
                error: false,
                message: availability ? 'Command enabled' : 'Command disabled',
                status: 200,
                type: 'command_updated'
            };
        } catch (error) {
            console.error(`Error updating command availability: ${error} for channelID: ${channelID}`);
            return {
                error: true,
                message: 'Error updating command',
                status: 500,
                type: 'error_updating_command'
            };
        }
    }
}

export default new Commands();
