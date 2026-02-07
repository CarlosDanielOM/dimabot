import { getDragonflyClient } from './databases/dragonfly.database.js';

type LogDestination = 'cache' | 'console' | 'both';

interface LogOptions {
    destination?: LogDestination;
    platform?: string;
    channelId?: string;
}

interface LogEntry {
    data: any;
    timestamp: string;
    level: string;
    platform?: string;
    channelId?: string;
}

interface LogResponse {
    success: boolean;
    message?: string;
    error?: any;
}

const DEFAULT_TTL = 60 * 60 * 24 * 7;
const DEFAULT_PLATFORM = 'twitch';
const DEFAULT_DESTINATION: LogDestination = 'both';

function formatTimestamp(): string {
    return new Date().toLocaleString('en-US', { timeZone: 'UTC' });
}

function generateLogId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 6);
    return `${timestamp}-${random}`;
}

function logToConsole(level: string, entry: LogEntry): void {
    const output = {
        level,
        timestamp: entry.timestamp,
        platform: entry.platform,
        channelId: entry.channelId,
        data: entry.data
    };

    switch (level) {
        case 'trace':
        case 'debug':
        case 'info':
            console.log(output);
            break;
        case 'warn':
            console.warn(output);
            break;
        case 'error':
        case 'fatal':
            console.error(output);
            break;
        default:
            console.log(output);
    }
}

async function logToCache(entry: LogEntry): Promise<LogResponse> {
    try {
        const client = await getDragonflyClient('logger');
        
        const platform = entry.platform || DEFAULT_PLATFORM;
        const channelId = entry.channelId || 'global';
        const level = entry.level;
        const logId = generateLogId();
        
        const key = `logger:${platform}:${channelId}:${level}:${logId}`;
        const value = JSON.stringify(entry);
        
        await client.set(key, value);
        await client.expire(key, DEFAULT_TTL);
        
        return {
            success: true,
            message: 'Logged to cache successfully'
        };
    } catch (error) {
        console.error('Error logging to cache:', error);
        return {
            success: false,
            error
        };
    }
}

async function log(level: string, data: any, options?: LogOptions): Promise<LogResponse> {
    const destination = options?.destination || DEFAULT_DESTINATION;
    const platform = options?.platform || DEFAULT_PLATFORM;
    const channelId = options?.channelId;

    const entry: LogEntry = {
        data,
        timestamp: formatTimestamp(),
        level,
        platform,
        channelId
    };

    let cacheResult: LogResponse = { success: true };
    let consoleResult: LogResponse = { success: true };

    if (destination === 'cache' || destination === 'both') {
        cacheResult = await logToCache(entry);
    }

    if (destination === 'console' || destination === 'both') {
        try {
            logToConsole(level, entry);
        } catch (error) {
            consoleResult = {
                success: false,
                error
            };
        }
    }

    const overallSuccess = cacheResult.success && consoleResult.success;
    const errors = [cacheResult.error, consoleResult.error].filter(Boolean);

    return {
        success: overallSuccess,
        message: overallSuccess ? 'Logged successfully' : 'Partial failure',
        error: errors.length > 0 ? errors : undefined
    };
}

export const trace = (data: any, options?: LogOptions): Promise<LogResponse> => {
    return log('trace', data, options);
};

export const debug = (data: any, options?: LogOptions): Promise<LogResponse> => {
    return log('debug', data, options);
};

export const info = (data: any, options?: LogOptions): Promise<LogResponse> => {
    return log('info', data, options);
};

export const warn = (data: any, options?: LogOptions): Promise<LogResponse> => {
    return log('warn', data, options);
};

export const error = (data: any, options?: LogOptions): Promise<LogResponse> => {
    return log('error', data, options);
};

export const fatal = (data: any, options?: LogOptions): Promise<LogResponse> => {
    return log('fatal', data, options);
};
