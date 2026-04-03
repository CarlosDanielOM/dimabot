/**
 * AI Fetch Utilities - Timeout and Retry Logic
 * 
 * Provides a modular fetch wrapper with configurable timeout and exponential backoff retry.
 * Supports OpenRouter, MiniMax, and other AI API clients.
 */

export interface RetryOptions {
    retries: number;
    delays: number[];
    timeout: number;
    retryOn: number[];
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
    retries: 3,
    delays: [1000, 3000, 5000],
    timeout: 30000,
    retryOn: [429, 500, 502, 503, 504]
};

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function createFetchWithRetry(options: Partial<RetryOptions>) {
    const opts: RetryOptions = {
        retries: options.retries ?? DEFAULT_RETRY_OPTIONS.retries,
        delays: options.delays ?? DEFAULT_RETRY_OPTIONS.delays,
        timeout: options.timeout ?? DEFAULT_RETRY_OPTIONS.timeout,
        retryOn: options.retryOn ?? DEFAULT_RETRY_OPTIONS.retryOn
    };

    return async function fetchWithRetry(
        url: string,
        init?: RequestInit
    ): Promise<Response> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= opts.retries; attempt++) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), opts.timeout);

            try {
                const response = await fetch(url, {
                    ...init,
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (attempt === opts.retries || !opts.retryOn.includes(response.status)) {
                    return response;
                }

                const delay = opts.delays[attempt] ?? opts.delays[opts.delays.length - 1];
                await sleep(delay);

            } catch (err) {
                clearTimeout(timeoutId);
                lastError = err as Error;

                if (err instanceof DOMException && err.name === 'AbortError') {
                    throw new Error(`Request timed out after ${opts.timeout}ms`);
                }

                if (attempt < opts.retries) {
                    const delay = opts.delays[attempt] ?? opts.delays[opts.delays.length - 1];
                    await sleep(delay);
                }
            }
        }

        throw lastError ?? new Error('Request failed after retries');
    };
}
