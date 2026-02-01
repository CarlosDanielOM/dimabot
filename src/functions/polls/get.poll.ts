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
    status: string;
}

interface GetPollResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    data?: PollData;
}

export async function getPoll(channelID: string, pollID: string | null = null, cache: boolean = false): Promise<GetPollResponse> {
    try {
        const cacheClient = await getDragonflyClient('getPoll');
        const cacheKey = `twitch:${channelID}:polls`;

        if (cache) {
            const cachedData = await cacheClient.get(cacheKey);
            if (cachedData) {
                const parsedData = JSON.parse(cachedData);
                return {
                    error: false,
                    message: 'Success (from cache)',
                    data: parsedData
                };
            }
        }

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

        const params = new URLSearchParams();
        params.append('broadcaster_id', channelID);

        if (pollID) {
            params.append('id', pollID);
        }

        const response = await fetch(getTwitchHelixUrl('polls', params.toString()), {
            headers: streamerHeader as unknown as Record<string, string>
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

        if (data.data.length === 0 || response.status === 404) {
            return {
                error: true,
                message: 'Poll not found',
                status: response.status,
                type: data.error ?? 'not_found'
            };
        }

        const poll = data.data[0];

        const choices = poll.choices.map((choice: any) => {
            return {
                id: choice.id,
                title: choice.title,
                votes: choice.votes
            };
        });

        const pollData = {
            id: poll.id,
            title: poll.title,
            choices: choices,
            channelID: poll.broadcaster_id,
            channel: poll.broadcaster_login,
            status: poll.status
        };

        if (cache) {
            await cacheClient.set(cacheKey, JSON.stringify(pollData));
        }

        return {
            error: false,
            message: 'Success',
            data: pollData
        };
    } catch (error) {
        console.error(`Error in getPoll:`, {
            channelID,
            pollID,
            cache,
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
