import { getChannelInformation, setChannelInformation } from '../functions/channels/index.js';
import { searchCategories } from '../functions/search/index.js';

interface GameResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

export async function gameCommand(
    channelID: string,
    argument: string | null = null,
    userLevel: number = 1,
    commandLevel: number = 7
): Promise<GameResponse> {
    try {
        if (!argument || userLevel < commandLevel) {
            const game = await getChannelInformation(channelID);

            if (game.error || !game.data) {
                return {
                    error: true,
                    message: game.message || 'Error',
                    status: game.status,
                    type: 'error'
                };
            }

            const gameName = game.data.game_name;

            return {
                error: false,
                message: `The current game is ${gameName}`,
                status: 200,
                type: 'success'
            };
        }

        const gameInfo = await searchCategories(argument);

        if (gameInfo.error || !gameInfo.data) {
            return {
                error: true,
                message: gameInfo.message || 'Error searching for game',
                status: gameInfo.status,
                type: gameInfo.type || 'error'
            };
        }

        if (gameInfo.data.length === 0) {
            return {
                error: true,
                message: 'The game does not exist',
                status: 404,
                type: 'error'
            };
        }

        let gameID: string | null = null;
        let gameName: string | null = null;

        for (const category of gameInfo.data) {
            if (category.name.toLowerCase() === argument.toLowerCase()) {
                gameID = category.id;
                gameName = category.name;
                break;
            }
        }

        if (!gameID || !gameName) {
            gameID = gameInfo.data[0].id;
            gameName = gameInfo.data[0].name;
        }

        const gameData = {
            game_id: gameID,
            game_name: gameName
        };

        const game = await setChannelInformation(channelID, gameData);

        if (game.error) {
            return {
                error: true,
                message: game.message || 'Error setting game',
                status: game.status,
                type: game.type || 'error'
            };
        }

        return {
            error: false,
            message: `The game has been set to ${gameData.game_name}`,
            status: 200,
            type: 'success'
        };
    } catch (error) {
        console.error(`Error in gameCommand:`, {
            channelID,
            argument,
            userLevel,
            commandLevel,
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
