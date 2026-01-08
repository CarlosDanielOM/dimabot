/**
 * AI Chat Response Handler
 * 
 * This module handles chat-based AI interactions (@bot conversations).
 * Uses the shared prompts.js utility for consistent personality construction.
 * Preserves chat history context and tool integration.
 */

require('dotenv').config();
const STREAMERS = require('../../../class/streamer');
const AIPersonality = require('../../../schema/channelAIPersonality');
const formatBadges = require('../../badges');
const { getClient } = require('../../database/dragonfly');
const { getPolarShClient } = require('../../polarsh');
const { constructChatSystemMessages } = require('../prompts');

// ============================================================================
// MODEL CONFIGURATION - Tiered Nitro Models (Same as command.js)
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
 * Retrieves or creates the channel's AI personality configuration.
 * Uses cache for performance, falls back to DB.
 * 
 * @param {string} channelID - The channel's Twitch user ID
 * @returns {Promise<object>} - The personality configuration
 */
async function getChannelPersonality(channelID) {
    const cacheClient = getClient();
    const streamer = await STREAMERS.getStreamerById(channelID);
    
    // Try cache first
    let personality = await cacheClient.get(`${channelID}:chatbot:personality`);
    if (personality) {
        return JSON.parse(personality);
    }
    
    // Try database
    personality = await AIPersonality.findOne({ channelID: channelID });
    if (personality) {
        await cacheClient.set(`${channelID}:chatbot:personality`, JSON.stringify(personality));
        return personality;
    }
    
    // Create default personality for new channels
    personality = await AIPersonality.create({
        channelID,
        channel: streamer?.name || 'Unknown',
        contextWindow: streamer?.premium_plus === 'true' ? 15 : (streamer?.premium === 'true' ? 7 : 3),
        personality: `You are a friendly and playful Twitch chat moderator for ${streamer?.name || 'this channel'}. You speak in Spanish by default but can adapt to other languages. You have a good sense of humor and enjoy interacting with chat users. You maintain a fun and engaging atmosphere while still being able to moderate when necessary.`,
        rules: ["Be respectful and friendly with users"],
        knownUsers: [
            {
                username: 'cdom201',
                description: 'Creator, Owner and Developer of you, the bot',
                relationship: 'professional',
                lastInteraction: new Date()
            }
        ],
    });
    
    if (personality) {
        await cacheClient.set(`${channelID}:chatbot:personality`, JSON.stringify(personality));
    }
    
    return personality;
}

/**
 * Determines the appropriate model based on streamer's subscription tier.
 * 
 * @param {object} streamer - Streamer object from cache
 * @returns {string} - Model identifier for OpenRouter
 */
function selectModel(streamer) {
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
        now.getSeconds() - 
        now.getMilliseconds();

    return Math.max(timeLeftInSeconds, 3600); // Minimum 1 hour
}

// ============================================================================
// MAIN CHAT HANDLER
// ============================================================================

/**
 * Generates an AI response for chat-based interactions.
 * Uses the shared prompts utility for system message construction.
 * 
 * @param {string} channelID - The channel's Twitch user ID
 * @param {string} message - The user's message
 * @param {string} model - Optional model override (defaults to tier-based selection)
 * @param {Array} context - Chat history for context
 * @param {object} tags - Twitch IRC tags for the user
 * @param {Array} options - Additional API options
 * @param {Array} toolContext - Tool context (e.g., search results)
 * @returns {Promise<string|object>} - AI response or error object
 */
async function AiResponse(channelID, message, model = null, context = [], tags = {}, options = [], toolContext = []) {
    const cacheClient = getClient();
    
    // Get streamer and personality data
    const streamer = await STREAMERS.getStreamerById(channelID);
    const personality = await getChannelPersonality(channelID);
    
    // Handle missing personality (fallback)
    const effectivePersonality = personality || {
        personality: `You are a friendly and playful Twitch chat moderator for this channel. You speak in Spanish by default but can adapt to other languages. You have a good sense of humor and enjoy interacting with chat users. You maintain a fun and engaging atmosphere while still being able to moderate when necessary.`,
        rules: ["Be respectful and friendly with users"],
        knownUsers: [
            {
                username: 'cdom201',
                description: 'Creator, Owner and Developer of you, the bot',
                relationship: 'professional',
                lastInteraction: new Date()
            }
        ]
    };
    
    // Select model based on streamer tier if not explicitly provided
    const selectedModel = model || selectModel(streamer);
    const maxTokens = getTokenLimit(selectedModel);
    
    // Build user context from Twitch tags
    const userBadges = formatBadges(tags);
    const userContext = {
        username: tags.username || tags['display-name'] || 'Anonymous',
        badges: userBadges
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
    
    // API headers - consistent with DomDimaBot branding
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://domdimabot.com',
        'X-Title': 'DomDimaBot',
        'X-Description': 'DomDimaBot is a Twitch chat bot that helps make streams more engaging and fun.'
    };
    
    // Build request body
    const body = {
        model: selectedModel,
        messages: messages,
        max_tokens: maxTokens
    };
    
    // Apply additional options if provided
    if (options && options.length > 0) {
        for (const option of options) {
            if (typeof option === 'object') {
                for (const [key, value] of Object.entries(option)) {
                    body[key] = value;
                }
            }
        }
    }
    
    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        });
        
        const data = await response.json();
        
        // Handle API errors
        if (data.error) {
            return {
                error: true,
                message: data.message || 'API error occurred',
                status: data.status,
                type: data.error
            };
        }
        
        const messageData = data.choices?.[0]?.message;
        const usageData = data.usage || {};
        
        // Store last response for debugging
        if (channelID) {
            await cacheClient.set(`${channelID}:chatbot:response:last`, JSON.stringify({
                messageData,
                usageData,
                model: selectedModel,
                timestamp: new Date().toISOString()
            }));
        }

        let aiUsage = data.usage;
        // Track usage statistics
        if (usageData && channelID) {
            try {
                await cacheClient.hincrby(`${channelID}:chatbot:usage`, 'total_tokens', usageData.total_tokens || 0);
                await cacheClient.hincrby(`${channelID}:chatbot:usage`, 'prompt_tokens', usageData.prompt_tokens || 0);
                await cacheClient.hincrby(`${channelID}:chatbot:usage`, 'completion_tokens', usageData.completion_tokens || 0);
                await cacheClient.expire(`${channelID}:chatbot:usage`, generateTimeLeftToNextMonthInSeconds());
            } catch (cacheError) {
                console.error('Cache error tracking AI usage:', cacheError);
            }
        }

        let actualCost = (aiUsage?.cost_details?.upstream_inference_prompt_cost || 0) + (aiUsage?.cost_details?.upstream_inference_completions_cost || 0);
        
        let storedEvents = await cacheClient.get(`${channelID}:ai:polarshevent`);
        let ingestData = [];
        try {
            ingestData = storedEvents ? JSON.parse(storedEvents) : [];
        } catch (e) {
            console.error('Failed to parse stored AI events:', e);
            ingestData = [];
        }

        let provider = selectedModel.split('/')[0];
        let actualModel = selectedModel.split('/')[1];
        let modelName = actualModel.split(':')[0];

        if(streamer.polar_sh_customer_id) {
        
            let eventData = {
                name: 'ai_usage',
                customerId: streamer.polar_sh_customer_id,
                metadata: {
                    _cost: {
                        "amount": actualCost * 100,
                        "currency": "USD"
                    },
                    _llm: {
                        vendor: provider,
                        model: modelName,
                        input_tokens: aiUsage?.prompt_tokens || 0,
                        output_tokens: aiUsage?.completion_tokens || 0,
                        total_tokens: aiUsage?.total_tokens || 0,
                    },
                    cost: actualCost * 100,
                    currency: 'USD'
                }
            }

            ingestData.push(eventData);

            let polarshClient = getPolarShClient();

            polarshClient.events.ingest({
                events: ingestData
            }).then(() => {
                cacheClient.del(`${channelID}:ai:polarshevent`);
            }).catch((error) => {
                console.error('PolarSH ingest error:', error);
            });
        }

        return messageData?.content || '';
        
    } catch (fetchError) {
        console.error('OpenRouter fetch error:', fetchError);
        return {
            error: true,
            message: 'Connection error',
            status: 500,
            type: 'fetch_error'
        };
    }
}

module.exports = {
    AiResponse,
    getChannelPersonality,
    selectModel,
    MODELS,
    TOKEN_LIMITS
};
