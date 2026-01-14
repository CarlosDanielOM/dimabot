/**
 * AI Command Handler for $(ai) Commands
 * 
 * This module handles one-off AI command executions with tiered model selection.
 * Uses Nitro models for faster response times and includes command injection sanitization.
 */

require('dotenv').config();
const { constructSystemMessages } = require('../prompts');
const { getClient } = require('../../database/dragonfly');
const { ingestPolarSHEvent } = require('../../polarsh');

// ============================================================================
// MODEL CONFIGURATION - Tiered Nitro Models
// ============================================================================

/**
 * Model tiers for different subscription levels.
 * All use :nitro suffix for faster inference.
 */
const MODELS = {
    free: 'sao10k/l3-lunaris-8b:nitro',
    premium: 'nousresearch/hermes-4-70b:nitro',
    pro: 'moonshotai/kimi-k2-thinking:nitro'
};

/**
 * Token limits based on model type.
 * Kimi (Pro) needs more tokens to allow for "thinking" process.
 */
const TOKEN_LIMITS = {
    default: 500,
    'moonshotai/kimi-k2-thinking:nitro': 5000
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Determines the appropriate model based on streamer's subscription tier.
 * 
 * @param {object} streamer - Streamer object from cache
 * @returns {string} - Model identifier for OpenRouter
 */
function selectModel(streamer) {
    // Check subscription tiers (stored as strings 'true'/'false' in cache)
    if (streamer?.premium_plus === 'true' || streamer?.premium_plus === true) {
        return MODELS.pro;
    }
    if (streamer?.premium === 'true' || streamer?.premium === true) {
        return MODELS.premium;
    }
    return MODELS.free;
}

/**
 * Gets the appropriate max_tokens limit for a model.
 * 
 * @param {string} model - Model identifier
 * @returns {number} - Maximum tokens for completion
 */
function getTokenLimit(model) {
    return TOKEN_LIMITS[model] || TOKEN_LIMITS.default;
}

/**
 * Sanitizes AI output to prevent command injection.
 * CRITICAL: Escapes $, %, and * to prevent recursive command parsing.
 * 
 * @param {string} output - Raw AI response
 * @returns {string} - Sanitized output safe for command handler
 */
function sanitizeOutput(output) {
    if (typeof output !== 'string') return String(output || '');
    
    return output
        .replace(/\$/g, '\\$')
        .replace(/%/g, '\\%')
        .replace(/\*/g, '\\*');
}

/**
 * Calculates seconds until the next month for cache expiration.
 * 
 * @returns {number} - Seconds until next month
 */
function generateTimeLeftToNextMonthInSeconds() {
    const now = new Date();
    const dayOfMonth = now.getDate();
    const timeLeft = 30 - dayOfMonth;
    
    const timeLeftInSeconds = timeLeft * 24 * 3600 - 
        now.getHours() * 3600 - 
        now.getMinutes() * 60 - 
        now.getSeconds();
    
    return Math.max(timeLeftInSeconds, 3600); // Minimum 1 hour
}

// ============================================================================
// MAIN COMMAND HANDLER
// ============================================================================

/**
 * Executes an AI command for $(ai prompt) syntax.
 * 
 * @param {object} streamer - Streamer object from cache
 * @param {object} userContext - User context object
 * @param {string} userContext.username - Username of the person invoking the command
 * @param {string} userContext.badges - Optional formatted badge string
 * @param {string} prompt - The prompt text to send to the AI
 * @param {string} reason - The reason for the AI command (default: 'commands')
 * @returns {Promise<{error: boolean, message: string}>} - Result object
 */
async function executeAiCommand(streamer, userContext, prompt, reason = 'commands') {
    const cacheClient = getClient();
    const channelID = streamer?.user_id;
    
    // Validate prompt
    if (!prompt || prompt.trim() === '') {
        return {
            error: true,
            message: '[AI: No prompt provided]'
        };
    }
    
    // Select model based on streamer tier
    const model = selectModel(streamer);
    const maxTokens = getTokenLimit(model);
    
    // Construct messages using shared utility
    const messages = constructSystemMessages(streamer, userContext, prompt, 'command');
    
    // API headers
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://domdimabot.com',
        'X-Title': 'DomDimaBot'
    };
    
    // Request body
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
            headers: headers,
            body: JSON.stringify(body)
        });
        
        const data = await response.json();
        
        // Handle API errors
        if (data.error) {
            console.error('OpenRouter API error:', data.error);
            return {
                error: true,
                message: '[AI: Service temporarily unavailable]'
            };
        }
        
        // Extract the response content
        const messageContent = data.choices?.[0]?.message?.content;
        
        if (!messageContent) {
            return {
                error: true,
                message: '[AI: Empty response received]'
            };
        }
        
        // Track usage if available
        const usageData = data.usage;
        let aiUsage = data.usage;
        if (usageData && channelID) {
            try {
                await cacheClient.hincrby(`${channelID}:chatbot:usage`, 'total_tokens', usageData.total_tokens || 0);
                await cacheClient.hincrby(`${channelID}:chatbot:usage`, 'prompt_tokens', usageData.prompt_tokens || 0);
                await cacheClient.hincrby(`${channelID}:chatbot:usage`, 'completion_tokens', usageData.completion_tokens || 0);
                await cacheClient.expire(`${channelID}:chatbot:usage`, generateTimeLeftToNextMonthInSeconds());
                
                // Store last response for debugging
                await cacheClient.set(`${channelID}:chatbot:command:last`, JSON.stringify({
                    model,
                    prompt: prompt.substring(0, 100), // Truncate for storage
                    response: messageContent.substring(0, 200),
                    usage: usageData,
                    timestamp: new Date().toISOString()
                }));
            } catch (cacheError) {
                console.error('Cache error tracking AI usage:', cacheError);
                // Don't fail the request due to cache issues
            }
        }

        let actualCost = (aiUsage?.cost_details?.upstream_inference_prompt_cost || 0) + (aiUsage?.cost_details?.upstream_inference_completions_cost || 0);

        if(streamer.polar_sh_customer_id) {
            ingestPolarSHEvent({
                customerId: streamer.polar_sh_customer_id,
                channelID: channelID,
                cost: actualCost,
                reason: reason,
                llm: {
                    model: model,
                    usage: aiUsage
                },
                mode: 'batch'
            });
        }
        
        // CRITICAL: Sanitize output to prevent command injection
        const sanitizedOutput = sanitizeOutput(messageContent);
        
        return {
            error: false,
            message: sanitizedOutput
        };
        
    } catch (fetchError) {
        console.error('OpenRouter fetch error:', fetchError);
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
 * @param {object} streamer - Streamer object from cache
 * @returns {{model: string, tier: string, maxTokens: number}} - Model info
 */
function getModelInfo(streamer) {
    const model = selectModel(streamer);
    let tier = 'free';
    
    if (streamer?.premium_plus === 'true' || streamer?.premium_plus === true) {
        tier = 'pro';
    } else if (streamer?.premium === 'true' || streamer?.premium === true) {
        tier = 'premium';
    }
    
    return {
        model,
        tier,
        maxTokens: getTokenLimit(model)
    };
}

module.exports = {
    executeAiCommand,
    getModelInfo,
    selectModel,
    sanitizeOutput,
    MODELS,
    TOKEN_LIMITS
};
