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
}

interface EndPollResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    data?: PollData;
}

export async function endPoll(channelID: string, pollID: string, status: string): Promise<EndPollResponse> {
    try {
        const cacheClient = await getDragonflyClient('endPoll');

        if (status !== 'TERMINATED' && status !== 'ARCHIVED') {
            return {
                error: true,
                message: 'Invalid status',
                status: 400,
                type: 'invalid_status'
            };
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

        const bodyData = {
            broadcaster_id: channelID,
            id: pollID,
            status: status
        };

        const response = await fetch(getTwitchHelixUrl('polls'), {
            method: 'PATCH',
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

        await cacheClient.del(`twitch:${channelID}:polls`);

        return {
            error: false,
            message: 'Poll ended successfully',
            data: pollData
        };
    } catch (error) {
        console.error(`Error in endPoll:`, {
            channelID,
            pollID,
            status,
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
