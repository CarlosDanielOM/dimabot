import Commands from '../classes/command.class.js';
import { getDragonflyClient } from '../utils/databases/dragonfly.database.js';
import TwitchStreamers from '../classes/twitch_streamers.class.js';

interface CommandManagerResponse {
    error: boolean;
    message: string;
    where?: string;
    command?: any;
    status?: number;
    channelID?: string;
}

const commandPermissionsLevels: Record<number, string> = {
    1: 'everyone',
    2: 'tier1',
    3: 'tier2',
    4: 'tier3',
    5: 'vip',
    6: 'founder',
    7: 'mod',
    8: 'editor',
    9: 'admin',
    10: 'broadcaster'
};

const commandPermissions: Record<string, number> = {
    everyone: 1,
    tier1: 2,
    tier2: 3,
    tier3: 4,
    vip: 5,
    founder: 6,
    mod: 7,
    editor: 8,
    admin: 9,
    broadcaster: 10
};

const cmdOptionsExistsRegex = new RegExp(/^\-([a-z]+\=[a-zA-Z0-9]+)(?:\W)?(.*)?$/);
const firstCmdOptionsRegex = new RegExp(/([a-z]+\=[a-zA-Z0-9]+)(?:\W)?(.*)?$/);
const cmdOptionValueRegex = new RegExp(/([a-z]+)\=([a-zA-Z0-9]+)?$/);
const specialCommandsFunc = (/\$\((.*?)\)/g);

const maxFuncLength = 350;

interface CmdOptions {
    name: string | undefined;
    cmd: string | undefined;
    type: string | undefined;
    cooldown: number;
    channel: string | undefined;
    channelID: string | undefined;
    userLevel: number;
    userLevelName: string;
    func: string | undefined;
    message: string | undefined;
}

let cmdOptions: CmdOptions = {
    name: undefined,
    cmd: undefined,
    type: undefined,
    cooldown: 10,
    channel: undefined,
    channelID: undefined,
    userLevel: 1,
    userLevelName: 'everyone',
    func: undefined,
    message: undefined
};

function getCmdOptions(text: string) {
    let options: any[] = [];
    let stop = false;

    const firstRaw = text.match(firstCmdOptionsRegex) || [];

    if (firstRaw.length === 0) {
        return { options, text };
    }

    let newText = firstRaw[2] || '';

    const firstRawOption = firstRaw[1];
    const firstOptionMatch = firstRawOption.match(cmdOptionValueRegex) || [];

    const firstOptionName = firstOptionMatch[1];
    const firstOptionValue = firstOptionMatch[2];

    options.push({ name: firstOptionName, value: firstOptionValue });

    while (!stop) {
        const raw = text.match(cmdOptionsExistsRegex) || [];

        if (raw.length === 0) {
            stop = true;
            continue;
        }

        newText = raw[2] || '';

        const rawOption = raw[1];
        const optionMatch = rawOption.match(cmdOptionValueRegex) || [];

        const optionName = optionMatch[1];
        const optionValue = optionMatch[2];

        options.push({ name: optionName, value: optionValue });
    }

    return { options, text: newText };
}

function specialCommands(cmdFunc: string): boolean {
    let countable = false;
    const specials = cmdFunc.match(specialCommandsFunc) || [];

    specials.forEach((special) => {
        const cmdSpecial = specialCommandsFunc.exec(cmdFunc);

        if (cmdSpecial && (cmdSpecial[1] === 'count' || cmdSpecial[1] === 'scount')) {
            countable = true;
        }
    });

    return countable;
}

export async function createCommand(channelID: string, argument: string, type: string | null = null): Promise<CommandManagerResponse> {
    try {
        const cacheClient = await getDragonflyClient('createCommand');
        const streamers = await TwitchStreamers.getTwitchAccountById(channelID);

        if (!streamers) {
            return {
                error: true,
                message: 'Streamer not found'
            };
        }

        cmdOptions.channel = streamers.name ?? '';
        cmdOptions.channelID = channelID ?? '';

        const { options, text } = getCmdOptions(argument);

        options.forEach((option) => {
            switch (option.name) {
                case 'cd':
                    if (Number(option.value) > 5) {
                        cmdOptions.cooldown = Number(option.value);
                    } else {
                        cmdOptions.cooldown = 15;
                    }
                    break;
                case 'ul':
                    if (option.value.length > 1) {
                        const level = commandPermissions[option.value];
                        if (level) {
                            cmdOptions.userLevel = Number(level);
                            cmdOptions.userLevelName = option.value;
                        } else {
                            return {
                                error: true,
                                message: `User level ${option.value} is invalid`
                            };
                        }
                    } else {
                        const level = commandPermissionsLevels[Number(option.value)];
                        if (level) {
                            cmdOptions.userLevel = Number(option.value);
                            cmdOptions.userLevelName = level;
                        } else {
                            return {
                                error: true,
                                message: `User level ${option.value} is invalid`
                            };
                        }
                    }
                    break;
                default:
                    break;
            }
        });

        const opts = text.split(' ');
        const commandName = opts.shift();
        const func = opts.join(' ');

        if (!func) {
            return {
                error: true,
                message: 'Command function is empty'
            };
        }

        if (func.length > maxFuncLength) {
            return {
                error: true,
                message: 'Command function is too long'
            };
        }

        cmdOptions.name = commandName ?? '';
        cmdOptions.cmd = commandName ?? '';
        cmdOptions.func = commandName ?? '';
        cmdOptions.message = func;
        cmdOptions.type = type ? type : 'command';

        if (specialCommands(cmdOptions.message)) {
            cmdOptions.type = 'countable';
        }

        const command = await Commands.createCommand(channelID, cmdOptions);

        if (command.error) {
            return {
                error: true,
                message: command.message,
                status: command.status ?? 500
            };
        }

        const cacheKey = `twitch:${channelID}:commands:${command.command?.cmd ?? 'undefined'}`;
        await cacheClient.del(cacheKey);

        return {
            error: false,
            message: `Command ${command.command?.name ?? 'undefined'} created`,
            command: command.command ?? undefined,
            status: command.status ?? 500
        };
    } catch (error) {
        console.error(`Error in createCommand:`, {
            channelID,
            argument,
            type,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });

        return {
            error: true,
            message: 'Error creating command'
        };
    }
}

export async function deleteCommand(channelID: string, commandCMD: string, userLevel: number = 1): Promise<CommandManagerResponse> {
    try {
        const exists = await Commands.getCommandFromDB(channelID, commandCMD);
        const cacheClient = await getDragonflyClient('deleteCommand');
        const cacheKey = `twitch:${channelID}:commands:${commandCMD ?? 'undefined'}`;

        if (exists.error || !exists.command) {
            return {
                error: true,
                message: exists.message,
                status: exists.status ?? 500
            };
        }

        const command = exists.command;

        if (command.reserved) {
            return {
                error: true,
                message: 'You cannot delete a reserved command'
            };
        }

        if (userLevel < command.userLevel) {
            return {
                error: true,
                message: 'You do not have enough permissions to delete this command',
                where: 'userLevel',
                channelID,
                status: 403
            };
        }

        // const timers = await commandTimerSchema.find({ channelID, command: command.cmd });

        // if (timers && timers.length > 0) {
        //     return {
        //         error: true,
        //         message: 'You cannot delete a command with active timers'
        //     };
        // }

        const deleted = await Commands.deleteCommand(channelID, commandCMD);
        await cacheClient.del(cacheKey);

        if (deleted.error) {
            return {
                error: true,
                message: deleted.message
            };
        }

        return {
            error: false,
            message: `Command ${command.cmd} deleted`
        };
    } catch (error) {
        console.error(`Error in deleteCommand:`, {
            channelID,
            commandCMD,
            userLevel,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });

        return {
            error: true,
            message: 'Error deleting command'
        };
    }
}

export async function editCommand(channelID: string, argument: string, userLevel: number = 1): Promise<CommandManagerResponse> {
    try {
        const cacheClient = await getDragonflyClient('editCommand');
        const { options, text } = getCmdOptions(argument);
        const opts = text.split(' ');
        const commandName = opts.shift();
        const cacheKey = `twitch:${channelID}:commands:${commandName ?? 'undefined'}`;

        const oldCommand = await Commands.getCommandFromDB(channelID, commandName!);

        if (oldCommand.error || !oldCommand.command) {
            const oldCommandResult = await Commands.getReservedCommandFromDB(channelID, commandName!);
            if (oldCommandResult.error || !oldCommandResult.command) {
                return {
                    error: true,
                    message: oldCommandResult.message
                };
            }
            return {
                error: true,
                message: oldCommandResult.message
            };
        }

        const command = oldCommand.command;

        if (userLevel < command.userLevel) {
            return {
                error: true,
                message: 'You do not have enough permissions to edit this command',
                where: 'userLevel',
                channelID,
                status: 403
            };
        }

        options.forEach((option) => {
            switch (option.name) {
                case 'cd':
                    if (Number(option.value) >= 5) {
                        command.cooldown = Number(option.value);
                    } else {
                        command.cooldown = 15;
                    }
                    cacheClient.hSet(cacheKey, 'cooldown', command.cooldown);
                    break;
                case 'ul':
                    if (option.value.length > 1) {
                        const level = commandPermissions[option.value];
                        if (level) {
                            command.userLevel = Number(level);
                            command.userLevelName = option.value;
                        } else {
                            return {
                                error: true,
                                message: `User level ${option.value} is invalid`
                            };
                        }
                    } else {
                        const level = commandPermissionsLevels[Number(option.value)];
                        if (level) {
                            command.userLevel = Number(level);
                            command.userLevelName = level;
                        } else {
                            return {
                                error: true,
                                message: `User level ${option.value} is invalid`
                            };
                        }
                    }
                    cacheClient.hSet(cacheKey, 'level', command.userLevel);
                    break;
                default:
                    break;
            }
        });

        const func = opts.join(' ');

        if (func.length > maxFuncLength) {
            return {
                error: true,
                message: 'Command function is too long'
            };
        }

        if (!command.reserved) {
            if (specialCommands(func)) {
                command.type = 'countable';
            }

            if (func.length > 0) {
                command.message = func;
            }
        }

        const updated = await Commands.updateCommandInDB(channelID, commandName!, command);

        await cacheClient.del(cacheKey);

        if (updated.error) {
            return {
                error: true,
                message: updated.message,
                status: updated.status ?? 500
            };
        }

        await cacheClient.hSet(cacheKey, command as any);

        return {
            error: false,
            message: `Command ${commandName ?? 'undefined'} updated`,
            command: command ?? undefined,
            status: updated.status ?? 500
        };
    } catch (error) {
        console.error(`Error in editCommand:`, {
            channelID,
            argument,
            userLevel,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });

        return {
            error: true,
            message: 'Error updating command'
        };
    }
}
