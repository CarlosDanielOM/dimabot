import { createPrediction, getPrediction, endPrediction } from '../functions/predictions/index.js';
import { error as logError } from '../utils/logger.js';

interface PredictionResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

export async function predictionCommand(action: string, channelID: string, argument?: string): Promise<PredictionResponse> {
    try {
        let res = null;
        let predictionData = null;
        let predictionID = null;

        if (!action) {
            return {
                error: true,
                message: 'The action is required',
                status: 400,
                type: 'error'
            };
        }

        if (action !== 'CREATE') {
            const exists = await getPrediction(channelID);

            if (exists.error || !exists.data || (exists.data.status !== 'ACTIVE' && exists.data.status !== 'LOCKED')) {
                return {
                    error: true,
                    message: 'There is no active prediction',
                    status: 404,
                    type: 'error'
                };
            }

            predictionID = exists.data.id;
            predictionData = exists.data;
        }

        if (action === 'RESOLVED') {
            let winner = null;
            const won = Number(argument);

            if (isNaN(won)) {
                return {
                    error: true,
                    message: 'The argument should be a number',
                    status: 400,
                    type: 'error'
                };
            }

            if (!predictionData || (won <= 0 || won > predictionData.outcomes.length)) {
                return {
                    error: true,
                    message: `The argument should be a number between 1 and ${predictionData?.outcomes?.length || 2}`,
                    status: 400,
                    type: 'error'
                };
            }

            const winnerIndex = won - 1;
            const winnerOutcome = predictionData.outcomes[winnerIndex];

            res = await endPrediction(channelID, predictionID!, action, winnerOutcome?.id || '');

            if (res.error) {
                return {
                    error: true,
                    message: res.message || '',
                    status: res.status || 0,
                    type: res.type || ''
                };
            }

            return {
                error: false,
                message: 'The prediction has ended with the outcome: ' + winnerOutcome.title,
                status: 200,
                type: 'success'
            };
        } else if (action === 'CREATE') {
            const opt = argument ? argument.split(';') : [];

            const outcomes = opt[1]?.split('\/').map((outcome) => {
                return {
                    title: outcome
                };
            }) || [];

            const duration = Number(opt[2]) || 0;

            if (isNaN(duration)) {
                return {
                    error: true,
                    message: 'The duration should be a number',
                    status: 400,
                    type: 'error'
                };
            }

            res = await createPrediction(channelID, opt[0] || '', outcomes, duration);

            if (res.error) {
                return {
                    error: true,
                    message: res.message || '',
                    status: res.status || 0,
                    type: res.type || ''
                };
            }

            return {
                error: false,
                message: 'Prediction created',
                status: 200,
                type: 'success'
            };
        } else {
            if (!predictionID) {
                return {
                    error: true,
                    message: 'Prediction ID not found',
                    status: 500,
                    type: 'error'
                };
            }

            res = await endPrediction(channelID, predictionID, action);

            if (res.error) {
                return {
                    error: true,
                    message: res.message || '',
                    status: res.status || 0,
                    type: res.type || ''
                };
            }

            return {
                error: false,
                message: 'Prediction ' + action.toLowerCase(),
                status: 200,
                type: 'success'
            };
        }
    } catch (err) {
        await logError({
            function: 'predictionCommand',
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
