import { speach } from '../functions/chats/index.js';

const linkRegex = new RegExp(/((http|https):\/\/)?(www\.)?[a-zA-Z-]+(\.[a-zA-Z-]{2})+(:\d+)?(\/\S*)?(\?\S+)?/gi);

interface Tags {
    id: string;
    username: string;
    'display-name': string;
    emotes?: Record<string, string[]>;
}

interface SpeechResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    where?: string;
}

export async function speechCommand(channelID: string, tags: Tags, argument?: string): Promise<SpeechResponse> {
    try {
        const user = tags.username;
        let message = argument ?? undefined;

        if (!message) {
            return {
                error: true,
                message: 'No message provided',
                status: 400,
                type: 'error',
                where: 'speech'
            };
        }

        const emotesToReplace: string[] = [];

        if (tags.emotes) {
            for (const emote in tags.emotes) {
                const emoteData = tags.emotes[emote];
                emoteData.forEach((emote) => {
                    const locations = emote.split('-');
                    const start = parseInt(locations[0]) -3;
                    const end = parseInt(locations[1]);
                    const emoteName = message!.substring(start, end - 2);
                    emotesToReplace.push(emoteName);
                });
            }

            emotesToReplace.forEach((emote) => {
                message = message!.replace(emote, '');
            });
        }

        const haslink = message.match(linkRegex);
        if (haslink) {
            message = message.replace(linkRegex, "[LINK]");
        }

        const msg = `${user} dice: ${message}`;

        const speachData = await speach(tags.id, msg, channelID);

        if (speachData.error) {
            return {
                error: true,
                message: speachData.message,
                status: speachData.status,
                type: speachData.type
            };
        }

        return {
            error: false,
            message: 'Speech sent',
            status: 200,
            type: 'success'
        };
    } catch (error) {
        console.error(`Error in speechCommand:`, {
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
