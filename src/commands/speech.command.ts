import { error } from '../utils/logger.js';
import { queueDefaultTts } from '../utils/tts/queue_default_tts.util.js';

interface Tags {
    id: string;
    username: string;
    'display-name': string;
    emotes?: Record<string, string[]>;
    emoteNames?: string[];
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
        const rawMessage = argument ?? undefined;

        if (!rawMessage) {
            return {
                error: true,
                message: 'No message provided',
                status: 400,
                type: 'error',
                where: 'speech'
            };
        }

        const speachData = await queueDefaultTts({
            channelID,
            rawMessage,
            source: 'chat-command',
            userID: tags.id,
            userLogin: tags.username,
            userName: tags['display-name'],
            userLevel: 1,
            emotes: tags.emotes,
            emoteNames: tags.emoteNames
        });

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
    } catch (err) {
        await error({
            function: 'speechCommand',
            channelID,
            argument,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
        }, { channelId: channelID, destination: 'both' });

        return {
            error: true,
            message: 'Internal server error'
        };
    }
}
