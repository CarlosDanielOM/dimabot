import TwitchStreamers from '../../../classes/twitch_streamers.class.js';
import { ChannelAIPersonalitySchema } from '../../../schemas/channel_ai_personality.schema.js';
import { MODELS } from '../constants.js';

const MAX_ACTIONS = Math.max(5, Number(process.env.STREAM_MEMORY_SUMMARY_MAX_ACTIONS || 24));

interface StreamSummaryContext {
    channelID: string;
    session: {
        id: string;
        streamID: string;
        channel: string;
        status: string;
        startedAt: string;
        endedAt: string;
        durationMinutes: number;
        averageViewers: number;
        peakViewers: number;
        follows: number;
        subs: number;
        bits: number;
        donations: number;
    };
    snapshots: Array<{
        capturedAt: string;
        viewers: number;
        title: string;
        gameName: string;
    }>;
    sampledChatMessages: Array<{
        username: string;
        message: string;
        timestamp: number;
    }>;
    existingMemories: Array<{
        memoryID: string;
        status: string;
        type: string;
        confidence: number;
        summary: string;
        content: string;
        useCount: number;
        lastUsedAt?: string;
        updatedAt?: string;
    }>;
}

interface MemoryAction {
    action: 'create' | 'edit' | 'archive' | 'delete' | 'noop';
    type: string;
    targetMemoryId: string;
    summary: string;
    content: string;
    confidence: number;
    risk: 'low' | 'medium' | 'high';
    reason: string;
    evidence: string[];
}

interface SummaryOutput {
    summary: {
        headline: string;
        recap: string;
        highlights: string[];
    };
    actions: MemoryAction[];
}

interface GenerateStreamSummaryDecisionResult {
    error: boolean;
    message?: string;
    output?: SummaryOutput;
    model?: string;
}

interface LeanPersonalityDocument {
    profiles?: Array<{
        profileID?: string;
        personaMode?: string;
        tonePreset?: string;
        personality?: string;
    }>;
    activeProfileId?: string;
    personaMode?: string;
    tonePreset?: string;
    personality?: string;
}

interface RawAction {
    action?: unknown;
    risk?: unknown;
    evidence?: unknown;
    type?: unknown;
    targetMemoryId?: unknown;
    summary?: unknown;
    content?: unknown;
    confidence?: unknown;
    reason?: unknown;
}

interface OpenRouterChoice {
    message?: {
        content?: string;
    };
}

interface OpenRouterResponse {
    error?: {
        message?: string;
    };
    message?: string;
    choices?: OpenRouterChoice[];
}

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function clampConfidence(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return 0;
    }
    return Math.max(0, Math.min(1, parsed));
}

function selectModel(planTier: string | undefined): string {
    if (planTier === 'pro') {
        return MODELS.pro;
    }
    if (planTier === 'premium') {
        return MODELS.premium;
    }
    return MODELS.free;
}

function sanitizeAction(raw: RawAction): MemoryAction | null {
    const action = normalizeText(raw?.action).toLowerCase();
    if (!['create', 'edit', 'archive', 'delete', 'noop'].includes(action)) {
        return null;
    }

    const risk = normalizeText(raw?.risk).toLowerCase();
    const normalizedRisk: 'low' | 'medium' | 'high' = risk === 'high' || risk === 'medium' ? risk : 'low';

    const evidence = Array.isArray(raw?.evidence)
        ? (raw.evidence as unknown[])
            .map((item) => normalizeText(item))
            .filter(Boolean)
            .slice(0, 8)
        : [];

    return {
        action: action as MemoryAction['action'],
        type: normalizeText(raw?.type),
        targetMemoryId: normalizeText(raw?.targetMemoryId),
        summary: normalizeText(raw?.summary),
        content: normalizeText(raw?.content),
        confidence: clampConfidence(raw?.confidence),
        risk: normalizedRisk,
        reason: normalizeText(raw?.reason),
        evidence
    };
}

function fallbackOutput(context: StreamSummaryContext): SummaryOutput {
    const highlights: string[] = [];
    highlights.push(`Stream lasted ${context.session.durationMinutes} minutes with peak ${context.session.peakViewers} viewers.`);

    if (context.session.subs > 0 || context.session.follows > 0 || context.session.bits > 0) {
        highlights.push(`Session gains: ${context.session.subs} subs, ${context.session.follows} follows, ${context.session.bits} bits.`);
    }

    if (context.sampledChatMessages.length > 0) {
        const firstMessage = context.sampledChatMessages[0];
        highlights.push(`Chat sample started with ${firstMessage.username}: ${firstMessage.message.slice(0, 90)}`);
    }

    return {
        summary: {
            headline: `Stream summary for ${context.session.channel || context.channelID}`,
            recap: 'No high-confidence automatic memory actions were generated, but the stream summary was captured successfully.',
            highlights: highlights.slice(0, 4)
        },
        actions: []
    };
}

function extractPersonaInfo(personalityDoc: unknown): {
    mode: string;
    tonePreset: string;
    personality: string;
} {
    const doc = personalityDoc as LeanPersonalityDocument | null | undefined;

    const activeProfile = doc?.profiles?.find(
        (profile) => profile.profileID === doc.activeProfileId
    ) || doc?.profiles?.[0] || null;

    return {
        mode: activeProfile?.personaMode || doc?.personaMode || 'original',
        tonePreset: activeProfile?.tonePreset || doc?.tonePreset || 'balanced',
        personality: activeProfile?.personality || doc?.personality || ''
    };
}

export async function generateStreamSummaryDecision(
    context: StreamSummaryContext,
    mode: string
): Promise<GenerateStreamSummaryDecisionResult> {
    try {
        const streamer = await TwitchStreamers.getTwitchAccountById(context.channelID);
        const personalityDoc = await ChannelAIPersonalitySchema.findOne({ channelID: context.channelID }).lean();
        const model = selectModel(streamer?.plan_tier);

        const personaInfo = extractPersonaInfo(personalityDoc);

        const systemPrompt = `You are a stream memory planner.
You will receive channel stream context and existing memories.
Output strict JSON only with keys: summary, actions.

Rules:
- summary.headline: short title
- summary.recap: short paragraph
- summary.highlights: 2-6 bullet-style strings
- actions: list of proposed memory actions
- action is one of create|edit|archive|delete|noop
- For create/edit include type, summary, content, confidence, risk, reason, evidence
- For archive/delete include targetMemoryId, confidence, reason, evidence
- If no strong memory change is needed return empty actions.
- Keep actions high signal. Avoid trivial or redundant updates.
- Respect persona mode and tone but prioritize factual consistency.
`;

        const userPayload = {
            mode,
            channelID: context.channelID,
            session: context.session,
            persona: {
                mode: personaInfo.mode,
                tonePreset: personaInfo.tonePreset,
                personality: personaInfo.personality
            },
            sampledChatMessages: context.sampledChatMessages,
            snapshots: context.snapshots,
            existingMemories: context.existingMemories
        };

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'HTTP-Referer': 'https://domdimabot.com',
                'X-Title': 'DomDimaBot'
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: JSON.stringify(userPayload) }
                ],
                response_format: { type: 'json_object' },
                max_tokens: 4500,
                user: context.channelID
            })
        });

        const payload = (await response.json()) as OpenRouterResponse;

        if (!response.ok || payload?.error) {
            return {
                error: true,
                message: payload?.error?.message || payload?.message || 'OpenRouter failed during stream summary decision',
                output: fallbackOutput(context),
                model
            };
        }

        const rawContent = normalizeText(payload?.choices?.[0]?.message?.content);
        if (!rawContent) {
            return {
                error: true,
                message: 'Empty response from OpenRouter stream summary decision',
                output: fallbackOutput(context),
                model
            };
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(rawContent);
        } catch {
            parsed = null;
        }

        if (!parsed || typeof parsed !== 'object') {
            return {
                error: true,
                message: 'Invalid JSON from OpenRouter stream summary decision',
                output: fallbackOutput(context),
                model
            };
        }

        const parsedObj = parsed as Record<string, unknown>;
        const rawSummary = (parsedObj.summary || {}) as Record<string, unknown>;

        const summary = {
            headline: normalizeText(rawSummary.headline) || `Stream summary for ${context.session.channel || context.channelID}`,
            recap: normalizeText(rawSummary.recap) || 'No stream recap was generated by the model.',
            highlights: Array.isArray(rawSummary.highlights)
                ? (rawSummary.highlights as unknown[])
                    .map((item) => normalizeText(item))
                    .filter(Boolean)
                    .slice(0, 8)
                : []
        };

        const actions = Array.isArray(parsedObj.actions)
            ? (parsedObj.actions as RawAction[])
                .map((action) => sanitizeAction(action))
                .filter((action): action is MemoryAction => Boolean(action))
                .slice(0, MAX_ACTIONS)
            : [];

        return {
            error: false,
            output: {
                summary,
                actions
            },
            model
        };
    } catch (error) {
        console.error('Error in generateStreamSummaryDecision:', {
            channelID: context.channelID,
            mode,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });

        return {
            error: true,
            message: 'Failed to generate stream summary decision',
            output: fallbackOutput(context)
        };
    }
}
