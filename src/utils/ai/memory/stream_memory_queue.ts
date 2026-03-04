import { enqueueCronJob, getCronJobDedupeKey } from '../../cron_jobs_queue.js';

export const STREAM_MEMORY_QUEUE_KEY = 'cron:stream-memory:queue';
export const STREAM_MEMORY_DEAD_LETTER_KEY = 'cron:stream-memory:dead-letter';
export const STREAM_MEMORY_SUMMARY_JOB = 'stream-memory-summary';
export const STREAM_MEMORY_WEEKLY_JOB = 'memory-maintenance-weekly';
export const STREAM_MEMORY_MONTHLY_JOB = 'memory-maintenance-monthly';

const DEFAULT_SUMMARY_DEDUPE_SECONDS = Math.max(60, Number(process.env.STREAM_MEMORY_SUMMARY_DEDUPE_SECONDS || 12 * 60 * 60));
const DEFAULT_WEEKLY_DEDUPE_SECONDS = Math.max(60, Number(process.env.STREAM_MEMORY_WEEKLY_DEDUPE_SECONDS || 7 * 24 * 60 * 60));
const DEFAULT_MONTHLY_DEDUPE_SECONDS = Math.max(60, Number(process.env.STREAM_MEMORY_MONTHLY_DEDUPE_SECONDS || 31 * 24 * 60 * 60));

function normalizeValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function pad2(value: number): string {
    return String(value).padStart(2, '0');
}

function getIsoWeek(now: Date): { year: number; week: number } {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return { year: date.getUTCFullYear(), week };
}

export function getStreamMemorySummaryDedupeKey(channelID: string, sessionID?: string, streamID?: string): string {
    const token = [
        'stream-memory-summary',
        normalizeValue(channelID),
        normalizeValue(sessionID),
        normalizeValue(streamID)
    ].filter(Boolean).join(':');
    return getCronJobDedupeKey(token);
}

export function getWeeklyMaintenancePeriodToken(now: Date = new Date()): string {
    const { year, week } = getIsoWeek(now);
    return `${year}-W${pad2(week)}`;
}

export function getMonthlyMaintenancePeriodToken(now: Date = new Date()): string {
    return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}`;
}

export function getMaintenanceDedupeKey(channelID: string, cadence: 'weekly' | 'monthly', periodToken: string): string {
    const token = `stream-memory-${cadence}:${normalizeValue(channelID)}:${normalizeValue(periodToken)}`;
    return getCronJobDedupeKey(token);
}

export interface IEnqueueStreamMemorySummaryJobInput {
    channelID: string;
    sessionID?: string;
    streamID?: string;
    reason?: string;
    source?: string;
    notBeforeUnix?: number;
    requestedBy?: string;
}

export interface IEnqueueJobResult {
    enqueued: boolean;
    message: string;
    dedupeKey: string;
    job?: {
        id: string;
        job: string;
        requestedAt: string;
        requestedBy?: string;
        channelID?: string;
        accountID?: string;
        dedupeKey?: string;
        data?: Record<string, unknown>;
    };
}

export async function enqueueStreamMemorySummaryJob(input: IEnqueueStreamMemorySummaryJobInput): Promise<IEnqueueJobResult> {
    const channelID = normalizeValue(input.channelID);
    const sessionID = normalizeValue(input.sessionID);
    const streamID = normalizeValue(input.streamID);
    const reason = normalizeValue(input.reason) || 'stream_offline';
    const source = input.source || 'stream_offline';
    if (!channelID) {
        return {
            enqueued: false,
            message: 'Invalid channel ID',
            dedupeKey: ''
        };
    }
    const dedupeToken = [
        'stream-memory-summary',
        channelID,
        sessionID,
        streamID
    ].filter(Boolean).join(':');
    const enqueueResult = await enqueueCronJob({
        job: STREAM_MEMORY_SUMMARY_JOB,
        queueKey: STREAM_MEMORY_QUEUE_KEY,
        requestedBy: normalizeValue(input.requestedBy) || undefined,
        channelID,
        accountID: channelID,
        dedupeToken,
        dedupeSeconds: DEFAULT_SUMMARY_DEDUPE_SECONDS,
        data: {
            reason,
            source,
            sessionID,
            streamID,
            notBeforeUnix: Number(input.notBeforeUnix || 0)
        }
    });
    return {
        enqueued: enqueueResult.enqueued,
        message: enqueueResult.message,
        dedupeKey: enqueueResult.job.dedupeKey || getCronJobDedupeKey(dedupeToken),
        job: enqueueResult.job
    };
}

export interface IEnqueueMemoryMaintenanceJobInput {
    channelID: string;
    cadence: 'weekly' | 'monthly';
    periodToken?: string;
    reason?: string;
    requestedBy?: string;
}

export async function enqueueMemoryMaintenanceJob(input: IEnqueueMemoryMaintenanceJobInput): Promise<IEnqueueJobResult> {
    const channelID = normalizeValue(input.channelID);
    const cadence = input.cadence;
    const reason = normalizeValue(input.reason) || `${cadence}_maintenance`;
    if (!channelID) {
        return {
            enqueued: false,
            message: 'Invalid channel ID',
            dedupeKey: ''
        };
    }
    const periodToken = normalizeValue(input.periodToken)
        || (cadence === 'weekly' ? getWeeklyMaintenancePeriodToken() : getMonthlyMaintenancePeriodToken());
    const job = cadence === 'weekly' ? STREAM_MEMORY_WEEKLY_JOB : STREAM_MEMORY_MONTHLY_JOB;
    const dedupeToken = `stream-memory-${cadence}:${channelID}:${periodToken}`;
    const enqueueResult = await enqueueCronJob({
        job,
        queueKey: STREAM_MEMORY_QUEUE_KEY,
        requestedBy: normalizeValue(input.requestedBy) || undefined,
        channelID,
        accountID: channelID,
        dedupeToken,
        dedupeSeconds: cadence === 'weekly' ? DEFAULT_WEEKLY_DEDUPE_SECONDS : DEFAULT_MONTHLY_DEDUPE_SECONDS,
        data: {
            cadence,
            periodToken,
            reason,
            source: cadence === 'weekly' ? 'weekly_maintenance' : 'monthly_maintenance'
        }
    });
    return {
        enqueued: enqueueResult.enqueued,
        message: enqueueResult.message,
        dedupeKey: enqueueResult.job.dedupeKey || getCronJobDedupeKey(dedupeToken),
        job: enqueueResult.job
    };
}
