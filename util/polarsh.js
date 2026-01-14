require('dotenv').config();
const POLARSH = require('@polar-sh/sdk')
const { getClient } = require('./database/dragonfly');

let polarshClient = null;

function getPolarShClient() {
    if(polarshClient) return polarshClient;

    if(!process.env.POLARSH_OAT) throw new Error('POLARSH_OAT is not set');

    polarshClient = new POLARSH.Polar({
        accessToken: process.env.POLARSH_OAT
    });

    return polarshClient;
}

/**
 * Ingest PolarSH usage event
 * @param {Object} options
 * @param {string} options.customerId - PolarSH customer ID
 * @param {string} [options.channelID] - Channel ID (for cache key, required for batch/cache modes)
 * @param {number} options.cost - Cost in dollars (will be converted to cents for _cost metadata)
 * @param {string} options.reason - Usage reason ('planner', 'router', 'messages', etc.)
 * @param {Object} [options.llm] - Optional LLM metadata
 * @param {string} [options.llm.model] - Full model string (e.g., 'openai/gpt-4')
 * @param {Object} [options.llm.usage] - Token usage object with prompt_tokens, completion_tokens, total_tokens
 * @param {'immediate'|'batch'|'cache'} [options.mode='batch'] - Ingest mode
 *   - immediate: Direct ingest without caching (for simple events like free credits)
 *   - batch: Add to cache, ingest all cached events, clear cache (for final AI responses)
 *   - cache: Only add to cache for later processing (for intermediate AI steps)
 * @returns {Promise<{error: boolean, message?: string}>}
 */
async function ingestPolarSHEvent(options) {
    const { customerId, channelID, cost, reason, llm, mode = 'batch' } = options;

    if (!customerId) {
        return { error: true, message: 'customerId is required' };
    }

    if ((mode === 'batch' || mode === 'cache') && !channelID) {
        return { error: true, message: 'channelID is required for batch/cache modes' };
    }

    try {
        const cacheClient = getClient();
        const cacheKey = `${channelID}:ai:polarshevent`;

        // Build event data
        let eventData = {
            name: 'ai_usage',
            customerId: customerId,
            metadata: {
                cost: cost,
                currency: 'usd',
                reason: reason
            }
        };

        // Add LLM metadata if provided
        if (llm) {
            // Calculate amount and cost values with truncation (cost is in dollars, amount is in cents)
            let amountValue = Math.round(cost * 100 * 1e10) / 1e10; // Round to 10 decimal places
            let amountStr = amountValue.toString();
            if (amountStr.length > 17) {
                amountStr = amountStr.substring(0, 17);
                amountValue = parseFloat(amountStr);
            }

            let costValue = Math.round(cost * 100 * 1e8) / 1e8; // Round to 8 decimal places
            let costStr = costValue.toString();
            if (costStr.length > 12) {
                costStr = costStr.substring(0, 12);
                costValue = parseFloat(costStr);
            }

            // Parse model string (format: 'vendor/model:version' or 'vendor/model')
            let vendor = 'unknown';
            let modelName = llm.model || 'unknown';
            if (llm.model) {
                const parts = llm.model.split('/');
                vendor = parts[0] || 'unknown';
                const actualModel = parts[1] || llm.model;
                modelName = actualModel.split(':')[0];
            }

            eventData.metadata = {
                _cost: {
                    amount: amountValue,
                    currency: 'usd'
                },
                _llm: {
                    vendor: vendor,
                    model: modelName,
                    inputTokens: llm.usage?.prompt_tokens || 0,
                    outputTokens: llm.usage?.completion_tokens || 0,
                    totalTokens: llm.usage?.total_tokens || 0,
                },
                cost: costValue,
                currency: 'usd',
                reason: reason
            };
        }

        // Handle different modes
        if (mode === 'immediate') {
            // Direct ingest without caching
            const polarshClient = getPolarShClient();
            const ingestResult = await polarshClient.events.ingest({
                events: [eventData]
            });

            if (ingestResult.error) {
                return { error: true, message: 'PolarSH ingest error', details: ingestResult };
            }

            return { error: false };
        }

        // For batch and cache modes, we need to work with cached events
        let ingestData = [];
        const storedEvents = await cacheClient.get(cacheKey);
        try {
            ingestData = storedEvents ? JSON.parse(storedEvents) : [];
        } catch (e) {
            console.error('Failed to parse stored AI events:', e);
            ingestData = [];
        }

        ingestData.push(eventData);

        if (mode === 'cache') {
            // Only save to cache for later processing
            await cacheClient.set(cacheKey, JSON.stringify(ingestData));
            return { error: false };
        }

        // mode === 'batch': Add to cache, ingest all, and clear cache
        const polarshClient = getPolarShClient();
        
        polarshClient.events.ingest({
            events: ingestData
        }).then(() => {
            cacheClient.del(cacheKey);
        }).catch((error) => {
            console.error('PolarSH ingest error:', error);
        });

        return { error: false };

    } catch (error) {
        console.error('PolarSH ingest error:', error);
        return { error: true, message: error.message };
    }
}

module.exports = {
    getPolarShClient,
    ingestPolarSHEvent
}