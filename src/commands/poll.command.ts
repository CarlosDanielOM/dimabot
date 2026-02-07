import { createPoll, getPoll, endPoll } from '../functions/polls/index.js';
import { error as logError } from '../utils/logger.js';

interface PollResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

export async function pollCommand(action: string, channelID: string, argument?: string): Promise<PollResponse> {
    try {
        let pollData = null;
        let pollID = null;
        let res = null;

        if (!action) {
            return {
                error: true,
                message: 'The action is required',
                status: 400,
                type: 'error'
            };
        }

        if (action !== 'CREATE') {
            const exists = await getPoll(channelID);

            if (exists.error || !exists.data || exists.data.status !== 'ACTIVE') {
                return {
                    error: true,
                    message: 'There is no active poll',
                    status: 404,
                    type: 'error'
                };
            }

            pollID = exists.data.id;

            res = await endPoll(channelID, pollID, action);

            if (res.error) {
                return {
                    error: true,
                    message: res.message || '',
                    status: res.status || 0,
                    type: res.type
                };
            }

            return {
                error: false,
                message: 'Poll ended',
                status: 200,
                type: 'success'
            };
        }

        const opt = argument ? argument.split(';') : [];

        const choices = opt[1]?.split('\/').map((choice) => {
            return {
                title: choice
            };
        }) || [];

        const opts = {
            title: opt[0] || '',
            choices: choices,
            duration: Number(opt[2] || '0') || 0
        };

        res = await createPoll(channelID, opts.title, opts.choices, opts.duration);

        if (res.error) {
            return {
                error: true,
                message: res.message || '',
                status: res.status || 0,
                type: res.type
            };
        }

        return {
            error: false,
            message: 'Poll created',
            status: 200,
            type: 'success'
        };
    } catch (err) {
        await logError({
            function: 'pollCommand',
            action,
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
