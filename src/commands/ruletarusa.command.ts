import { removeChannelModerator } from '../functions/channels/remove_moderator.channel.js';
import { addModerator } from '../functions/channels/add_moderator.channel.js';
import { ban } from '../functions/moderation/index.js';
import { getTwitchUserByLogin } from '../functions/users/index.js';
import { getDragonflyClient } from '../utils/databases/dragonfly.database.js';
import { error, info } from '../utils/logger.js';

interface RuletarusaResponse {
    error: boolean;
    message: string;
    status?: number;
    where?: string;
}

export async function ruletarusaCommand(channelID: string, user: string, isMod: boolean = false, modID: string = '698614112'): Promise<RuletarusaResponse> {
    try {
        const cacheClient = await getDragonflyClient('ruletarusaCommand');

        const isEditor = await cacheClient.sIsMember(`${channelID}:channel:editors`, user.toLowerCase());

        if (isEditor === 1) {
            return {
                error: false,
                message: `Como editor no puedes jugar a la ruleta rusa.`,
                status: 403,
                where: 'editor check'
            };
        }

        const userDataResult = await getTwitchUserByLogin(user);
        if (userDataResult.error || !userDataResult.data) {
            return {
                error: true,
                message: userDataResult.message,
                status: userDataResult.status,
                where: 'userData'
            };
        }

        const userData = userDataResult.data;

        if (userData.id == channelID) {
            return {
                error: false,
                message: `No puedes jugar a la ruleta rusa en tu propio canal.`,
                status: 403,
                where: 'channel owner check'
            };
        }

        const probability = Math.floor(Math.random() * 120) + 1;
        let dead = false;

        if (probability % 3 === 0) {
            dead = true;
        }

        const exists = await cacheClient.exists(`${channelID}:roulette:${userData.id}`);
        if (exists === 1) {
            const attempt = await cacheClient.incr(`${channelID}:roulette:${userData.id}`);
        } else {
            await cacheClient.set(`${channelID}:roulette:${userData.id}`, 1);
        }

        const attempts = await cacheClient.get(`${channelID}:roulette:${userData.id}`);

        if (!dead) {
            return {
                error: false,
                message: `${userData.display_name} ha jalado el gatillo y la bala no ha sido disparada. Lleva ${attempts} intentos.`,
                status: 200,
                where: 'alive'
            };
        }

        const BASE_TIMEOUT = 10;
        const previousDiedCount = await cacheClient.get(`${channelID}:roulette:${userData.id}:died`);
        const previousDied = Number(previousDiedCount) || 0;

        let timeoutTime = BASE_TIMEOUT * (previousDied + 1);

        if (channelID == '81308976') {
            if (timeoutTime < 300) {
                timeoutTime = 300;
            }
        }

        if (!isMod) {
            const timeout = await ban(channelID, userData.id, modID, timeoutTime, 'Ruleta rusa');
            if (timeout.error) {
                return {
                    error: true,
                    message: timeout.message,
                    status: timeout.status,
                    where: 'timeout no mod'
                };
            }
        } else {
            const removeMod = await removeChannelModerator(channelID, userData.id);
            if (removeMod.error) {
                return {
                    error: true,
                    message: removeMod.message,
                    status: removeMod.status,
                    where: 'removeMod'
                };
            }

            const timeout = await ban(channelID, userData.id, modID, timeoutTime, 'Ruleta rusa');

            if (timeout.error) {
                return {
                    error: true,
                    message: timeout.message,
                    status: timeout.status,
                    where: 'timeout mod'
                };
            }

            setTimeout(async () => {
                const addMod = await addModerator(channelID, userData.id);
                if (addMod.error) {
                    await error({ function: 'ruletarusaCommand.addModerator', addMod }, { channelId: channelID, destination: 'both' });
                }
            }, 1000 * timeoutTime + 5000);
        }

        await cacheClient.del(`${channelID}:roulette:${userData.id}`);

        const timeDied = await cacheClient.exists(`${channelID}:roulette:${userData.id}:died`);
        const diedCount = Number(timeDied);
        if (diedCount === 1) {
            await cacheClient.incr(`${channelID}:roulette:${userData.id}:died`);
        } else {
            await cacheClient.set(`${channelID}:roulette:${userData.id}:died`, 1);
            await cacheClient.expire(`${channelID}:roulette:${userData.id}:died`, 600);
        }

        return {
            error: false,
            message: `${userData.display_name} ha jalado el gatillo y la bala ha sido disparada. Se murio en el intento #${attempts}.`,
            status: 200,
            where: 'dead'
        };
    } catch (err) {
        await error({
            function: 'ruletarusaCommand',
            channelID,
            user,
            isMod,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
        }, { channelId: channelID, destination: 'both' });

        return {
            error: true,
            message: 'Internal server error'
        };
    }
}
