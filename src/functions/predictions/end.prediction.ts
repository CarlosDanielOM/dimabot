import { getDragonflyClient } from '../../utils/databases/dragonfly.database.js';
import { getTwitchStreamerHeaderById } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';

interface TopPredictor {
    user_id: string;
    user_name: string;
    user_login: string;
    channel_points_won: number | null;
    channel_points_used: number;
}

interface PredictionOutcome {
    id: string;
    title: string;
    users: number;
    channel_points: number;
    top_predictors: TopPredictor[];
    color: string;
}

interface PredictionData {
    id: string;
    title: string;
    outcomes: PredictionOutcome[];
    channelID: string;
    channel: string;
    predictionStatus: string;
    winning_outcome_id?: string;
    winning_outcome?: PredictionOutcome;
}

interface EndPredictionResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    data?: PredictionData;
}

export async function endPrediction(channelID: string, predictionID: string, status: string, winnerID: string | null = null): Promise<EndPredictionResponse> {
    try {
        const cacheClient = await getDragonflyClient('endPrediction');

        if (status !== 'RESOLVED' && status !== 'CANCELED' && status !== 'LOCKED') {
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

        const bodyData: any = {
            broadcaster_id: channelID,
            id: predictionID,
            status: status
        };

        if (status === 'RESOLVED' && winnerID) {
            bodyData.winning_outcome_id = winnerID;
        }

        const response = await fetch(getTwitchHelixUrl('predictions'), {
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

        const prediction = data.data[0];

        const outcomes = prediction.outcomes.map((outcome: any) => {
            return {
                id: outcome.id,
                title: outcome.title,
                users: outcome.users,
                channel_points: outcome.channel_points,
                top_predictors: outcome.top_predictors,
                color: outcome.color
            };
        });

        const predictionData: PredictionData = {
            id: prediction.id,
            title: prediction.title,
            outcomes: outcomes,
            channelID: prediction.broadcaster_id,
            channel: prediction.broadcaster_login,
            predictionStatus: prediction.status
        };

        if (prediction.winning_outcome_id) {
            predictionData.winning_outcome_id = prediction.winning_outcome_id;
            const winning_outcome = outcomes.find((outcome: PredictionOutcome) => outcome.id === prediction.winning_outcome_id);
            predictionData.winning_outcome = winning_outcome;
        }

        await cacheClient.del(`twitch:${channelID}:predictions`);

        return {
            error: false,
            message: 'Prediction ended successfully',
            data: predictionData
        };
    } catch (error) {
        console.error(`Error in endPrediction:`, {
            channelID,
            predictionID,
            status,
            winnerID,
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
