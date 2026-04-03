import TwitchStreamers from '../../../classes/twitch_streamers.class.js';
import { ChannelAIPersonalitySchema, type IChannelAIPersonality } from '../../../schemas/channel_ai_personality.schema.js';
import { formatBadges, type IBadge } from '../../badges.js';
import { getDragonflyClient } from '../../databases/dragonfly.database.js';
import { ingestPolarSHEvent } from '../../polarsh.js';
import { constructChatSystemMessages } from '../prompts.ai.js';
import { MODELS, TOKEN_LIMITS, MINIMAX_MODEL } from '../constants.js';
import { minimaxChat, calculateMiniMaxCost } from '../minimax/minimax_client.js';
import { createFetchWithRetry } from '../fetch.utils.js';
import { error, debug } from '../../logger.js';

const OPENROUTER_TIMEOUT = 30000;
const fetchWithRetry = createFetchWithRetry({ timeout: OPENROUTER_TIMEOUT, retries: 3 });

// ============================================================================
// INTERFACES
// ============================================================================

interface IStreamerData {
    name?: string;
    plan_tier?: 'free' | 'premium' | 'pro';
    polar_sh_customer_id?: string;
    [key: string]: any;
}

interface IUsageData {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost_details?: {
        upstream_inference_prompt_cost?: number;
        upstream_inference_completions_cost?: number;
    };
}

interface IChatHistoryMessage {
    timestamp: number;
    badges?: string;
    username: string;
    message: string;
}

interface IToolContext {
    name: string;
    context: any;
}

interface IAIResponse {
    error?: boolean;
    message?: string;
    status?: number;
    type?: string;
    content?: string;
}

interface IOpenRouterResponse {
    choices?: Array<{
        message?: {
            content?: string;
        };
    }>;
    usage?: IUsageData;
    error?: boolean;
    message?: string;
    status?: number;
}

type IAPIOption = Record<string, any>;

interface IChatMessageTags {
    badges: IBadge[];
    chatter_user_name?: string;
    chatter_user_login?: string;
    [key: string]: any;
}

export { MODELS, TOKEN_LIMITS };

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function selectModel(streamer: IStreamerData | null | undefined): string {
    if (streamer?.plan_tier === 'pro') {
        return MODELS.pro;
    }
    if (streamer?.plan_tier === 'premium') {
        return MODELS.premium;
    }
    return MODELS.free;
}

function getTokenLimit(model: string): number {
    return TOKEN_LIMITS[model as keyof typeof TOKEN_LIMITS] || TOKEN_LIMITS.default;
}

function generateTimeLeftToNextMonthInSeconds(): number {
    const now = new Date();
    const dayOfMonth = now.getDate();
    const timeLeft = 30 - dayOfMonth;

    const timeLeftInSeconds = timeLeft * 24 * 3600 -
        now.getHours() * 3600 -
        now.getMinutes() * 60 -
        now.getSeconds() -
        now.getMilliseconds();

    return Math.max(timeLeftInSeconds, 3600); // Minimum 1 hour
}

async function getChannelPersonality(channelID: string): Promise<IChannelAIPersonality | null> {
    const cacheClient = await getDragonflyClient('Messages');
    const streamer = await TwitchStreamers.getTwitchAccountById(channelID);

    // Try cache first
    let personality = await cacheClient.get(`twitch:${channelID}:chatbot:personality`);
    if (personality) {
        return JSON.parse(personality) as unknown as IChannelAIPersonality;
    }

    // Try database
    const dbPersonality = await ChannelAIPersonalitySchema.findOne({ channelID: channelID });
    if (dbPersonality) {
        await cacheClient.set(`twitch:${channelID}:chatbot:personality`, JSON.stringify(dbPersonality));
        return dbPersonality;
    }

    // Create default personality for new channels
    const contextWindow = streamer?.plan_tier === 'pro' ? 35 :
                           (streamer?.plan_tier === 'premium' ? 15 : 7);

    const newPersonality = await ChannelAIPersonalitySchema.create({
        channelID,
        channel: streamer?.name || 'Unknown',
        contextWindow,
        personality: `You are a friendly and playful Twitch chat moderator for ${streamer?.name || 'this channel'}. You speak in Spanish by default but can adapt to other languages. You have a good sense of humor and enjoy interacting with chat users. You maintain a fun and engaging atmosphere while still being able to moderate when necessary.`,
        rules: ["Be respectful and friendly with users"],
        knownUsers: [
            {
                username: 'cdom201',
                description: 'Creator, Owner and Developer of you, bot',
                relationship: 'professional',
                lastInteraction: new Date()
            }
        ]
    });

    if (newPersonality) {
        await cacheClient.set(`twitch:${channelID}:chatbot:personality`, JSON.stringify(newPersonality));
    }

    return newPersonality;
}

// ============================================================================
// MAIN CHAT HANDLER
// ============================================================================

export async function AiResponse(
    channelID: string,
    message: string,
    model: string | null = null,
    context: IChatHistoryMessage[] = [],
    tags: IChatMessageTags | null = null,
    options: IAPIOption[] = [],
    toolContext: IToolContext[] = []
): Promise<string | IAIResponse> {
    const cacheClient = await getDragonflyClient('Messages');

    // Get streamer and personality data
    const streamer = await TwitchStreamers.getTwitchAccountById(channelID);
    const personality = await getChannelPersonality(channelID);

    // Handle missing personality (fallback)
    const effectivePersonality: IChannelAIPersonality = personality || {
        _id: undefined as any,
        channelID,
        channel: streamer?.name || 'Unknown',
        enabled: true,
        profiles: [],
        activeProfileId: '',
        personality: `You are a friendly and playful Twitch chat moderator for this channel. You speak in Spanish by default but can adapt to other languages. You have a good sense of humor and enjoy interacting with chat users. You maintain a fun and engaging atmosphere while still being able to moderate when necessary.`,
        personaMode: 'original',
        personaReference: '',
        tonePreset: 'balanced',
        voiceProfile: {
            tone: 'friendly and playful',
            cadence: 'short and dynamic',
            style: 'chat-native and expressive',
            catchphrases: []
        },
        learningConfig: {
            enabled: true,
            autoConfirmEnabled: true,
            autoConfirmThreshold: 0.82,
            minMessageLength: 12,
            maxPendingMemories: 250,
            maxConfirmedMemories: 2000,
            postStreamSummaryEnabled: true,
            weeklyMaintenanceEnabled: true,
            monthlyMaintenanceEnabled: true,
            autoApplyCreates: true,
            autoApplyEdits: true,
            autoApplyArchives: true,
            autoApplyPermanentDeletes: true,
            summaryMinDurationMinutes: 20,
            summaryMinChatMessages: 30,
            createMinConfidence: 0.72,
            editMinConfidence: 0.74,
            archiveMinConfidence: 0.8,
            deleteMinConfidence: 0.88,
            maxActionsPerRun: 20,
            maxDeletesPerRun: 5,
            minMemoryAgeDaysForDelete: 30,
            minUnusedDaysForDelete: 21
        },
        memoryPolicy: {
            prioritizeRecentChat: true,
            allowSensitiveMemories: false,
            allowUserPreferenceMemories: true,
            allowRunningJokes: true
        },
        rules: ["Be respectful and friendly with users"],
        knownUsers: [
            {
                username: 'cdom201',
                description: 'Creator, Owner and Developer of you, bot',
                relationship: 'professional',
                lastInteraction: new Date()
            }
        ],
        contextWindow: 3,
        createdAt: new Date(),
        updatedAt: new Date()
    };

    // Check if user has exhausted AI credits
    const isExhausted = await cacheClient.exists(`${channelID}:ai:exhaust`);

    // Select model based on streamer tier
    const selectedModel = isExhausted ? MODELS.free : (model || selectModel(streamer));
    const maxTokens = getTokenLimit(selectedModel);

    // Build user context from EventSub message structure
    const { formattedBadges } = await formatBadges({ badges: tags?.badges || [] });
    const userContext = {
        username: tags?.username || tags?.chatter_user_name || tags?.chatter_user_login || 'Anonymous',
        badges: formattedBadges
    };

    // Build chat history context
    const chatHistory = context.map(msg => ({
        timestamp: msg.timestamp,
        badges: msg.badges || '',
        username: msg.username,
        message: msg.message
    }));

    // Use shared utility to construct messages
    const messages = constructChatSystemMessages(
        streamer,
        effectivePersonality,
        userContext,
        message,
        chatHistory,
        toolContext
    );

    const isProUser = streamer?.plan_tier === 'pro' && !isExhausted;

    if (isProUser) {
        debug({ function: 'AiResponse', message: '[Messages] Pro tier - using MiniMax', channelID, model: MINIMAX_MODEL }, { channelId: channelID, destination: 'console' });

        const systemContent = messages.find((m: any) => m.role === 'system')?.content as string | undefined;
        const userMessage = messages.find((m: any) => m.role === 'user') as any;

        debug({ function: 'AiResponse', message: '[Messages] Extracted system content for MiniMax', channelID, systemContentLength: systemContent?.length, hasUserMessage: !!userMessage }, { channelId: channelID, destination: 'console' });

        try {
            const result = await minimaxChat({
                model: MINIMAX_MODEL,
                messages: userMessage ? [userMessage] : [],
                maxTokens,
                system: systemContent,
                channelID
            });

            if (channelID) {
                await cacheClient.set(`${channelID}:chatbot:response:last`, JSON.stringify({
                    messageData: { content: result.content },
                    usageData: { prompt_tokens: result.inputTokens, completion_tokens: result.outputTokens, total_tokens: result.inputTokens + result.outputTokens },
                    model: MINIMAX_MODEL,
                    timestamp: new Date().toISOString()
                }));
            }

            if (channelID) {
                try {
                    await cacheClient.hIncrBy(`${channelID}:chatbot:usage`, 'total_tokens', result.inputTokens + result.outputTokens);
                    await cacheClient.hIncrBy(`${channelID}:chatbot:usage`, 'prompt_tokens', result.inputTokens);
                    await cacheClient.hIncrBy(`${channelID}:chatbot:usage`, 'completion_tokens', result.outputTokens);
                    await cacheClient.expire(`${channelID}:chatbot:usage`, generateTimeLeftToNextMonthInSeconds());
                } catch (cacheError) {
                    await error({ function: 'AiResponse', error: 'Cache error tracking AI usage', err: cacheError instanceof Error ? cacheError.message : String(cacheError) }, { channelId: channelID, destination: 'both' });
                }
            }

            const cost = calculateMiniMaxCost(result.inputTokens, result.outputTokens);
            debug({ function: 'AiResponse', message: '[Messages] MiniMax cost tracked', channelID, cost, inputTokens: result.inputTokens, outputTokens: result.outputTokens }, { channelId: channelID, destination: 'console' });

            if ((streamer as any)?.polar_sh_customer_id) {
                ingestPolarSHEvent({
                    customerId: (streamer as any).polar_sh_customer_id,
                    channelID,
                    cost,
                    reason: 'messages',
                    llm: {
                        model: MINIMAX_MODEL,
                        usage: {
                            prompt_tokens: result.inputTokens,
                            completion_tokens: result.outputTokens,
                            total_tokens: result.inputTokens + result.outputTokens
                        }
                    },
                    mode: 'batch'
                });
            }

            return result.content;

        } catch (fetchError) {
            await error({ function: 'AiResponse', message: '[Messages] MiniMax fetch error', err: fetchError instanceof Error ? fetchError.message : String(fetchError) }, { channelId: channelID, destination: 'both' });
            return {
                error: true,
                message: 'Connection error',
                status: 500,
                type: 'fetch_error'
            };
        }
    }

    // API headers
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://domdimabot.com',
        'X-Title': 'DomDimaBot',
        'X-Description': 'DomDimaBot is a Twitch chat bot that helps make streams more engaging and fun.'
    };

    // Build request body
    const body: any = {
        model: selectedModel,
        messages: messages,
        max_tokens: maxTokens,
        user: `${channelID}`,
        usage: {
            include: true
        }
    };

    // Apply additional options
    for (const option of options) {
        if (typeof option === 'object') {
            for (const [key, value] of Object.entries(option)) {
                body[key] = value;
            }
        }
    }

    try {
        const response = await fetchWithRetry('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: headers as Record<string, string>,
            body: JSON.stringify(body)
        });

        const data: IOpenRouterResponse = await response.json();

        // Handle API errors
        if (data.error) {
            return {
                error: true,
                message: data.message || 'API error occurred',
                status: data.status,
                type: 'api_error'
            };
        }

        const messageData = data.choices?.[0]?.message;
        const usageData = data.usage;

        // Store last response for debugging
        if (channelID) {
            await cacheClient.set(`${channelID}:chatbot:response:last`, JSON.stringify({
                messageData,
                usageData,
                model: selectedModel,
                timestamp: new Date().toISOString()
            }));
        }

        // Track usage statistics
        if (usageData && channelID) {
            try {
                await cacheClient.hIncrBy(`${channelID}:chatbot:usage`, 'total_tokens', usageData.total_tokens || 0);
                await cacheClient.hIncrBy(`${channelID}:chatbot:usage`, 'prompt_tokens', usageData.prompt_tokens || 0);
                await cacheClient.hIncrBy(`${channelID}:chatbot:usage`, 'completion_tokens', usageData.completion_tokens || 0);
                await cacheClient.expire(`${channelID}:chatbot:usage`, generateTimeLeftToNextMonthInSeconds());
            } catch (cacheError) {
                await error({ function: 'AiMessage', error: 'Cache error tracking AI usage', err: cacheError instanceof Error ? cacheError.message : String(cacheError) }, { channelId: channelID, destination: 'both' });
            }
        }

        const actualCost = (usageData?.cost_details?.upstream_inference_prompt_cost || 0) +
                         (usageData?.cost_details?.upstream_inference_completions_cost || 0);

        if ((streamer as any)?.polar_sh_customer_id) {
            ingestPolarSHEvent({
                customerId: (streamer as any).polar_sh_customer_id,
                channelID,
                cost: actualCost,
                reason: 'messages',
                llm: {
                    model: selectedModel,
                    usage: usageData as any
                },
                mode: 'batch'
            });
        }

        return messageData?.content || '';

    } catch (fetchError) {
        await error({ function: 'AiMessage', error: 'OpenRouter fetch error', err: fetchError instanceof Error ? fetchError.message : String(fetchError) }, { channelId: channelID, destination: 'both' });
        return {
            error: true,
            message: 'Connection error',
            status: 500,
            type: 'fetch_error'
        };
    }
}
