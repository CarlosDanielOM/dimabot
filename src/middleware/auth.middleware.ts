import type { NextFunction, Request, Response } from 'express';
import { getDragonflyClient } from '../utils/databases/dragonfly.database.js';
import type {
    AuthRequest,
    AuthenticatedUser,
    CachedTokenData,
    ErrorResponse,
    TwitchTokenValidation,
    TwitchUsersResponse
} from './types.js';
import { error } from '../utils/logger.js';
import UsersSchema from '../schemas/users.schema.js';

const CACHE_KEY_PREFIX = 'token:';
const CACHE_TTL = 14000;
const TWITCH_VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
const TWITCH_USERS_URL = 'https://api.twitch.tv/helix/users';
const ACTIVITY_TOUCH_TTL = 60 * 60 * 24;

async function touchLastAppActivity(twitchUserId: string): Promise<void> {
    if (!twitchUserId) return;

    try {
        const cache = await getDragonflyClient('AuthMiddleware activity');
        const cacheKey = `twitch:${twitchUserId}:last_app_activity_touch`;
        const isRecentlyTouched = await cache.exists(cacheKey);

        if (isRecentlyTouched === 1) {
            return;
        }

        await UsersSchema.updateOne(
            {
                'accounts.id': twitchUserId,
                'accounts.type': 'twitch'
            },
            {
                $set: {
                    last_app_activity_at: new Date()
                }
            }
        );

        await cache.set(cacheKey, '1');
        await cache.expire(cacheKey, ACTIVITY_TOUCH_TTL);
    } catch (err) {
        await error({
            function: 'touchLastAppActivity',
            twitchUserId,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
        }, { destination: 'both' });
    }
}

async function validateTwitchToken(token: string): Promise<{ valid: boolean; validation?: TwitchTokenValidation; error?: string }> {
    try {
        const response = await fetch(TWITCH_VALIDATE_URL, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.status === 401) {
            return { valid: false, error: 'Invalid token' };
        }

        const validation = await response.json() as TwitchTokenValidation;
        return { valid: true, validation };
    } catch (err) {
        await error({
            function: 'validateTwitchToken',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
        }, { destination: 'both' });
        return { valid: false, error: 'Failed to validate token' };
    }
}

async function getUserFromToken(token: string): Promise<{ user?: AuthenticatedUser; error?: string }> {
    try {
        const response = await fetch(TWITCH_USERS_URL, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Client-Id': process.env.CLIENT_ID!
            }
        });

        if (!response.ok) {
            return { error: 'Invalid token or user not found' };
        }

        const data = await response.json() as TwitchUsersResponse;

        if (!data.data || data.data.length === 0) {
            return { error: 'User not found' };
        }

        const twitchUser = data.data[0];
        const user: AuthenticatedUser = {
            id: twitchUser.id,
            login: twitchUser.login,
            display_name: twitchUser.display_name,
            profile_image_url: twitchUser.profile_image_url
        };

        return { user };
    } catch (err) {
        await error({
            function: 'getUserFromToken',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
        }, { destination: 'both' });
        return { error: 'Failed to fetch user data' };
    }
}

async function isTokenCached(token: string): Promise<boolean> {
    try {
        const cache = await getDragonflyClient('AuthMiddleware');
        const cacheKey = `${CACHE_KEY_PREFIX}${token}`;
        const exists = await cache.exists(cacheKey);
        return exists === 1;
    } catch (err) {
        await error({
            function: 'isTokenCached',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
        }, { destination: 'both' });
        return false;
    }
}

async function getCachedToken(token: string): Promise<AuthenticatedUser | null> {
    try {
        const cache = await getDragonflyClient('AuthMiddleware');
        const cacheKey = `${CACHE_KEY_PREFIX}${token}`;
        const data = await cache.hGetAll(cacheKey);

        if (!data || !data.id) {
            return null;
        }

        return {
            id: data.id,
            login: data.login,
            display_name: data.display_name,
            profile_image_url: data.profile_image_url
        };
    } catch (err) {
        await error({
            function: 'getCachedToken',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
        }, { destination: 'both' });
        return null;
    }
}

async function cacheToken(token: string, user: AuthenticatedUser): Promise<void> {
    try {
        const cache = await getDragonflyClient('AuthMiddleware');
        const cacheKey = `${CACHE_KEY_PREFIX}${token}`;

        await cache.hSet(cacheKey, {
            id: user.id,
            login: user.login,
            display_name: user.display_name,
            profile_image_url: user.profile_image_url || ''
        });

        await cache.expire(cacheKey, CACHE_TTL);
    } catch (err) {
        await error({
            function: 'cacheToken',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
        }, { destination: 'both' });
    }
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
        const headers = req.headers as unknown as Record<string, string | string[] | undefined>;
        const authHeader = headers['authorization'] || headers['Authorization'];

        if (!authHeader || typeof authHeader !== 'string') {
            res.status(401).json({
                error: true,
                message: 'No token provided',
                status: 401,
                type: 'no_token'
            });
            return;
        }

        let token = authHeader;

        if (token.startsWith('Bearer ')) {
            token = token.slice(7);
        }

        if (!token) {
            res.status(401).json({
                error: true,
                message: 'No token provided',
                status: 401,
                type: 'no_token'
            });
            return;
        }

        const cachedUser = await getCachedToken(token);
        if (cachedUser) {
            req.user = cachedUser;
            await touchLastAppActivity(cachedUser.id);
            next();
            return;
        }

        const validation = await validateTwitchToken(token);
        if (!validation.valid || !validation.validation) {
            res.status(401).json({
                error: true,
                message: validation.error || 'Invalid token',
                status: 401,
                type: 'invalid_token'
            });
            return;
        }

        const userResult = await getUserFromToken(token);
        if (userResult.error) {
            res.status(401).json({
                error: true,
                message: userResult.error,
                status: 401,
                type: 'user_fetch_failed'
            });
            return;
        }

        if (userResult.user) {
            await cacheToken(token, userResult.user);
            req.user = userResult.user;
            await touchLastAppActivity(userResult.user.id);
            next();
        }
    } catch (err) {
        await error({
            function: 'authMiddleware',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
        }, { destination: 'both' });

        res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500,
            type: 'internal_error'
        });
    }
}
