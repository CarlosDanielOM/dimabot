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

interface CreatePredictionResponse {
    error?: boolean;
    message?: string;
    status?: number;
    type?: string;
    id?: string;
    title?: string;
    outcomes?: PredictionOutcome[];
    channelID?: string;
    channel?: string;
    predictionStatus?: string;
    winning_outcome_id?: string;
    winning_outcome?: PredictionOutcome;
}

export async function createPrediction(channelID: string, title: string, outcomes: { title: string }[], duration: string | number, cache: boolean = false): Promise<CreatePredictionResponse> {
    try {
        const cacheClient = await getDragonflyClient('createPrediction');

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
            outcomes: outcomes,
            prediction_window: Number(duration)
        };

        const response = await fetch(getTwitchHelixUrl('predictions'), {
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

        const prediction = data.data[0];

        const outcomesData = prediction.outcomes.map((outcome: any) => {
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
            outcomes: outcomesData,
            channelID: prediction.broadcaster_id,
            channel: prediction.broadcaster_login,
            predictionStatus: prediction.status
        };

        if (prediction.winning_outcome_id) {
            predictionData.winning_outcome_id = prediction.winning_outcome_id;
            const winning_outcome = outcomesData.find((outcome: PredictionOutcome) => outcome.id === prediction.winning_outcome_id);
            predictionData.winning_outcome = winning_outcome;
        }

        if (cache) {
            await cacheClient.set(`twitch:${channelID}:predictions`, JSON.stringify(predictionData));
        }

        return {
            error: false,
            message: 'Prediction created successfully',
            id: predictionData.id,
            title: predictionData.title,
            outcomes: predictionData.outcomes,
            channelID: predictionData.channelID,
            channel: predictionData.channel,
            predictionStatus: predictionData.predictionStatus,
            winning_outcome_id: predictionData.winning_outcome_id,
            winning_outcome: predictionData.winning_outcome
        };
    } catch (error) {
        console.error(`Error in createPrediction:`, {
            channelID,
            title,
            outcomes,
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
