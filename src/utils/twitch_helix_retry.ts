import { error as logError, warn as logWarn } from './logger.js';
import { getTwitchAppHeader, getTwitchBotHeader, getTwitchStreamerHeaderById } from './header.js';
import { cacheOAuthAPIFailure } from './oauth_debug_cache.js';

const DEFAULT_RETRY_DELAYS_MS = [1000, 3000, 5000];

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

interface HelixRetryOptions {
    worker?: string;
    operation?: string;
    context?: Record<string, unknown>;
    retryDelaysMs?: number[];
    executeRequest: () => Promise<Response>;
    onUnauthorized: (attempt: number) => Promise<void>;
    requestUrl?: string;
    requestMethod?: string;
    requestHeaders?: Record<string, string>;
}

async function executeHelixRequestWith401Retry(options: HelixRetryOptions): Promise<Response> {
    const retryDelays = options.retryDelaysMs && options.retryDelaysMs.length > 0
        ? options.retryDelaysMs
        : DEFAULT_RETRY_DELAYS_MS;

    let response = await options.executeRequest();

    for (let retryIndex = 0; response.status === 401 && retryIndex < retryDelays.length; retryIndex += 1) {
        const delayMs = retryDelays[retryIndex];
        const attempt = retryIndex + 1;

        await logWarn({
            worker: options.worker,
            operation: options.operation,
            message: 'Received Twitch 401. Refreshing token and retrying request.',
            attempt,
            maxRetries: retryDelays.length,
            retryInMs: delayMs,
            ...options.context
        }, { destination: 'both' });

        try {
            await options.onUnauthorized(attempt);
        } catch (refreshError) {
            await logError({
                worker: options.worker,
                operation: options.operation,
                message: 'Token refresh hook failed during Twitch 401 retry.',
                attempt,
                error: refreshError instanceof Error ? refreshError.message : String(refreshError),
                stack: refreshError instanceof Error ? refreshError.stack : undefined,
                ...options.context
            }, { destination: 'both' });
        }

        await sleep(delayMs);
        response = await options.executeRequest();
    }

    if (response.status === 401) {
        await logError({
            worker: options.worker,
            operation: options.operation,
            message: 'Twitch 401 persisted after retries. Continuing workflow.',
            retriesAttempted: retryDelays.length,
            ...options.context
        }, { destination: 'both' });

        const clonedResponse = response.clone();
        const responseBody = await clonedResponse.text().catch(() => 'Unable to read response body');
        await cacheOAuthAPIFailure({
            timestamp: new Date().toISOString(),
            endpoint: options.requestUrl ? new URL(options.requestUrl).pathname.split('/').filter(Boolean).slice(-1)[0] || 'unknown' : 'unknown',
            url: options.requestUrl || 'unknown',
            method: options.requestMethod || 'GET',
            headers: options.requestHeaders || {},
            clientId: options.requestHeaders?.['Client-Id'] || process.env.CLIENT_ID || 'unknown',
            responseStatus: response.status,
            responseBody,
            worker: options.worker,
            operation: options.operation,
            channelID: options.context?.channelID as string || undefined,
            context: options.context
        });
    }

    return response;
}

interface HelixAppRetryOptions {
    worker?: string;
    operation?: string;
    context?: Record<string, unknown>;
    retryDelaysMs?: number[];
    executeRequest: (header: Record<string, string>) => Promise<Response>;
    requestUrl?: string;
    requestMethod?: string;
}

interface HelixAppRetryResult {
    error: boolean;
    response?: Response;
    message?: string;
    status?: number;
}

export async function executeHelixAppRequestWith401Retry(options: HelixAppRetryOptions): Promise<HelixAppRetryResult> {
    try {
        let header = await getTwitchAppHeader();

        const response = await executeHelixRequestWith401Retry({
            worker: options.worker,
            operation: options.operation,
            context: options.context,
            retryDelaysMs: options.retryDelaysMs,
            executeRequest: async () => options.executeRequest(header as unknown as Record<string, string>),
            onUnauthorized: async () => {
                header = await getTwitchAppHeader();
            },
            requestUrl: options.requestUrl,
            requestMethod: options.requestMethod,
            requestHeaders: header as unknown as Record<string, string>
        });

        return { error: false, response };
    } catch (error) {
        await logError({
            worker: options.worker,
            operation: options.operation,
            message: 'Failed to get Twitch app header for request.',
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            ...options.context
        }, { destination: 'both' });

        return {
            error: true,
            message: 'Failed to get Twitch app token',
            status: 500
        };
    }
}

interface HelixBotRetryOptions {
    worker?: string;
    operation?: string;
    context?: Record<string, unknown>;
    retryDelaysMs?: number[];
    unauthorizedStatus?: number;
    executeRequest: (header: Record<string, string>) => Promise<Response>;
    requestUrl?: string;
    requestMethod?: string;
}

interface HelixBotRetryResult {
    error: boolean;
    response?: Response;
    message?: string;
    status?: number;
}

export async function executeHelixBotRequestWith401Retry(options: HelixBotRetryOptions): Promise<HelixBotRetryResult> {
    let headerResult = await getTwitchBotHeader();

    if (headerResult.error || !headerResult.header) {
        return {
            error: true,
            message: headerResult.message,
            status: options.unauthorizedStatus || 403
        };
    }

    const response = await executeHelixRequestWith401Retry({
        worker: options.worker,
        operation: options.operation,
        context: options.context,
        retryDelaysMs: options.retryDelaysMs,
        executeRequest: async () => options.executeRequest(headerResult.header as unknown as Record<string, string>),
        onUnauthorized: async () => {
            const refreshedHeader = await getTwitchBotHeader();
            if (!refreshedHeader.error && refreshedHeader.header) {
                headerResult = refreshedHeader;
            }
        },
        requestUrl: options.requestUrl,
        requestMethod: options.requestMethod,
        requestHeaders: headerResult.header as unknown as Record<string, string>
    });

    return { error: false, response };
}

interface HelixStreamerRetryOptions {
    channelID: string;
    worker?: string;
    operation?: string;
    context?: Record<string, unknown>;
    retryDelaysMs?: number[];
    unauthorizedStatus?: number;
    executeRequest: (header: Record<string, string>) => Promise<Response>;
    requestUrl?: string;
    requestMethod?: string;
}

interface HelixStreamerRetryResult {
    error: boolean;
    response?: Response;
    message?: string;
    status?: number;
}

export async function executeHelixStreamerRequestWith401Retry(options: HelixStreamerRetryOptions): Promise<HelixStreamerRetryResult> {
    let headerResult = await getTwitchStreamerHeaderById(options.channelID);

    if (headerResult.error || !headerResult.header) {
        return {
            error: true,
            message: headerResult.message,
            status: options.unauthorizedStatus || 403
        };
    }

    const response = await executeHelixRequestWith401Retry({
        worker: options.worker,
        operation: options.operation,
        context: {
            channelID: options.channelID,
            ...options.context
        },
        retryDelaysMs: options.retryDelaysMs,
        executeRequest: async () => options.executeRequest(headerResult.header as unknown as Record<string, string>),
        onUnauthorized: async () => {
            const refreshedHeader = await getTwitchStreamerHeaderById(options.channelID);
            if (!refreshedHeader.error && refreshedHeader.header) {
                headerResult = refreshedHeader;
                return;
            }
            await logWarn({
                worker: options.worker,
                operation: options.operation,
                message: 'Unable to refresh streamer header during 401 retry.',
                channelID: options.channelID,
                refreshMessage: refreshedHeader.message,
                ...options.context
            }, { destination: 'both' });
        },
        requestUrl: options.requestUrl,
        requestMethod: options.requestMethod,
        requestHeaders: headerResult.header as unknown as Record<string, string>
    });

    return { error: false, response };
}

export { executeHelixRequestWith401Retry };
