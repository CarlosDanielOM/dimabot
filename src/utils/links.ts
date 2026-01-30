export const getTwitchHelixUrl = (endpoint: string, params: string | null = null) => {
    return `https://api.twitch.tv/helix/${endpoint}${params ? `?${params}` : ''}`;
}

export const getTwitchOAuthUrl = (endpoint: string | null = null, params: string | null = null) => {
    return 'https://id.twitch.tv/oauth2' + (endpoint ? `/${endpoint}` : '') + (params ? `?${params}` : '');
}