import TwitchStreamers from '../classes/twitch_streamers.class.js';
import { CustomTimerSchema, type ICustomTimer } from '../schemas/custom_timer.schema.js';
import { getDragonflyClient } from '../utils/databases/dragonfly.database.js';

const MAX_NAME_LENGTH = 30;
const MAX_MESSAGE_LENGTH = 350;
const NAME_PATTERN = /^[\w]+$/;

interface ITimerCommandResult {
    error: boolean;
    message: string;
    status: number;
    timer?: unknown;
    timers?: unknown[];
}

function getTierFrequencyLimits(tier: string): { min: number; max: number } {
    switch (tier) {
        case 'pro':
            return { min: 1, max: 288 };
        case 'premium':
            return { min: 1, max: 72 };
        case 'free':
        default:
            return { min: 1, max: 12 };
    }
}

function getTierTimerLimit(tier: string): number {
    switch (tier) {
        case 'pro':
            return 50;
        case 'premium':
            return 15;
        case 'free':
        default:
            return 5;
    }
}

function frequencyToMinutes(frequency: number): number {
    return frequency * 5;
}

function validateName(name: string): { valid: boolean; error?: string } {
    if (!name || name.length === 0) {
        return { valid: false, error: 'Timer name is required' };
    }
    if (name.length > MAX_NAME_LENGTH) {
        return { valid: false, error: `Timer name cannot exceed ${MAX_NAME_LENGTH} characters` };
    }
    if (!NAME_PATTERN.test(name)) {
        return { valid: false, error: 'Timer name can only contain letters, numbers, and underscores' };
    }
    return { valid: true };
}

function validateMessage(message: string): { valid: boolean; error?: string } {
    if (!message || message.length === 0) {
        return { valid: false, error: 'Timer message is required' };
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
        return { valid: false, error: `Timer message cannot exceed ${MAX_MESSAGE_LENGTH} characters` };
    }
    return { valid: true };
}

function validateFrequency(frequency: number, tier: string): { valid: boolean; error?: string } {
    const limits = getTierFrequencyLimits(tier);
    if (!Number.isInteger(frequency)) {
        return { valid: false, error: 'Frequency must be a whole number' };
    }
    if (frequency < limits.min) {
        return { valid: false, error: `Minimum frequency is ${limits.min} (${frequencyToMinutes(limits.min)} minutes)` };
    }
    if (frequency > limits.max) {
        const maxMinutes = frequencyToMinutes(limits.max);
        return { valid: false, error: `Your plan allows a maximum of ${limits.max} (${maxMinutes} minutes). Upgrade for longer intervals.` };
    }
    return { valid: true };
}

async function checkTimerLimit(channelID: string, tier: string): Promise<{ allowed: boolean; count: number; limit: number }> {
    const limit = getTierTimerLimit(tier);
    const count = await CustomTimerSchema.countDocuments({ channelID, active: true });
    return { allowed: count < limit, count, limit };
}

export async function createTimer(channelID: string, name: string, frequency: number, message: string): Promise<ITimerCommandResult> {
    try {
        const streamer = await TwitchStreamers.getTwitchAccountById(channelID);
        if (!streamer) {
            return { error: true, message: 'Streamer not found', status: 404 };
        }

        const tier = streamer.plan_tier || 'free';

        const nameValidation = validateName(name);
        if (!nameValidation.valid) {
            return { error: true, message: String(nameValidation.error), status: 400 };
        }

        const frequencyValidation = validateFrequency(frequency, tier);
        if (!frequencyValidation.valid) {
            return { error: true, message: String(frequencyValidation.error), status: 400 };
        }

        const messageValidation = validateMessage(message);
        if (!messageValidation.valid) {
            return { error: true, message: String(messageValidation.error), status: 400 };
        }

        const existingTimer = await CustomTimerSchema.findOne({ channelID, name: name.toLowerCase() });
        if (existingTimer) {
            return { error: true, message: `Timer "${name}" already exists`, status: 409 };
        }

        const limitCheck = await checkTimerLimit(channelID, tier);
        if (!limitCheck.allowed) {
            return {
                error: true,
                message: `Timer limit reached (${limitCheck.limit} for ${tier} plan). Upgrade for more timers.`,
                status: 403
            };
        }

        const timer = await CustomTimerSchema.create({
            name: name.toLowerCase(),
            message,
            frequency,
            channel: streamer.name,
            channelID,
            active: true
        });

        const cache = await getDragonflyClient('timerManager');
        const isLive = await cache.sIsMember('timer:active', channelID);
        if (isLive) {
            await cache.hSet(`timer:channel:${channelID}:timers`, String(timer._id), JSON.stringify(timer.toObject()));
            await cache.set(`timer:channel:${channelID}:heartbeat:${timer._id}`, '0');
        }

        const minutes = frequencyToMinutes(frequency);
        return {
            error: false,
            message: `Timer "${name}" created. Will send every ${minutes} minute${minutes !== 1 ? 's' : ''} when live.`,
            timer: timer.toObject(),
            status: 201
        };
    } catch (error) {
        console.error('Error in createTimer:', {
            channelID,
            name,
            frequency,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
        return { error: true, message: 'Failed to create timer', status: 500 };
    }
}

export async function editTimer(channelID: string, name: string, frequency?: number, message?: string): Promise<ITimerCommandResult> {
    try {
        const streamer = await TwitchStreamers.getTwitchAccountById(channelID);
        if (!streamer) {
            return { error: true, message: 'Streamer not found', status: 404 };
        }

        const tier = streamer.plan_tier || 'free';
        const timer = await CustomTimerSchema.findOne({ channelID, name: name.toLowerCase() });
        if (!timer) {
            return { error: true, message: `Timer "${name}" not found`, status: 404 };
        }

        if (frequency !== undefined) {
            const frequencyValidation = validateFrequency(frequency, tier);
            if (!frequencyValidation.valid) {
                return { error: true, message: String(frequencyValidation.error), status: 400 };
            }
            timer.frequency = frequency;
        }

        if (message !== undefined) {
            const messageValidation = validateMessage(message);
            if (!messageValidation.valid) {
                return { error: true, message: String(messageValidation.error), status: 400 };
            }
            timer.message = message;
        }

        await timer.save();

        const cache = await getDragonflyClient('timerManager');
        const isLive = await cache.sIsMember('timer:active', channelID);
        if (isLive && timer.active) {
            await cache.hSet(`timer:channel:${channelID}:timers`, String(timer._id), JSON.stringify(timer.toObject()));
        }

        const minutes = frequencyToMinutes(timer.frequency);
        return {
            error: false,
            message: `Timer "${name}" updated. Sends every ${minutes} minute${minutes !== 1 ? 's' : ''} when live.`,
            timer: timer.toObject(),
            status: 200
        };
    } catch (error) {
        console.error('Error in editTimer:', {
            channelID,
            name,
            frequency,
            message,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
        return { error: true, message: 'Failed to edit timer', status: 500 };
    }
}

export async function deleteTimer(channelID: string, name: string): Promise<ITimerCommandResult> {
    try {
        const timer = await CustomTimerSchema.findOneAndDelete({ channelID, name: name.toLowerCase() });
        if (!timer) {
            return { error: true, message: `Timer "${name}" not found`, status: 404 };
        }

        const cache = await getDragonflyClient('timerManager');
        await cache.hDel(`timer:channel:${channelID}:timers`, String(timer._id));
        await cache.del(`timer:channel:${channelID}:heartbeat:${timer._id}`);

        return {
            error: false,
            message: `Timer "${name}" deleted`,
            timer: timer.toObject(),
            status: 200
        };
    } catch (error) {
        console.error('Error in deleteTimer:', {
            channelID,
            name,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
        return { error: true, message: 'Failed to delete timer', status: 500 };
    }
}

export async function toggleTimer(channelID: string, name: string, active?: boolean): Promise<ITimerCommandResult> {
    try {
        const timer = await CustomTimerSchema.findOne({ channelID, name: name.toLowerCase() });
        if (!timer) {
            return { error: true, message: `Timer "${name}" not found`, status: 404 };
        }

        timer.active = active !== undefined ? active : !timer.active;
        await timer.save();

        const cache = await getDragonflyClient('timerManager');
        const isLive = await cache.sIsMember('timer:active', channelID);
        if (isLive) {
            if (timer.active) {
                await cache.hSet(`timer:channel:${channelID}:timers`, String(timer._id), JSON.stringify(timer.toObject()));
                await cache.set(`timer:channel:${channelID}:heartbeat:${timer._id}`, '0');
            } else {
                await cache.hDel(`timer:channel:${channelID}:timers`, String(timer._id));
                await cache.del(`timer:channel:${channelID}:heartbeat:${timer._id}`);
            }
        }

        return {
            error: false,
            message: `Timer "${name}" ${timer.active ? 'enabled' : 'disabled'}`,
            timer: timer.toObject(),
            status: 200
        };
    } catch (error) {
        console.error('Error in toggleTimer:', {
            channelID,
            name,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
        return { error: true, message: 'Failed to toggle timer', status: 500 };
    }
}

export async function listTimers(channelID: string): Promise<ITimerCommandResult> {
    try {
        const timers = await CustomTimerSchema.find({ channelID }).sort({ name: 1 }).lean();

        if (timers.length === 0) {
            return {
                error: false,
                message: 'No timers configured',
                timers: [],
                status: 200
            };
        }

        const timerList = timers.map((t) => ({
            name: t.name,
            frequency: t.frequency,
            minutes: frequencyToMinutes(t.frequency),
            message: t.message.length > 50 ? t.message.substring(0, 47) + '...' : t.message,
            active: t.active
        }));

        const summary = timerList
            .map((t) => `${t.active ? '✓' : '✗'} ${t.name}: ${t.minutes}min - "${t.message}"`)
            .join(' | ');

        return {
            error: false,
            message: `Timers (${timers.length}): ${summary}`,
            timers,
            status: 200
        };
    } catch (error) {
        console.error('Error in listTimers:', {
            channelID,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
        return { error: true, message: 'Failed to list timers', status: 500 };
    }
}

export async function getTimer(channelID: string, name: string): Promise<ITimerCommandResult> {
    try {
        const timer = await CustomTimerSchema.findOne({ channelID, name: name.toLowerCase() }).lean();
        if (!timer) {
            return { error: true, message: `Timer "${name}" not found`, status: 404 };
        }

        return {
            error: false,
            message: 'Timer found',
            timer,
            status: 200
        };
    } catch (error) {
        console.error('Error in getTimer:', {
            channelID,
            name,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
        return { error: true, message: 'Failed to get timer', status: 500 };
    }
}

export type { ICustomTimer };
