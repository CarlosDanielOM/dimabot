/**
 * AI Sandbox Module
 * 
 * Provides a secure sandboxed environment for executing AI-generated code
 * with managed fetch access and Redis-backed queueing.
 * 
 * @example
 * // Direct execution (no queue)
 * const { runSandbox } = require('./util/ai/sandbox/index.js');
 * 
 * const result = await runSandbox(`
 *   const response = await fetch('https://api.example.com/data', {
 *     headers: { 'Authorization': 'Bearer ' + env.AUTH_TOKEN }
 *   });
 *   return response.body;
 * `, {
 *   env: { AUTH_TOKEN: 'your-token' }
 * });
 * 
 * @example
 * // Queued execution (recommended for high load)
 * const { createSandboxQueue } = require('./util/ai/sandbox/index.js');
 * const dragonfly = require('./util/database/dragonfly.js');
 * 
 * const queue = createSandboxQueue(dragonfly.getClient());
 * const result = await queue.execute(code, { AUTH_TOKEN: 'token' });
 */

const { runSandbox, createSandbox } = require('./sandbox.js');
const { createSandboxQueue } = require('./queue.js');
const { createPolicyValidator, parseDocLLM, validateRequest } = require('./policy.js');

module.exports = {
    runSandbox,
    createSandbox,
    createSandboxQueue,
    createPolicyValidator,
    parseDocLLM,
    validateRequest
};
