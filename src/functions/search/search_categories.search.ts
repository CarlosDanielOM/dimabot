import { getTwitchBotHeader } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';

interface TwitchCategory {
    id: string;
    name: string;
    box_art_url: string;
    igdb_id?: string;
}

interface SearchCategoriesResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    data?: TwitchCategory[];
}

export async function searchCategories(query: string): Promise<SearchCategoriesResponse> {
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
        params.append('query', query);

        const response = await fetch(getTwitchHelixUrl('search/categories', params.toString()), {
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

        return {
            error: false,
            message: 'Categories found',
            data: data.data
        };
    } catch (error) {
        console.error(`Error in searchCategories:`, {
            query,
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
