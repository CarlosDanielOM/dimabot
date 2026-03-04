import { randomUUID } from 'node:crypto';
import { getDragonflyClient } from './databases/dragonfly.database.js';

export const CRON_JOBS_QUEUE_KEY = 'cron:jobs:queue';
export const CRON_JOBS_DEAD_LETTER_KEY = 'cron:jobs:dead-letter';
export const CRON_JOBS_DEDUPE_PREFIX = 'cron:jobs:dedupe';

const DEFAULT_DEDUPE_SECONDS = Math.max(60, Number(process.env.CRON_JOBS_DEDUPE_SECONDS || 900));

export interface CronQueueJob {
    id: string;
    job: string;
    requestedAt: string;
    requestedBy?: string;
    userID?: string;
    accountID?: string;
    channelID?: string;
    data?: Record<string, unknown>;
    dedupeKey?: string;
}

export interface EnqueueCronJobInput {
    job: string;
    requestedBy?: string;
    userID?: string;
    accountID?: string;
    channelID?: string;
    data?: Record<string, unknown>;
    dedupeToken?: string;
    dedupeSeconds?: number;
    queueKey?: string;
}

export interface EnqueueCronJobResult {
    enqueued: boolean;
    message: string;
    job: CronQueueJob;
}

function normalizeValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function buildDefaultDedupeToken(input: EnqueueCronJobInput): string {
    return [
        normalizeValue(input.job),
        normalizeValue(input.channelID),
        normalizeValue(input.userID),
        normalizeValue(input.accountID)
    ].filter((value) => value.length > 0).join(':');
}

export function getCronJobDedupeKey(token: string): string {
    const normalizedToken = normalizeValue(token);
    return `${CRON_JOBS_DEDUPE_PREFIX}:${normalizedToken}`;
}

export function serializeCronQueueJob(job: CronQueueJob): string {
    return JSON.stringify(job);
}

export function parseCronQueueJob(payload: string): CronQueueJob | null {
    try {
        const parsed = JSON.parse(payload) as Partial<CronQueueJob>;
        const job = normalizeValue(parsed.job);
        if (!job) {
            return null;
        }
        return {
            id: normalizeValue(parsed.id) || randomUUID(),
            job,
            requestedAt: normalizeValue(parsed.requestedAt) || new Date().toISOString(),
            requestedBy: normalizeValue(parsed.requestedBy) || undefined,
            userID: normalizeValue(parsed.userID) || undefined,
            accountID: normalizeValue(parsed.accountID) || undefined,
            channelID: normalizeValue(parsed.channelID) || undefined,
            data: parsed.data && typeof parsed.data === 'object' ? parsed.data : undefined,
            dedupeKey: normalizeValue(parsed.dedupeKey) || undefined
        };
    } catch {
        return null;
    }
}

export async function enqueueCronJob(input: EnqueueCronJobInput): Promise<EnqueueCronJobResult> {
    const normalizedJob = normalizeValue(input.job);
    if (!normalizedJob) {
        return {
            enqueued: false,
            message: 'Invalid cron job name',
            job: {
                id: randomUUID(),
                job: '',
                requestedAt: new Date().toISOString()
            }
        };
    }

    const job: CronQueueJob = {
        id: randomUUID(),
        job: normalizedJob,
        requestedAt: new Date().toISOString(),
        requestedBy: normalizeValue(input.requestedBy) || undefined,
        userID: normalizeValue(input.userID) || undefined,
        accountID: normalizeValue(input.accountID) || undefined,
        channelID: normalizeValue(input.channelID) || undefined,
        data: input.data
    };

    const dedupeToken = normalizeValue(input.dedupeToken) || buildDefaultDedupeToken(input);
    const dedupeSeconds = Math.max(60, Number(input.dedupeSeconds || DEFAULT_DEDUPE_SECONDS));
    const queueKey = normalizeValue(input.queueKey) || CRON_JOBS_QUEUE_KEY;

    const client = await getDragonflyClient('CronJobsQueue');

    if (dedupeToken) {
        const dedupeKey = getCronJobDedupeKey(dedupeToken);
        const dedupeResult = await client.set(dedupeKey, '1', {
            NX: true,
            EX: dedupeSeconds
        });
        if (dedupeResult !== 'OK') {
            job.dedupeKey = dedupeKey;
            return {
                enqueued: false,
                message: 'Cron job already queued recently',
                job
            };
        }
        job.dedupeKey = dedupeKey;
    }

    await client.lPush(queueKey, serializeCronQueueJob(job));
    return {
        enqueued: true,
        message: 'Cron job queued',
        job
    };
}

export async function clearCronJobDedupeByKey(dedupeKey?: string): Promise<void> {
    const key = normalizeValue(dedupeKey);
    if (!key) {
        return;
    }
    const client = await getDragonflyClient('CronJobsQueue');
    await client.del(key);
}
