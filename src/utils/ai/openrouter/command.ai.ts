/**
 * AI Command Handler for $(ai) Commands
 * 
 * Handles one-off AI command executions with tiered model selection.
 * Uses Nitro models for faster response times and includes command injection sanitization.
 */

import { constructSystemMessages } from '../prompts.ai.js';
import { getDragonflyClient } from '../../databases/dragonfly.database.js';
import { ingestPolarSHEvent } from '../../polarsh.js';
import { MODELS, TOKEN_LIMITS } from '../constants.js';
import { error } from '../../logger.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface AiCommandResponse {
    error: boolean;
    message: string;
}

export interface UserContext {
    username: string;
    badges?: string;
}

export interface ModelInfo {
    model: string;
    tier: 'free' | 'premium' | 'pro';
    maxTokens: number;
}

export interface IStreamerData {
    user_id?: string;
    name?: string;
    plan_tier?: 'free' | 'premium' | 'pro';
    polar_sh_customer_id?: string;
    [key: string]: any;
}

export interface OpenRouterUsage {
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    cost_details?: {
        upstream_inference_prompt_cost?: number;
        upstream_inference_completions_cost?: number;
    };
}

export interface OpenRouterResponse {
    choices?: Array<{
        message?: {
            content?: string;
        };
    }>;
    usage?: OpenRouterUsage;
    error?: boolean;
    message?: string;
    status?: number;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Determines the appropriate model based on streamer's subscription tier.
 * 
 * @param streamer - Streamer object from cache
 * @returns Model identifier for OpenRouter
 */
export function selectModel(streamer: IStreamerData | null | undefined): string {
    if (streamer?.plan_tier === 'pro') {
        return MODELS.pro;
    }
    if (streamer?.plan_tier === 'premium') {
        return MODELS.premium;
    }
    return MODELS.free;
}

/**
 * Gets the appropriate max_tokens limit for a model.
 * 
 * @param model - Model identifier
 * @returns Maximum tokens for completion
 */
export function getTokenLimit(model: string): number {
    return TOKEN_LIMITS[model as keyof typeof TOKEN_LIMITS] || TOKEN_LIMITS.default;
}

/**
 * Sanitizes AI output to prevent command injection.
 * CRITICAL: Escapes $, %, and * to prevent recursive command parsing.
 * 
 * @param output - Raw AI response
 * @returns Sanitized output safe for command handler
 */
export function sanitizeOutput(output: unknown): string {
    if (typeof output !== 'string') return String(output || '');
    
    return output
        .replace(/\$/g, '\\$')
        .replace(/%/g, '\\%')
        .replace(/\*/g, '\\*');
}

/**
 * Calculates seconds until the next month for cache expiration.
 * 
 * @returns Seconds until next month
 */
function generateTimeLeftToNextMonthInSeconds(): number {
    const now = new Date();
    const dayOfMonth = now.getDate();
    const timeLeft = 30 - dayOfMonth;
    
    const timeLeftInSeconds = timeLeft * 24 * 3600 - 
        now.getHours() * 3600 - 
        now.getMinutes() * 60 - 
        now.getSeconds();
    
    return Math.max(timeLeftInSeconds, 3600);
}

// ============================================================================
// MAIN COMMAND HANDLER
// ============================================================================

/**
 * Executes an AI command for $(ai prompt) syntax.
 * 
 * @param streamer - Streamer object from cache
 * @param userContext - User context object
 * @param userContext.username - Username of the person invoking the command
 * @param userContext.badges - Optional formatted badge string
 * @param prompt - The prompt text to send to the AI
 * @param reason - The reason for the AI command (default: 'commands')
 * @returns Result object
 */
export async function executeAiCommand(
    streamer: IStreamerData,
    userContext: UserContext,
    prompt: string,
    reason: string = 'commands'
): Promise<AiCommandResponse> {
    const cacheClient = await getDragonflyClient('Command');
    const channelID = streamer?.user_id;
    
    if (!prompt || prompt.trim() === '') {
        return {
            error: true,
            message: '[AI: No prompt provided]'
        };
    }
    
    const model = selectModel(streamer);
    const maxTokens = getTokenLimit(model);
    
    const messages = constructSystemMessages(streamer, userContext, prompt, 'command');
    
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://domdimabot.com',
        'X-Title': 'DomDimaBot'
    };
    
    const body = {
        model: model,
        messages: messages,
        max_tokens: maxTokens,
        usage: {
            include: true
        }
    };
    
    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: headers as Record<string, string>,
            body: JSON.stringify(body)
        });
        
        const data: OpenRouterResponse = await response.json();

        if (data.error) {
            await error({ function: 'executeAiCommand', error: 'OpenRouter API error', data: data.error }, { channelId: channelID, destination: 'both' });
            return {
                error: true,
                message: '[AI: Service temporarily unavailable]'
            };
        }
        
        const messageContent = data.choices?.[0]?.message?.content;
        
        if (!messageContent) {
            return {
                error: true,
                message: '[AI: Empty response received]'
            };
        }
        
        const usageData = data.usage;
        
        if (usageData && channelID) {
            try {
                await cacheClient.hIncrBy(`${channelID}:chatbot:usage`, 'total_tokens', usageData.total_tokens || 0);
                await cacheClient.hIncrBy(`${channelID}:chatbot:usage`, 'prompt_tokens', usageData.prompt_tokens || 0);
                await cacheClient.hIncrBy(`${channelID}:chatbot:usage`, 'completion_tokens', usageData.completion_tokens || 0);
                await cacheClient.expire(`${channelID}:chatbot:usage`, generateTimeLeftToNextMonthInSeconds());
                
                await cacheClient.set(`${channelID}:chatbot:command:last`, JSON.stringify({
                    model,
                    prompt: prompt.substring(0, 100),
                    response: messageContent.substring(0, 200),
                    usage: usageData,
                    timestamp: new Date().toISOString()
                }));
            } catch (cacheError) {
                await error({ function: 'executeAiCommand', error: 'Cache error tracking AI usage', err: cacheError instanceof Error ? cacheError.message : String(cacheError) }, { channelId: channelID, destination: 'both' });
            }
        }

        const actualCost = (usageData?.cost_details?.upstream_inference_prompt_cost || 0) + 
                          (usageData?.cost_details?.upstream_inference_completions_cost || 0);

        if (streamer.polar_sh_customer_id) {
            ingestPolarSHEvent({
                customerId: streamer.polar_sh_customer_id,
                channelID: channelID,
                cost: actualCost,
                reason: reason,
                llm: {
                    model: model,
                    usage: usageData as any
                },
                mode: 'batch'
            });
        }
        
        const sanitizedOutput = sanitizeOutput(messageContent);
        
        return {
            error: false,
            message: sanitizedOutput
        };

    } catch (fetchError) {
        await error({ function: 'executeAiCommand', error: 'OpenRouter fetch error', err: fetchError instanceof Error ? fetchError.message : String(fetchError) }, { channelId: channelID, destination: 'both' });
        return {
            error: true,
            message: '[AI: Connection error]'
        };
    }
}

/**
 * Gets model information for a given streamer tier.
 * Useful for displaying to users what model they're using.
 * 
 * @param streamer - Streamer object from cache
 * @returns Model info
 */
export function getModelInfo(streamer: IStreamerData | null | undefined): ModelInfo {
    const model = selectModel(streamer);
    let tier: 'free' | 'premium' | 'pro' = 'free';
    
    if (streamer?.plan_tier === 'pro') {
        tier = 'pro';
    } else if (streamer?.plan_tier === 'premium') {
        tier = 'premium';
    }
    
    return {
        model,
        tier,
        maxTokens: getTokenLimit(model)
    };
}
