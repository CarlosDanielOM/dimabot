import { getDragonflyClient } from './databases/dragonfly.database.js';

const OAUTH_API_FAILURE_PREFIX = 'oauth:failures:api:';
const OAUTH_TOKEN_REFRESH_FAILURE_PREFIX = 'oauth:failures:token_refresh:';
const CACHE_TTL_SECONDS = 86400;

export interface OAuthAPIFailureData {
  timestamp: string;
  endpoint: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  clientId: string;
  responseStatus: number;
  responseBody: string;
  worker?: string;
  operation?: string;
  channelID?: string;
  context?: Record<string, unknown>;
}

export interface OAuthTokenRefreshFailureData {
  timestamp: string;
  userID: string;
  refreshTokenPrefix: string;
  failureKind: 'permanent_failure' | 'transient_failure';
  failureReason: string;
  status: number;
  responseBody: string;
  endpoint: string;
  url: string;
}

function sanitizeAuthorizationHeader(headerValue: string): string {
  if (headerValue.startsWith('Bearer ')) {
    return `Bearer <token_length:${headerValue.slice(7).length}>`;
  }
  return headerValue;
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'authorization') {
      sanitized[key] = sanitizeAuthorizationHeader(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function extractEndpointFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    if (pathParts.includes('helix')) {
      const helixIndex = pathParts.indexOf('helix');
      return pathParts.slice(helixIndex + 1).join('/') || 'unknown';
    }
    return pathParts.join('/') || 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function cacheOAuthAPIFailure(failure: OAuthAPIFailureData): Promise<void> {
  try {
    const cache = await getDragonflyClient('OAuthDebug');

    const sanitizedHeaders = sanitizeHeaders(failure.headers);

    const cacheValue: OAuthAPIFailureData = {
      ...failure,
      headers: sanitizedHeaders,
      endpoint: failure.endpoint || extractEndpointFromUrl(failure.url)
    };

    const key = `${OAUTH_API_FAILURE_PREFIX}${Date.now()}`;
    await cache.set(key, JSON.stringify(cacheValue), { EX: CACHE_TTL_SECONDS });
  } catch (error) {
    console.error('Failed to cache OAuth API failure:', error instanceof Error ? error.message : String(error));
  }
}

export async function cacheOAuthTokenRefreshFailure(failure: OAuthTokenRefreshFailureData): Promise<void> {
  try {
    const cache = await getDragonflyClient('OAuthDebug');

    const sanitizedFailure: OAuthTokenRefreshFailureData = {
      ...failure,
      refreshTokenPrefix: failure.refreshTokenPrefix.slice(0, 8)
    };

    const key = `${OAUTH_TOKEN_REFRESH_FAILURE_PREFIX}${Date.now()}`;
    await cache.set(key, JSON.stringify(sanitizedFailure), { EX: CACHE_TTL_SECONDS });
  } catch (error) {
    console.error('Failed to cache OAuth token refresh failure:', error instanceof Error ? error.message : String(error));
  }
}
