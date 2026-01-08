const { getClient } = require('../../database/dragonfly');
const logger = require('../../logger');
const { AiResponse, selectModel, MODELS } = require('./messages');

require('dotenv').config();

/**
 * AI Router with tool integration (search, etc.)
 * Routes messages through decision-making and tool execution before final response.
 * Uses tiered Nitro models for faster inference.
 */
async function router(channelID, message, preset = '@preset/router', history = [], tags = {}, options = [], streamer) {
    const cacheClient = getClient();
    let toolContext = [];
    
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://domdimabot.com',
        'X-Title': 'DomDimaBot',
        'X-Description': 'DomDimaBot is a Twitch chat bot that helps make streams more engaging and fun.'
    };

    const now = new Date();
    const date = now.toLocaleString('en-US', { timeZone: 'UTC' });

    // First pass: determine if tools are needed
    let response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
            model: preset,
            messages: [
                {
                    role: 'user',
                    content: `[${date}] ${message}`
                }
            ],
            response_format: { type: 'json_object' },
            user: `${channelID}`,
            usage: {
                'include': true
            }
        })
    });

    let data = await response.json();
    if (data.error) {
        return {
            error: true,
            message: data.message,
            status: data.status,
            type: data.error
        };
    }

    console.log(data.usage);

    let aiUsage = data.usage;

    //? add the prompt cost to usage cost to get actual cost before vendor discounts to company
    let actualCost = (aiUsage?.cost_details?.upstream_inference_prompt_cost || 0) + (aiUsage?.cost_details?.upstream_inference_completions_cost || 0);

    if(streamer.polar_sh_customer_id) {
        let ingestData = [];
        let eventData = {
            name: 'ai_usage',
            customerId: streamer.polar_sh_customer_id,
            metadata: {
                _cost: {
                    "amount": actualCost * 100,
                    "currency": "USD"
                },
                _llm: {
                    vendor: 'openai',
                    model: 'gpt-oss-20b',
                    input_tokens: aiUsage?.prompt_tokens || 0,
                    output_tokens: aiUsage?.completion_tokens || 0,
                    total_tokens: aiUsage?.total_tokens || 0,
                },
                cost: actualCost * 100,
                currency: 'USD'
            }
        }

        ingestData.push(eventData);

        await cacheClient.set(`${channelID}:ai:polarshevent`, JSON.stringify(ingestData));
    }

    let aiDecision;
    try {
        aiDecision = JSON.parse(data.choices[0].message.content);
    } catch (parseError) {
        console.error('Failed to parse AI decision:', parseError);
        aiDecision = { action: 'respond' };
    }

    // Execute tool if search action requested
    if (aiDecision.action === 'search') {
        const queries = new URLSearchParams();
        queries.append('q', aiDecision.query);
        queries.append('format', 'json');

        try {
            const results = await fetch('https://search.myhomelab.wtf/search?' + queries);
            const resultsData = await results.json();

            if (!resultsData.error && resultsData.results) {
                const searchResults = resultsData.results.slice(0, 3).map(result => ({
                    title: result.title,
                    url: result.url,
                    content: result.content,
                    score: result.score
                }));

                toolContext.push({
                    name: 'search',
                    context: searchResults
                });
            }
        } catch (searchError) {
            console.error('Search tool error:', searchError);
            // Continue without search results
        }
    }

    // Select model based on streamer tier - use Nitro models
    const model = selectModel(streamer);

    // Get AI response with tool context
    const AiAnswer = await AiResponse(channelID, message, model, history, tags, options, toolContext);

    // Handle error responses from AiResponse
    if (AiAnswer && typeof AiAnswer === 'object' && AiAnswer.error) {
        return AiAnswer;
    }

    return {
        error: false,
        message: AiAnswer
    };
}

module.exports = router;