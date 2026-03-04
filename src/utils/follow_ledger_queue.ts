import { enqueueCronJob, getCronJobDedupeKey } from './cron_jobs_queue.js';

export const FOLLOW_LEDGER_JOB_NAME = 'follow-ledger-sync';
export const FOLLOW_LEDGER_QUEUE_DEDUPE_PREFIX = 'follow-ledger-sync';

const FOLLOW_LEDGER_QUEUE_DEDUPE_SECONDS = Math.max(60, Number(process.env.FOLLOW_LEDGER_QUEUE_DEDUPE_SECONDS || 900));

function normalizeValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export function getFollowLedgerDedupeKey(channelID: string): string {
    return getCronJobDedupeKey(`${FOLLOW_LEDGER_QUEUE_DEDUPE_PREFIX}:${normalizeValue(channelID)}`);
}

export interface EnqueueFollowLedgerSyncJobResult {
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
        data?: Record<string, unknown>;
        dedupeKey?: string;
    };
}

export async function enqueueFollowLedgerSyncJob(
    channelID: string,
    reason?: string,
    requestedBy?: string
): Promise<EnqueueFollowLedgerSyncJobResult> {
    const normalizedChannelID = normalizeValue(channelID);
    const normalizedReason = normalizeValue(reason) || 'manual_request';

    if (!normalizedChannelID) {
        return {
            enqueued: false,
            message: 'Invalid channel ID',
            dedupeKey: ''
        };
    }

    const dedupeKey = getFollowLedgerDedupeKey(normalizedChannelID);

    const enqueueResult = await enqueueCronJob({
        job: FOLLOW_LEDGER_JOB_NAME,
        channelID: normalizedChannelID,
        accountID: normalizedChannelID,
        requestedBy,
        dedupeSeconds: FOLLOW_LEDGER_QUEUE_DEDUPE_SECONDS,
        dedupeToken: `${FOLLOW_LEDGER_QUEUE_DEDUPE_PREFIX}:${normalizedChannelID}`,
        data: {
            reason: normalizedReason,
            type: FOLLOW_LEDGER_JOB_NAME
        }
    });

    if (!enqueueResult.enqueued) {
        return {
            enqueued: false,
            message: enqueueResult.message,
            dedupeKey: enqueueResult.job.dedupeKey || dedupeKey,
            job: enqueueResult.job
        };
    }

    return {
        enqueued: true,
        message: enqueueResult.message,
        dedupeKey: enqueueResult.job.dedupeKey || dedupeKey,
        job: enqueueResult.job
    };
}
