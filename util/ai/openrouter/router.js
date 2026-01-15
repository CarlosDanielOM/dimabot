const { getClient } = require('../../database/dragonfly');
const logger = require('../../logger');
const { AiResponse, selectModel, MODELS } = require('./messages');
const { ingestPolarSHEvent } = require('../../polarsh');
const sendChatMessage = require('../../../function/chat/sendmessage');
const path = require('path');
const fs = require('fs');

require('dotenv').config();

// ============================================================================
// CODING MODELS CONFIGURATION
// ============================================================================

/**
 * Model tiers for code generation tasks.
 * These models are optimized for generating executable code.
 */
const CODING_MODELS = {
    pro: 'google/gemini-2.5-flash-lite',
    premium: 'google/gemini-2.5-flash-lite',
    free: 'z-ai/glm-4.5-air:nitro',
    exhausted: 'z-ai/glm-4.5-air'
};

/**
 * Selects the appropriate coding model based on streamer tier.
 * @param {object} streamer - Streamer object from cache
 * @param {boolean} isExhausted - Whether AI credits are exhausted
 * @returns {string} - Model identifier for OpenRouter
 */
function selectCodingModel(streamer, isExhausted = false) {
    if (isExhausted) {
        return CODING_MODELS.exhausted;
    }
    if (streamer?.premium_plus === 'true' || streamer?.premium_plus === true) {
        return CODING_MODELS.pro;
    }
    if (streamer?.premium === 'true' || streamer?.premium === true) {
        return CODING_MODELS.premium;
    }
    return CODING_MODELS.free;
}

/**
 * Checks if the streamer is Pro tier (premium_plus)
 * @param {object} streamer - Streamer object
 * @returns {boolean}
 */
function isProTier(streamer) {
    return streamer?.premium_plus === 'true' || streamer?.premium_plus === true;
}

// ============================================================================
// API DOCUMENTATION LOADER
// ============================================================================

/**
 * Loads the doc-llm.txt API documentation for code generation prompts.
 * @returns {string} - The API documentation content
 */
function loadApiDocumentation() {
    try {
        const docPath = path.join(__dirname, '../sandbox/doc-llm.txt');
        return fs.readFileSync(docPath, 'utf-8');
    } catch (error) {
        console.error('[Router] Failed to load API documentation:', error.message);
        return '';
    }
}

// ============================================================================
// CODE PLANNING (Pro Tier Only)
// ============================================================================

/**
 * Generates a structured code plan for Pro tier users.
 * This improves code quality by thinking through the problem first.
 * 
 * @param {string} channelID - The channel ID
 * @param {string} userRequest - The user's request
 * @param {string} model - The coding model to use
 * @param {object} streamer - Streamer object
 * @returns {Promise<{plan: string, error: string|null}>}
 */
async function generateCodePlan(channelID, userRequest, model, streamer) {
    const cacheClient = getClient();
    const apiDocs = loadApiDocumentation();
    
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://domdimabot.com',
        'X-Title': 'DomDimaBot'
    };

    const systemPrompt = `You are a code planning assistant for DomDimaBot, a Twitch chat bot.
Your task is to create a structured plan for code that will be executed in a secure sandbox environment.

## Available Environment Variables
The sandbox has access to these environment variables via \`env\`:
- env.CHANNEL_ID - The Twitch channel ID
- env.CHANNEL_NAME - The Twitch channel name
- env.AUTH_TOKEN - Bearer token for API authentication

## Available API Endpoints
${apiDocs}

## Your Task
Analyze the user's request and create a step-by-step plan that includes:
CRITICAL DECISION: 
- If user wants a command, use the commands endpoint (command, comando, cmd, func, function, funcion)
- If user wants a trigger, use the triggers endpoint (trigger, alerta, alert, cost, prompt, description, descripcion, message, mensaje)
- If user wants an event, use the events endpoint
- If user wants a reward, use the rewards endpoint (reward, canje, points, channel points, redeem, canjear, canjeo, reclamar, cost, prompt, description, descripcion, message, mensaje)

1. Which API endpoints to use
2. The order of operations
3. How to handle the data
4. What to return as the final result

Keep the plan concise but complete. Focus on practical implementation steps.`;

    const userPrompt = `Create a code execution plan for this request:

"${userRequest}"

Provide a structured plan with clear steps.`;

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                user: `${channelID}`,
                usage: {
                    'include': true
                }
            })
        });

        const data = await response.json();
        
        if (data.error) {
            return { plan: null, error: data.error.message || 'Planning failed' };
        }

        // Track Polar.sh usage for code planning
        if (streamer?.polar_sh_customer_id && data.usage) {
            const aiUsage = data.usage;
            const actualCost = (aiUsage?.cost_details?.upstream_inference_prompt_cost || 0) + 
                              (aiUsage?.cost_details?.upstream_inference_completions_cost || 0);

            await ingestPolarSHEvent({
                customerId: streamer.polar_sh_customer_id,
                channelID: channelID,
                cost: actualCost,
                reason: 'planner',
                llm: {
                    model: model,
                    usage: aiUsage
                },
                mode: 'cache'
            });
        }

        const plan = data.choices?.[0]?.message?.content || '';

        logger({
            type: 'sandbox-planning',
            channelID: channelID,
            request: userRequest,
            plan: plan,
            error: null
        }, true, channelID, 'sandbox-planning', false);
        
        return { plan, error: null };
    } catch (error) {
        console.error('[Router] Code planning error:', error);
        return { plan: null, error: error.message };
    }
}

// ============================================================================
// CODE GENERATION
// ============================================================================

/**
 * Generates executable JavaScript code for the sandbox.
 * 
 * @param {string} channelID - The channel ID
 * @param {string} userRequest - The user's original request
 * @param {string} model - The coding model to use
 * @param {string|null} plan - Optional plan from Pro tier planning step
 * @param {object} streamer - Streamer object
 * @returns {Promise<{code: string, error: string|null}>}
 */
async function generateCode(channelID, userRequest, model, plan = null, streamer = null) {
    const cacheClient = getClient();
    const apiDocs = loadApiDocumentation();
    
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://domdimabot.com',
        'X-Title': 'DomDimaBot'
    };

    let systemPrompt = `You are a code generation assistant for DomDimaBot, a Twitch chat bot.
Generate JavaScript code that will run in a secure sandbox environment.

## Sandbox Environment
The sandbox provides:
- \`fetch(url, options)\` - Make HTTP requests (only to allowed endpoints)
- \`console.log(...args)\` - Log messages (captured for debugging)
- \`env\` object with environment variables

## Available Environment Variables
- env.CHANNEL_ID - The Twitch channel ID (use this in API URLs)
- env.CHANNEL_NAME - The Twitch channel name
- env.AUTH_TOKEN - Bearer token for API authentication (use in headers)

## Available API Endpoints
${apiDocs}

## Code Requirements
1. Use \`fetch\` for all API calls
2. Use \`env.AUTH_TOKEN\` in Authorization headers: \`Authorization: Bearer \${env.AUTH_TOKEN}\`
3. Replace :channelID in URLs with \`env.CHANNEL_ID\`
4. Always return a result using \`return\` statement
5. Handle errors gracefully
6. The code runs in an async context, so you can use await directly
7. IMPORTANT: Always check that you are using the correct endpoint
    - If user wants a command, use the commands endpoint
    - If user wants a trigger, use the triggers endpoint
    - If user wants an event, use the events endpoint
    - If user wants a reward, use the rewards endpoint

## Example Code
\`\`\`javascript
// Fetch all commands for the channel
const response = await fetch(\`https://api.domdimabot.com/command/\${env.CHANNEL_ID}\`, {
    method: 'GET',
    headers: {
        'Authorization': \`Bearer \${env.AUTH_TOKEN}\`
    }
});

if (!response.ok) {
    return { error: true, message: 'Failed to fetch commands', reason: 'missing authorization token' };
}

const commands = response.body;
return { success: true, commandCount: commands.length };
\`\`\`

## Output Format
Return ONLY the JavaScript code, no markdown code blocks, no explanations.
The code should be ready to execute directly.`;

    let userPrompt = `Generate JavaScript code for this request:

"${userRequest}"`;

    // Add plan context if available (Pro tier)
    if (plan) {
        userPrompt += `

## Execution Plan
Follow this plan when generating the code:

${plan}`;
    }

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                max_tokens: 10000,
                user: `${channelID}`,
                usage: {
                    'include': true
                }
            })
        });

        const data = await response.json();
        
        if (data.error) {
            return { code: null, error: data.error.message || 'Code generation failed' };
        }

        // Track Polar.sh usage for code generation
        if (streamer?.polar_sh_customer_id && data.usage) {
            const aiUsage = data.usage;
            const actualCost = (aiUsage?.cost_details?.upstream_inference_prompt_cost || 0) + 
                              (aiUsage?.cost_details?.upstream_inference_completions_cost || 0);

            await ingestPolarSHEvent({
                customerId: streamer.polar_sh_customer_id,
                channelID: channelID,
                cost: actualCost,
                reason: 'coding_agent',
                llm: {
                    model: model,
                    usage: aiUsage
                },
                mode: 'cache'
            });
        }

        let code = data.choices?.[0]?.message?.content || '';

        logger({
            type: 'sandbox-generation',
            channelID: channelID,
            request: userRequest,
            code: code,
            plan: plan,
            error: null
        }, true, channelID, 'sandbox-generation', false);
        
        // Clean up the code if it's wrapped in markdown code blocks
        code = code.replace(/^```(?:javascript|js)?\n?/i, '').replace(/\n?```$/i, '').trim();
        
        return { code, error: null };
    } catch (error) {
        console.error('[Router] Code generation error:', error);
        return { code: null, error: error.message };
    }
}

/**
 * Executes code in the secure Deno sandbox.
 * @param {string} code - The JavaScript code to execute
 * @param {string} channelID - The channel ID
 * @param {object} streamer - Streamer object with token
 * @returns {Promise<object>} - Sandbox execution result formatted for Logger
 */
async function executeSandbox(code, channelID, streamer) {
    const startTime = Date.now();
    
    try {
        // 1. Import the new Deno runner
        // Note: Ensure sandbox.js exports 'executeAiCode'
        const { executeAiCode } = require('../sandbox/sandbox.js'); 
        
        // 2. Prepare environment variables
        // We only pass what is strictly needed. 
        // Deno handles security, so no policyPath needed.
        const sandboxEnv = {
            CHANNEL_ID: channelID,
            CHANNEL_NAME: streamer?.name || '',
            AUTH_TOKEN: streamer?.bot_token || '' // Ensure this matches your DB field
        };

        // 3. Execute
        // We strip out memoryLimit/policyPath because Deno + p-limit handles that now.
        const rawOutput = await executeAiCode(code, sandboxEnv);

        // 4. Parse the Result (Attempt to detect JSON vs Text)
        // Your logger expects a 'result' object and 'logs' array.
        // We try to parse the output as JSON for cleaner logging.
        let parsedResult = rawOutput;
        try {
            parsedResult = JSON.parse(rawOutput);
        } catch (e) {
            // It's just plain text/logs
            parsedResult = rawOutput; 
        }

        const resultObj = {
            result: parsedResult,
            logs: [typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput)],
            error: null,
            executionTime: Date.now() - startTime,
            timedOut: false
        };

        // 5. Log Success
        logger({
            type: 'sandbox-execution',
            channelID: channelID,
            code: code,
            result: resultObj.result,
            error: null
        }, true, channelID, 'sandbox-execution', false);

        return resultObj;

    } catch (error) {
        // 6. Log & Return Error
        console.error('[Router] Sandbox execution error:', error);
        
        const errorResult = {
            result: null,
            logs: [],
            error: error.message,
            executionTime: Date.now() - startTime,
            timedOut: error.message.includes('Timed Out')
        };

        // Log the failure too so you can debug AI crashes
        logger({
            type: 'sandbox-execution',
            channelID: channelID,
            code: code,
            result: null,
            error: error.message
        }, true, channelID, 'sandbox-execution', false);

        return errorResult;
    }
}

// ============================================================================
// MAIN ROUTER
// ============================================================================

/**
 * AI Router with tool integration (search, code execution, etc.)
 * Routes messages through decision-making and tool execution before final response.
 * Uses tiered Nitro models for faster inference.
 */
async function router(channelID, message, preset = '@preset/router', history = [], tags = {}, options = [], streamer) {
    const cacheClient = getClient();
    let toolContext = [];

    // Check if user has exhausted AI credits
    const isExhausted = await cacheClient.exists(`${channelID}:ai:exhaust`);
    if (isExhausted) {
        preset = '@preset/router-free';
    }
    
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

    let aiUsage = data.usage;

    //? add the prompt cost to usage cost to get actual cost before vendor discounts to company
    let actualCost = (aiUsage?.cost_details?.upstream_inference_prompt_cost || 0) + (aiUsage?.cost_details?.upstream_inference_completions_cost || 0);

    if(streamer.polar_sh_customer_id) {
        await ingestPolarSHEvent({
            customerId: streamer.polar_sh_customer_id,
            channelID: channelID,
            cost: actualCost,
            reason: 'router',
            llm: {
                model: preset,
                usage: aiUsage
            },
            mode: 'cache'
        });
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

    // Execute code if code action requested
    if (aiDecision.action === 'code') {
        const userRequest = aiDecision.request || aiDecision.query || message;
        const codingModel = selectCodingModel(streamer, isExhausted);
        
        let plan = null;
        let generatedCode = null;
        let sandboxResult = null;

        //? Send message in chat so user knows the bot is working on the request
        // sendChatMessage(channelID, `@${tags.username} Estoy trabajando en tu solicitud...`);

        try {
            // Pro tier: Generate a plan first for better code quality
            if (isProTier(streamer) && !isExhausted) {
                console.log(`[Router] Pro tier detected - generating code plan for channel ${channelID}`);
                sendChatMessage(channelID, `@${tags.username} Creando el plan`);

                const planResult = await generateCodePlan(channelID, userRequest, 'openai/gpt-oss-120b', streamer);
                
                if (planResult.error) {
                    console.error('[Router] Plan generation failed:', planResult.error);
                    // Continue without plan
                } else {
                    plan = planResult.plan;
                    console.log(`[Router] Plan generated successfully`);
                }
            }

            // Generate the code (with or without plan)
            console.log(`[Router] Generating code with model: ${codingModel}`);
            sendChatMessage(channelID, `@${tags.username} Generando el código`);
            const codeResult = await generateCode(channelID, userRequest, codingModel, plan, streamer);
            
            if (codeResult.error) {
                // Log failed code generation with cache for 7 days
                await logger({
                    type: 'sandbox_execution',
                    channelID: channelID,
                    request: userRequest,
                    plan: plan ? plan.substring(0, 500) : null,
                    code: null,
                    result: null,
                    logs: [],
                    error: `Code generation failed: ${codeResult.error}`,
                    executionTime: 0,
                    timedOut: false,
                    success: false,
                    model: codingModel,
                    hadPlan: !!plan,
                    phase: 'generation'
                }, true, channelID, 'sandbox', false);

                toolContext.push({
                    name: 'code_execution',
                    context: {
                        success: false,
                        error: `Code generation failed: ${codeResult.error}`,
                        phase: 'generation'
                    }
                });
            } else {
                generatedCode = codeResult.code;
                console.log(`[Router] Code generated, executing in sandbox...`);

                // Execute the generated code in the sandbox
                sandboxResult = await executeSandbox(generatedCode, channelID, streamer);

                // Log sandbox execution result with cache for 7 days
                console.log(`[Router] Successful sandbox execution - Result: ${sandboxResult.result ? sandboxResult.result.substring(0, 200) + (sandboxResult.result.length > 200 ? '...' : '') : 'null'}, Logs: ${sandboxResult.logs.length} entries, Time: ${sandboxResult.executionTime}ms, Model: ${codingModel}`);

                await logger({
                    type: 'sandbox_execution',
                    channelID: channelID,
                    request: userRequest,
                    plan: plan ? plan.substring(0, 500) : null, // Truncate plan for storage
                    code: generatedCode,
                    result: sandboxResult.result,
                    logs: sandboxResult.logs,
                    error: sandboxResult.error,
                    executionTime: sandboxResult.executionTime,
                    timedOut: sandboxResult.timedOut,
                    success: !sandboxResult.error && !sandboxResult.timedOut,
                    model: codingModel,
                    hadPlan: !!plan
                }, true, channelID, 'sandbox', false);

                // Build the tool context with execution results
                toolContext.push({
                    name: 'code_execution',
                    context: {
                        success: !sandboxResult.error && !sandboxResult.timedOut,
                        result: sandboxResult.result,
                        logs: sandboxResult.logs,
                        error: sandboxResult.error,
                        executionTime: sandboxResult.executionTime,
                        timedOut: sandboxResult.timedOut,
                        phase: 'execution',
                        // Include plan summary for context if available
                        hadPlan: !!plan
                    }
                });

                console.log(`[Router] Sandbox execution completed in ${sandboxResult.executionTime}ms`);
            }
        } catch (codeError) {
            console.error('[Router] Code action error:', codeError);
            
            // Log unexpected errors with cache for 7 days
            await logger({
                type: 'sandbox_execution',
                channelID: channelID,
                request: userRequest,
                plan: plan ? plan.substring(0, 500) : null,
                code: generatedCode,
                result: null,
                logs: [],
                error: codeError.message,
                executionTime: 0,
                timedOut: false,
                success: false,
                model: codingModel,
                hadPlan: !!plan,
                phase: 'unknown'
            }, true, channelID, 'sandbox', false);

            toolContext.push({
                name: 'code_execution',
                context: {
                    success: false,
                    error: codeError.message,
                    phase: 'unknown'
                }
            });
        }
    }

    // Select model based on streamer tier - use Nitro models
    // Override to free model if credits are exhausted
    const model = isExhausted ? MODELS.free : selectModel(streamer);

    // Get AI response with tool context (including code execution results)
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
module.exports.CODING_MODELS = CODING_MODELS;
module.exports.selectCodingModel = selectCodingModel;
