import { addModerator } from '../functions/channels/index.js';
import { removeChannelModerator } from '../functions/channels/remove_moderator.channel.js';
import { ban } from '../functions/moderation/index.js';
import { getTwitchUserByLogin } from '../functions/users/index.js';
import { getDragonflyClient } from '../utils/databases/dragonfly.database.js';

interface VanishResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    where?: string;
}

export async function vanishCommand(channelID: string, tags: any, modID: string = '698614112'): Promise<VanishResponse> {
    try {
        const cacheClient = await getDragonflyClient('vanishCommand');

        const isEditor = await cacheClient.sIsMember(`${channelID}:channel:editors`, tags.username.toLowerCase());

        if (isEditor === 1) {
            return {
                error: false,
                message: `As an editor you can't vanish from the chat.`,
                status: 403,
                type: 'error'
            };
        }

        if (tags.mod) {
            const removeMod = await removeChannelModerator(channelID, tags['user-id']);
            if (removeMod.error) {
                return {
                    error: true,
                    message: removeMod.message,
                    status: removeMod.status,
                    type: removeMod.type,
                    where: 'removeMod'
                };
            }

            setTimeout(async () => {
                const addMod = await addModerator(channelID, tags['user-id']);
                if (addMod.error) {
                    console.log({
                        error: true,
                        message: addMod.message,
                        status: addMod.status,
                        type: addMod.type,
                        where: 'addMod'
                    });
                }
            }, 1000 * 10);
        }

        const timeout = await ban(channelID, tags['user-id'], modID, 3, 'Vanish');
        if (timeout.error) {
            return {
                error: true,
                message: timeout.message,
                status: timeout.status,
                type: timeout.type,
                where: 'timeout'
            };
        }

        return {
            error: false,
            message: `${tags['display-name'] || tags.username} has vanished from the chat!`,
            status: 200,
            type: 'success'
        };
    } catch (error) {
        console.error(`Error in vanishCommand:`, {
            channelID,
            tags,
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
