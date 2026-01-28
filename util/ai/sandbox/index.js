/**
 * AI Sandbox Module
 * * Provides a secure Deno-based environment for executing AI-generated code.
 * Concurrency is automatically managed (max 25) via p-limit in sandbox.js.
 * * @example
 * const { executeAiCode } = require('./util/ai/sandbox');
 * * const result = await executeAiCode(`
 * const response = await fetch('https://api.twitch.tv/...');
 * console.log(await response.json());
 * `, { 
 * CLIENT_ID: '...' 
 * });
 */

const { executeAiCode } = require('./sandbox.js');

module.exports = {
    executeAiCode
};