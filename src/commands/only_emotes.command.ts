import { setOnlyEmotes, getOnlyEmotes } from '../functions/chats/index.js';
import { getDragonflyClient } from '../utils/databases/dragonfly.database.js';

interface OnlyEmotesResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

export async function onlyEmotesCommand(channelID: string, argument?: string): Promise<OnlyEmotesResponse> {
    try {
        const cacheClient = await getDragonflyClient('onlyEmotesCommand');

        let seconds = 0;

        if (argument) {
            seconds = parseInt(argument);

            if (isNaN(seconds)) {
                return {
                    error: true,
                    message: 'The argument must be a number',
                    status: 400,
                    type: 'error'
                };
            }
        }

        let value = 1;
        let active = false;
        let cachedStatus = await cacheClient.get(`${channelID}:chat:onlyemotes`);

        if (!cachedStatus) {
            const activeResult = await getOnlyEmotes(channelID);

            if (activeResult.error) {
                return {
                    error: true,
                    message: activeResult.message,
                    status: activeResult.status,
                    type: activeResult.type
                };
            }

            if (activeResult.data) {
                value = 1;
            } else {
                value = 0;
            }

            await cacheClient.set(`${channelID}:chat:onlyemotes`, value, { EX: 60 * 60 });
            cachedStatus = String(value);
        }

        if (cachedStatus === '1') {
            value = 0;
            active = false;
        } else {
            value = 1;
            active = true;
        }

        const res = await setOnlyEmotes(channelID, active, channelID);

        if (res.error) {
            return {
                error: true,
                message: res.message,
                status: res.status,
                type: res.type
            };
        }

        await cacheClient.set(`${channelID}:chat:onlyemotes`, value, { EX: 60 * 60 });

        if (seconds > 0) {
            setTimeout(async () => {
                await setOnlyEmotes(channelID, false, channelID);
                await cacheClient.set(`${channelID}:chat:onlyemotes`, 0, { EX: 60 * 60 });
            }, seconds * 1000);
        }

        return {
            error: false,
            message: `The chat is now ${active ? 'only emotes' : 'normal'} ${seconds > 0 ? `for ${seconds} seconds` : ''}`,
            status: 200,
            type: 'success'
        };
    } catch (error) {
        console.error(`Error in onlyEmotesCommand:`, {
            channelID,
            argument,
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
