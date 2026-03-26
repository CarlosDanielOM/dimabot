import type { Request } from 'express';

export interface AuthenticatedUser {
    id: string;
    login: string;
    display_name: string;
    profile_image_url?: string;
}

export interface AuthRequest extends Request {
    user?: AuthenticatedUser;
}

export interface TwitchTokenValidation {
    client_id: string;
    login: string;
    scopes: string[];
    user_id: string;
    expires_in: number;
}

export interface TwitchUser {
    id: string;
    login: string;
    display_name: string;
    profile_image_url: string;
    type: string;
    broadcaster_type: string;
    created_at: string;
}

export interface TwitchUsersResponse {
    data: TwitchUser[];
}

export interface CachedTokenData extends AuthenticatedUser {
    cached_at: number;
}

export interface ErrorResponse {
    error: true;
    message: string;
    status: number;
    type: string;
}
