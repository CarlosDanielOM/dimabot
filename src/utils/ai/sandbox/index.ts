/**
 * AI Sandbox Module
 * Provides a secure Deno-based environment for executing AI-generated code.
 * Concurrency is automatically managed (max 25) via p-limit.
 *
 * @example
 * import { executeAiCode } from './utils/ai/sandbox';
 * const result = await executeAiCode(`
 *   const response = await fetch('https://api.twitch.tv/...');
 *   console.log(await response.json());
 * `, {
 *   CLIENT_ID: '...'
 * });
 */

export { executeAiCode, runDenoProcess } from './execute_sandbox.ai.js';
export type { SandboxEnv, DenoResult } from './execute_sandbox.ai.js';
