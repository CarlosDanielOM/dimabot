import { getTwitchBotHeader } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';

interface TwitchGame {
    id: string;
    name: string;
    box_art_url: string;
    igdb_id?: string;
}

interface SearchGameResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    data?: TwitchGame;
}

export async function searchGameById(gameID: string): Promise<SearchGameResponse> {
    try {
        const botHeaderResult = await getTwitchBotHeader();

        if (botHeaderResult.error || !botHeaderResult.header) {
            return {
                error: true,
                message: botHeaderResult.message,
                status: 403,
                type: 'permission_error'
            };
        }

        const botHeader = botHeaderResult.header;

        const params = new URLSearchParams();
        params.append('id', gameID);

        const response = await fetch(getTwitchHelixUrl('games', params.toString()), {
            headers: botHeader as unknown as Record<string, string>
        });

        const data = await response.json();

        if (data.error) {
            return {
                error: true,
                message: data.message,
                status: data.status,
                type: data.error
            };
        }

        if (data.data.length === 0) {
            return {
                error: true,
                message: 'Game not found',
                status: 404,
                type: 'Game not found'
            };
        }

        return {
            error: false,
            message: 'Game found',
            data: data.data[0]
        };
    } catch (error) {
        console.error(`Error in searchGameById:`, {
            gameID,
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

export async function searchGameByName(gameName: string): Promise<SearchGameResponse> {
    try {
        const botHeaderResult = await getTwitchBotHeader();

        if (botHeaderResult.error || !botHeaderResult.header) {
            return {
                error: true,
                message: botHeaderResult.message,
                status: 403,
                type: 'permission_error'
            };
        }

        const botHeader = botHeaderResult.header;

        const params = new URLSearchParams();
        params.append('name', gameName);

        const response = await fetch(getTwitchHelixUrl('games', params.toString()), {
            headers: botHeader as unknown as Record<string, string>
        });

        const data = await response.json();

        if (data.error) {
            return {
                error: true,
                message: data.message,
                status: data.status,
                type: data.error
            };
        }

        if (data.data.length === 0) {
            return {
                error: true,
                message: 'Game not found',
                status: 404,
                type: 'Game not found'
            };
        }

        return {
            error: false,
            message: 'Game found',
            data: data.data[0]
        };
    } catch (error) {
        console.error(`Error in searchGameByName:`, {
            gameName,
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

export async function searchGameByIgdbId(igdbID: string): Promise<SearchGameResponse> {
    try {
        const botHeaderResult = await getTwitchBotHeader();

        if (botHeaderResult.error || !botHeaderResult.header) {
            return {
                error: true,
                message: botHeaderResult.message,
                status: 403,
                type: 'permission_error'
            };
        }

        const botHeader = botHeaderResult.header;

        const params = new URLSearchParams();
        params.append('external_id', igdbID);

        const response = await fetch(getTwitchHelixUrl('games', params.toString()), {
            headers: botHeader as unknown as Record<string, string>
        });

        const data = await response.json();

        if (data.error) {
            return {
                error: true,
                message: data.message,
                status: data.status,
                type: data.error
            };
        }

        if (data.data.length === 0) {
            return {
                error: true,
                message: 'Game not found',
                status: 404,
                type: 'Game not found'
            };
        }

        return {
            error: false,
            message: 'Game found',
            data: data.data[0]
        };
    } catch (error) {
        console.error(`Error in searchGameByIgdbId:`, {
            igdbID,
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
