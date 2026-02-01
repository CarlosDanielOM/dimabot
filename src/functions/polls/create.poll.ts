import { getDragonflyClient } from '../../utils/databases/dragonfly.database.js';
import { getTwitchStreamerHeaderById } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';

interface PollChoice {
    id: string;
    title: string;
    votes: number;
}

interface PollData {
    id: string;
    title: string;
    choices: PollChoice[];
    channelID: string;
    channel: string;
    status?: string;
}

interface CreatePollResponse {
    error?: boolean;
    message?: string;
    status?: number;
    type?: string;
    id?: string;
    title?: string;
    choices?: PollChoice[];
    channelID?: string;
    channel?: string;
}

export async function createPoll(channelID: string, title: string, choices: { title: string }[], duration: string | number, cache: boolean = false): Promise<CreatePollResponse> {
    try {
        const cacheClient = await getDragonflyClient('createPoll');

        const streamerHeaderResult = await getTwitchStreamerHeaderById(channelID);

        if (streamerHeaderResult.error || !streamerHeaderResult.header) {
            return {
                error: true,
                message: streamerHeaderResult.message,
                status: 403,
                type: 'permission_error'
            };
        }

        const streamerHeader = streamerHeaderResult.header;

        const bodyData = {
            broadcaster_id: channelID,
            title: title,
            choices: choices,
            duration: Number(duration)
        };

        const response = await fetch(getTwitchHelixUrl('polls'), {
            method: 'POST',
            headers: streamerHeader as unknown as Record<string, string>,
            body: JSON.stringify(bodyData)
        });

        const data = await response.json();

        if (data.error) {
            return {
                error: true,
                message: data.message,
                status: response.status,
                type: data.error
            };
        }

        const poll = data.data[0];

        const choicesData = poll.choices.map((choice: any) => {
            return {
                id: choice.id,
                title: choice.title,
                votes: choice.votes
            };
        });

        const pollData = {
            id: poll.id,
            title: poll.title,
            choices: choicesData,
            channelID: poll.broadcaster_id,
            channel: poll.broadcaster_login
        };

        if (cache) {
            await cacheClient.set(`twitch:${channelID}:polls`, JSON.stringify(pollData));
        }

        return pollData;
    } catch (error) {
        console.error(`Error in createPoll:`, {
            channelID,
            title,
            choices,
            duration,
            cache,
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
