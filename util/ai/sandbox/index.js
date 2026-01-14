/**
 * AI Sandbox Module
 * 
 * Provides a secure sandboxed environment for executing AI-generated code
 * with managed fetch access and Redis-backed queueing.
 * 
 * @example
 * // Direct execution (no queue)
 * import { runSandbox } from './util/ai/sandbox/index.js';
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
 * import { createSandboxQueue } from './util/ai/sandbox/index.js';
 * import dragonfly from './util/database/dragonfly.js';
 * 
 * const queue = createSandboxQueue(dragonfly.getClient());
 * const result = await queue.execute(code, { AUTH_TOKEN: 'token' });
 */

export { runSandbox, createSandbox } from './sandbox.js';
export { createSandboxQueue } from './queue.js';
export { createPolicyValidator, parseDocLLM, validateRequest } from './policy.js';

// Default export for convenience
import { runSandbox, createSandbox } from './sandbox.js';
import { createSandboxQueue } from './queue.js';
import { createPolicyValidator } from './policy.js';

export default {
    runSandbox,
    createSandbox,
    createSandboxQueue,
    createPolicyValidator
};
