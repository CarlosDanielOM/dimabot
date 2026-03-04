import { ChannelAIPersonalitySchema } from '../../../schemas/channel_ai_personality.schema.js';
import { ChannelStreamSummarySchema } from '../../../schemas/channel_stream_summary.schema.js';
import TwitchStreamers from '../../../classes/twitch_streamers.class.js';
import { buildStreamSummaryContext, type StreamSummaryContext } from './stream_summary_context.js';
import { generateStreamSummaryDecision } from './stream_summary_decider.js';
import { applyStreamMemoryActions, type IApplyStreamMemoryActionsResult, type IMemoryAction } from './stream_memory_apply.js';
import { recordStreamMemoryActionMetric } from '../../observability/bot_runtime_metrics.js';

const DEFAULT_RUN_CONFIG = {
    enabled: true,
    postStreamSummaryEnabled: true,
    weeklyMaintenanceEnabled: true,
    monthlyMaintenanceEnabled: true,
    summaryMinDurationMinutes: 20,
    summaryMinChatMessages: 30
};

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

interface IRunConfig {
    enabled: boolean;
    postStreamSummaryEnabled: boolean;
    weeklyMaintenanceEnabled: boolean;
    monthlyMaintenanceEnabled: boolean;
    summaryMinDurationMinutes: number;
    summaryMinChatMessages: number;
}

interface IPersonalityWithLearningConfig {
    learningConfig?: {
        enabled?: unknown;
        postStreamSummaryEnabled?: unknown;
        weeklyMaintenanceEnabled?: unknown;
        monthlyMaintenanceEnabled?: unknown;
        summaryMinDurationMinutes?: unknown;
        summaryMinChatMessages?: unknown;
    };
}

interface ISummaryOutput {
    summary: {
        headline: string;
        recap: string;
        highlights: string[];
    };
    actions: IMemoryAction[];
}

async function getRunConfig(channelID: string): Promise<IRunConfig> {
    const personality = await ChannelAIPersonalitySchema.findOne({ channelID }).select('learningConfig').lean() as IPersonalityWithLearningConfig | null;
    const config = personality?.learningConfig;
    return {
        enabled: Boolean(config?.enabled ?? DEFAULT_RUN_CONFIG.enabled),
        postStreamSummaryEnabled: Boolean(config?.postStreamSummaryEnabled ?? DEFAULT_RUN_CONFIG.postStreamSummaryEnabled),
        weeklyMaintenanceEnabled: Boolean(config?.weeklyMaintenanceEnabled ?? DEFAULT_RUN_CONFIG.weeklyMaintenanceEnabled),
        monthlyMaintenanceEnabled: Boolean(config?.monthlyMaintenanceEnabled ?? DEFAULT_RUN_CONFIG.monthlyMaintenanceEnabled),
        summaryMinDurationMinutes: Number(config?.summaryMinDurationMinutes ?? DEFAULT_RUN_CONFIG.summaryMinDurationMinutes),
        summaryMinChatMessages: Number(config?.summaryMinChatMessages ?? DEFAULT_RUN_CONFIG.summaryMinChatMessages)
    };
}

function shouldRunForSource(source: string, config: IRunConfig): boolean {
    if (!config.enabled) {
        return false;
    }
    if (source === 'stream_offline') {
        return config.postStreamSummaryEnabled;
    }
    if (source === 'weekly_maintenance') {
        return config.weeklyMaintenanceEnabled;
    }
    return config.monthlyMaintenanceEnabled;
}

interface ISaveSummaryRecordParams {
    channelID: string;
    channelName: string;
    source: string;
    context: StreamSummaryContext;
    status: string;
    summary: {
        headline: string;
        recap: string;
        highlights: string[];
    };
    proposedActions: IMemoryAction[];
    appliedActions: IApplyStreamMemoryActionsResult['results'];
    totals: IApplyStreamMemoryActionsResult['totals'];
    errorMessage?: string;
}

async function saveSummaryRecord(params: ISaveSummaryRecordParams): Promise<{ _id: string } | null> {
    const updateDoc = {
        channelID: params.channelID,
        channel: params.channelName,
        stream_session_id: params.context.session.id,
        stream_id: params.context.session.streamID,
        started_at: params.context.session.startedAt,
        ended_at: params.context.session.endedAt,
        duration_minutes: params.context.session.durationMinutes,
        average_viewers: params.context.session.averageViewers,
        peak_viewers: params.context.session.peakViewers,
        follows: params.context.session.follows,
        subs: params.context.session.subs,
        bits: params.context.session.bits,
        donations: params.context.session.donations,
        headline: params.summary.headline,
        recap: params.summary.recap,
        highlights: params.summary.highlights,
        chat_messages_sampled: params.context.chatMessages.length,
        snapshot_count: params.context.snapshots.length,
        proposed_actions: params.proposedActions,
        applied_actions: params.appliedActions,
        totals: params.totals,
        status: params.status,
        source: params.source,
        error_message: normalizeText(params.errorMessage)
    };
    const document = await ChannelStreamSummarySchema.findOneAndUpdate({
        channelID: params.channelID,
        stream_session_id: params.context.session.id,
        source: params.source
    }, {
        $set: updateDoc,
        $setOnInsert: {
            created_at: new Date()
        }
    }, {
        new: true,
        upsert: true
    });
    return document ? { _id: String(document._id) } : null;
}

export interface IRunStreamMemoryWorkflowInput {
    channelID: string;
    sessionID?: string;
    streamID?: string;
    source: 'stream_offline' | 'weekly_maintenance' | 'monthly_maintenance' | 'manual';
}

export interface IRunStreamMemoryWorkflowResult {
    error: boolean;
    message?: string;
    status: 'applied' | 'skipped' | 'noop' | 'failed';
    summaryID?: string;
}

export async function runStreamMemoryWorkflow(input: IRunStreamMemoryWorkflowInput): Promise<IRunStreamMemoryWorkflowResult> {
    try {
        const channelID = normalizeText(input.channelID);
        if (!channelID) {
            return {
                error: true,
                message: 'Invalid channel ID',
                status: 'failed'
            };
        }
        const config = await getRunConfig(channelID);
        if (!shouldRunForSource(input.source, config)) {
            return {
                error: false,
                message: `Stream memory workflow disabled for source ${input.source}`,
                status: 'skipped'
            };
        }
        const contextResult = await buildStreamSummaryContext({
            channelID,
            sessionID: input.sessionID,
            streamID: input.streamID
        });
        if (contextResult.error || !contextResult.context) {
            return {
                error: true,
                message: contextResult.message || 'Failed to build stream summary context',
                status: 'failed'
            };
        }
        const context = contextResult.context;
        const streamer = await TwitchStreamers.getTwitchAccountById(channelID);
        const channelName = normalizeText(streamer?.name) || context.session.channel || 'Unknown';
        const isBelowThreshold = input.source === 'stream_offline'
            && (context.session.durationMinutes < config.summaryMinDurationMinutes
                || context.chatMessages.length < config.summaryMinChatMessages);
        if (isBelowThreshold) {
            const noOpSummary = await saveSummaryRecord({
                channelID,
                channelName,
                source: input.source,
                context,
                status: 'noop',
                summary: {
                    headline: `Stream summary for ${channelName}`,
                    recap: 'Stream did not meet summary thresholds, so no memory actions were applied.',
                    highlights: [
                        `Duration: ${context.session.durationMinutes} minutes`,
                        `Sampled chat messages: ${context.chatMessages.length}`
                    ]
                },
                proposedActions: [],
                appliedActions: [],
                totals: {
                    proposed: 0,
                    applied: 0,
                    skipped: 0,
                    failed: 0
                }
            });
            return {
                error: false,
                message: 'Summary thresholds not met; workflow marked as noop',
                status: 'noop',
                summaryID: noOpSummary?._id
            };
        }
        const decisionResult = await generateStreamSummaryDecision(context, input.source);
        const decisionOutput = decisionResult.output as ISummaryOutput | undefined;
        if (!decisionOutput) {
            const failedSummary = await saveSummaryRecord({
                channelID,
                channelName,
                source: input.source,
                context,
                status: 'failed',
                summary: {
                    headline: `Stream summary for ${channelName}`,
                    recap: 'Failed to produce AI summary output.',
                    highlights: []
                },
                proposedActions: [],
                appliedActions: [],
                totals: {
                    proposed: 0,
                    applied: 0,
                    skipped: 0,
                    failed: 1
                },
                errorMessage: decisionResult.message || 'Missing AI decision output'
            });
            return {
                error: true,
                message: decisionResult.message || 'Failed to generate stream summary decision',
                status: 'failed',
                summaryID: failedSummary?._id
            };
        }
        const applyResult = await applyStreamMemoryActions({
            channelID,
            channelName,
            actions: decisionOutput.actions,
            source: input.source
        });
        const actionCounts = new Map<string, number>();
        for (const result of applyResult.results) {
            const key = `${result.action}:${result.status}`;
            actionCounts.set(key, (actionCounts.get(key) || 0) + 1);
        }
        for (const [actionStatus, count] of actionCounts.entries()) {
            void recordStreamMemoryActionMetric({
                channelID,
                source: input.source,
                action: actionStatus,
                count
            });
        }
        const status = applyResult.totals.applied > 0 ? 'applied' : 'noop';
        const summaryDoc = await saveSummaryRecord({
            channelID,
            channelName,
            source: input.source,
            context,
            status,
            summary: decisionOutput.summary,
            proposedActions: decisionOutput.actions,
            appliedActions: applyResult.results,
            totals: applyResult.totals,
            errorMessage: decisionResult.error ? decisionResult.message : ''
        });
        return {
            error: false,
            message: status === 'applied'
                ? 'Stream memory workflow completed with applied actions'
                : 'Stream memory workflow completed with no applied actions',
            status,
            summaryID: summaryDoc?._id
        };
    }
    catch (error) {
        console.error('Error in runStreamMemoryWorkflow:', {
            input,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
        return {
            error: true,
            message: 'Failed to run stream memory workflow',
            status: 'failed'
        };
    }
}
