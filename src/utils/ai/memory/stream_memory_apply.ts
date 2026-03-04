import { ChannelAIPersonalitySchema } from '../../../schemas/channel_ai_personality.schema.js';
import { ChannelAIMemorySchema, type MemoryType, type MemoryRisk } from '../../../schemas/channel_ai_memory.schema.js';
import {
    createOrUpdateChannelMemory,
    deleteChannelMemoryPermanently,
    setChannelMemoryStatus,
    updateChannelMemory
} from './memory.service.js';

const DEFAULT_CONFIG = {
    autoApplyCreates: true,
    autoApplyEdits: true,
    autoApplyArchives: true,
    autoApplyPermanentDeletes: true,
    createMinConfidence: 0.72,
    editMinConfidence: 0.74,
    archiveMinConfidence: 0.8,
    deleteMinConfidence: 0.88,
    maxActionsPerRun: 20,
    maxDeletesPerRun: 5,
    minMemoryAgeDaysForDelete: 30,
    minUnusedDaysForDelete: 21
};

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function normalizeConfidence(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return 0;
    }
    return Math.max(0, Math.min(1, parsed));
}

interface IApplyConfig {
    autoApplyCreates: boolean;
    autoApplyEdits: boolean;
    autoApplyArchives: boolean;
    autoApplyPermanentDeletes: boolean;
    createMinConfidence: number;
    editMinConfidence: number;
    archiveMinConfidence: number;
    deleteMinConfidence: number;
    maxActionsPerRun: number;
    maxDeletesPerRun: number;
    minMemoryAgeDaysForDelete: number;
    minUnusedDaysForDelete: number;
}

interface IPersonalityWithLearningConfig {
    learningConfig?: {
        autoApplyCreates?: unknown;
        autoApplyEdits?: unknown;
        autoApplyArchives?: unknown;
        autoApplyPermanentDeletes?: unknown;
        createMinConfidence?: unknown;
        editMinConfidence?: unknown;
        archiveMinConfidence?: unknown;
        deleteMinConfidence?: unknown;
        maxActionsPerRun?: unknown;
        maxDeletesPerRun?: unknown;
        minMemoryAgeDaysForDelete?: unknown;
        minUnusedDaysForDelete?: unknown;
    };
}

async function getApplyConfig(channelID: string): Promise<IApplyConfig> {
    const personality = await ChannelAIPersonalitySchema.findOne({ channelID }).select('learningConfig').lean() as IPersonalityWithLearningConfig | null;
    const config = personality?.learningConfig;
    return {
        autoApplyCreates: Boolean(config?.autoApplyCreates ?? DEFAULT_CONFIG.autoApplyCreates),
        autoApplyEdits: Boolean(config?.autoApplyEdits ?? DEFAULT_CONFIG.autoApplyEdits),
        autoApplyArchives: Boolean(config?.autoApplyArchives ?? DEFAULT_CONFIG.autoApplyArchives),
        autoApplyPermanentDeletes: Boolean(config?.autoApplyPermanentDeletes ?? DEFAULT_CONFIG.autoApplyPermanentDeletes),
        createMinConfidence: Number(config?.createMinConfidence ?? DEFAULT_CONFIG.createMinConfidence),
        editMinConfidence: Number(config?.editMinConfidence ?? DEFAULT_CONFIG.editMinConfidence),
        archiveMinConfidence: Number(config?.archiveMinConfidence ?? DEFAULT_CONFIG.archiveMinConfidence),
        deleteMinConfidence: Number(config?.deleteMinConfidence ?? DEFAULT_CONFIG.deleteMinConfidence),
        maxActionsPerRun: Number(config?.maxActionsPerRun ?? DEFAULT_CONFIG.maxActionsPerRun),
        maxDeletesPerRun: Number(config?.maxDeletesPerRun ?? DEFAULT_CONFIG.maxDeletesPerRun),
        minMemoryAgeDaysForDelete: Number(config?.minMemoryAgeDaysForDelete ?? DEFAULT_CONFIG.minMemoryAgeDaysForDelete),
        minUnusedDaysForDelete: Number(config?.minUnusedDaysForDelete ?? DEFAULT_CONFIG.minUnusedDaysForDelete)
    };
}

function ageInDays(dateValue: unknown): number {
    if (!dateValue) {
        return Number.POSITIVE_INFINITY;
    }
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue as string | number);
    const ms = Date.now() - date.getTime();
    return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

type StreamMemoryAction = 'noop' | 'create' | 'edit' | 'archive' | 'delete';

export interface IMemoryAction {
    action: StreamMemoryAction;
    targetMemoryId?: unknown;
    confidence?: unknown;
    type?: unknown;
    risk?: unknown;
    content?: unknown;
    summary?: unknown;
}

interface IActionResult {
    action: StreamMemoryAction;
    targetMemoryId: string;
    status: 'applied' | 'skipped' | 'failed';
    reason?: string;
    error?: string;
}

function buildSkipped(action: IMemoryAction, reason: string): IActionResult {
    return {
        action: action.action,
        targetMemoryId: normalizeText(action.targetMemoryId),
        status: 'skipped',
        reason
    };
}

function buildFailed(action: IMemoryAction, error: string): IActionResult {
    return {
        action: action.action,
        targetMemoryId: normalizeText(action.targetMemoryId),
        status: 'failed',
        error
    };
}

function buildApplied(action: IMemoryAction, reason: string, targetMemoryId?: string): IActionResult {
    return {
        action: action.action,
        targetMemoryId: targetMemoryId || normalizeText(action.targetMemoryId),
        status: 'applied',
        reason
    };
}

export interface IApplyStreamMemoryActionsParams {
    channelID: string;
    channelName?: string;
    actions: IMemoryAction[];
    source?: string;
}

export interface IApplyStreamMemoryActionsResult {
    results: IActionResult[];
    totals: {
        proposed: number;
        applied: number;
        skipped: number;
        failed: number;
    };
}

export async function applyStreamMemoryActions(params: IApplyStreamMemoryActionsParams): Promise<IApplyStreamMemoryActionsResult> {
    const results: IActionResult[] = [];
    const config = await getApplyConfig(params.channelID);
    const actions = (Array.isArray(params.actions) ? params.actions : [])
        .slice(0, Math.max(1, config.maxActionsPerRun));
    let deleteCount = 0;
    for (const action of actions) {
        const confidence = normalizeConfidence(action.confidence);
        const targetMemoryId = normalizeText(action.targetMemoryId);
        try {
            if (action.action === 'noop') {
                results.push(buildSkipped(action, 'noop_action'));
                continue;
            }
            if (action.action === 'create') {
                if (!config.autoApplyCreates) {
                    results.push(buildSkipped(action, 'auto_apply_create_disabled'));
                    continue;
                }
                if (confidence < config.createMinConfidence) {
                    results.push(buildSkipped(action, 'create_confidence_below_threshold'));
                    continue;
                }
                const createResult = await createOrUpdateChannelMemory({
                    channelID: params.channelID,
                    channelName: params.channelName,
                    type: normalizeText(action.type) as MemoryType,
                    risk: normalizeText(action.risk || 'low') as MemoryRisk,
                    confidence,
                    subject: {
                        scope: 'channel'
                    },
                    content: normalizeText(action.content) || normalizeText(action.summary),
                    summary: normalizeText(action.summary),
                    createdBy: {
                        source: 'system',
                        username: 'stream_memory_worker'
                    },
                    forceStatus: 'confirmed',
                    bypassLearningConfig: true
                });
                if (createResult.error || !createResult.memory) {
                    results.push(buildFailed(action, createResult.message || 'failed_to_create_memory'));
                    continue;
                }
                results.push(buildApplied(action, 'created_memory', String(createResult.memory._id)));
                continue;
            }
            if (action.action === 'edit') {
                if (!config.autoApplyEdits) {
                    results.push(buildSkipped(action, 'auto_apply_edit_disabled'));
                    continue;
                }
                if (confidence < config.editMinConfidence) {
                    results.push(buildSkipped(action, 'edit_confidence_below_threshold'));
                    continue;
                }
                if (!targetMemoryId) {
                    results.push(buildSkipped(action, 'missing_target_memory_id'));
                    continue;
                }
                const updateResult = await updateChannelMemory({
                    channelID: params.channelID,
                    memoryID: targetMemoryId,
                    type: normalizeText(action.type) as MemoryType,
                    risk: normalizeText(action.risk || 'low') as MemoryRisk,
                    confidence,
                    content: normalizeText(action.content),
                    summary: normalizeText(action.summary)
                });
                if (updateResult.error || !updateResult.memory) {
                    results.push(buildFailed(action, updateResult.message || 'failed_to_edit_memory'));
                    continue;
                }
                results.push(buildApplied(action, 'updated_memory', targetMemoryId));
                continue;
            }
            if (action.action === 'archive') {
                if (!config.autoApplyArchives) {
                    results.push(buildSkipped(action, 'auto_apply_archive_disabled'));
                    continue;
                }
                if (confidence < config.archiveMinConfidence) {
                    results.push(buildSkipped(action, 'archive_confidence_below_threshold'));
                    continue;
                }
                if (!targetMemoryId) {
                    results.push(buildSkipped(action, 'missing_target_memory_id'));
                    continue;
                }
                const archiveResult = await setChannelMemoryStatus({
                    channelID: params.channelID,
                    memoryID: targetMemoryId,
                    status: 'archived',
                    reviewer: {
                        source: 'system',
                        username: 'stream_memory_worker'
                    },
                    reviewReason: `auto_archive_${params.source || 'unknown'}`
                });
                if (archiveResult.error || !archiveResult.memory) {
                    results.push(buildFailed(action, archiveResult.message || 'failed_to_archive_memory'));
                    continue;
                }
                results.push(buildApplied(action, 'archived_memory', targetMemoryId));
                continue;
            }
            if (action.action === 'delete') {
                if (!config.autoApplyPermanentDeletes) {
                    results.push(buildSkipped(action, 'auto_apply_delete_disabled'));
                    continue;
                }
                if (deleteCount >= Math.max(0, config.maxDeletesPerRun)) {
                    results.push(buildSkipped(action, 'max_deletes_per_run_reached'));
                    continue;
                }
                if (confidence < config.deleteMinConfidence) {
                    results.push(buildSkipped(action, 'delete_confidence_below_threshold'));
                    continue;
                }
                if (!targetMemoryId) {
                    results.push(buildSkipped(action, 'missing_target_memory_id'));
                    continue;
                }
                const existing = await ChannelAIMemorySchema.findOne({ _id: targetMemoryId, channelID: params.channelID }).lean();
                if (!existing) {
                    results.push(buildSkipped(action, 'memory_not_found'));
                    continue;
                }
                const memoryAgeDays = ageInDays(existing.createdAt);
                const unusedAgeDays = ageInDays(existing.lastUsedAt || existing.updatedAt);
                if (memoryAgeDays < config.minMemoryAgeDaysForDelete) {
                    results.push(buildSkipped(action, 'memory_too_new_for_delete'));
                    continue;
                }
                if (unusedAgeDays < config.minUnusedDaysForDelete) {
                    results.push(buildSkipped(action, 'memory_recently_used_or_updated'));
                    continue;
                }
                const deleteResult = await deleteChannelMemoryPermanently({
                    channelID: params.channelID,
                    memoryID: targetMemoryId
                });
                if (deleteResult.error) {
                    results.push(buildFailed(action, deleteResult.message || 'failed_to_delete_memory'));
                    continue;
                }
                deleteCount += 1;
                results.push(buildApplied(action, 'deleted_memory', targetMemoryId));
                continue;
            }
            results.push(buildSkipped(action, 'unsupported_action'));
        }
        catch (error) {
            results.push(buildFailed(action, error instanceof Error ? error.message : String(error)));
        }
    }
    const totals = {
        proposed: actions.length,
        applied: results.filter((item) => item.status === 'applied').length,
        skipped: results.filter((item) => item.status === 'skipped').length,
        failed: results.filter((item) => item.status === 'failed').length
    };
    return {
        results,
        totals
    };
}
