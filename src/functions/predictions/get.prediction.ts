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

interface GetPredictionResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    data?: PredictionData;
}

export async function getPrediction(channelID: string, predictionID: string | null = null, cache: boolean = false): Promise<GetPredictionResponse> {
    try {
        const cacheClient = await getDragonflyClient('getPrediction');
        const cacheKey = `twitch:${channelID}:predictions`;

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

        if (predictionID) {
            params.append('id', predictionID);
        }

        const response = await fetch(getTwitchHelixUrl('predictions', params.toString()), {
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
                message: 'Prediction not found',
                status: response.status,
                type: data.error ?? 'not_found'
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

        if (cache) {
            await cacheClient.set(cacheKey, JSON.stringify(predictionData));
        }

        return {
            error: false,
            message: 'Success',
            data: predictionData
        };
    } catch (error) {
        console.error(`Error in getPrediction:`, {
            channelID,
            predictionID,
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
