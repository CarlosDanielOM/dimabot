/**
 * AI Sandbox Module - Secure Deno-based Code Execution
 * 
 * Provides a secure Deno-based environment for executing AI-generated code.
 * Concurrency is automatically managed (max 25) via p-limit.
 * Each Deno process uses ~50MB RAM, so 25 concurrent processes = ~1.25GB max.
 */

import { spawn, type ChildProcess } from 'child_process';
import pLimit from 'p-limit';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_CONCURRENCY = 25;

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Environment variables to inject into the sandbox
 */
export type SandboxEnv = Record<string, string | number | boolean>;

/**
 * Result from Deno execution
 */
export interface DenoResult {
    error?: string;
    status?: string;
    logs?: string;
    [key: string]: any;
}

// ============================================================================
// CONCURRENCY MANAGEMENT
// ============================================================================

let limit: ReturnType<typeof pLimit> | null = null;

function getLimit(): ReturnType<typeof pLimit> {
    if (!limit) {
        limit = pLimit(MAX_CONCURRENCY);
    }
    return limit;
}

// ============================================================================
// LOW-LEVEL EXECUTION
// ============================================================================

/**
 * Low-level function to spawn the Deno process.
 * Do not call this directly; use executeAiCode() to ensure queuing.
 * 
 * @param aiCode - The JavaScript code to execute
 * @param envVars - Environment variables to inject
 * @param timeoutMs - Maximum execution time in milliseconds
 * @returns Promise resolving to JSON stringified result
 */
export async function runDenoProcess(
    aiCode: string,
    envVars: SandboxEnv = {},
    timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<string> {
    return new Promise((resolve) => {
        // Prepare 'env' Object with escaped values
        const envEntries = Object.entries(envVars || {})
            .map(([k, v]) => `${k}: "${String(v).replace(/"/g, '\\"')}"`)
            .join(',\n');

        // The Simplified Wrapper
        // We removed "const CHANNEL_ID = env.CHANNEL_ID" injection
        // This prevents "Assignment to constant variable" errors if AI tries to use those names
        const fullScript = `
            // [Secure Environment Header]
            const env = {
                ${envEntries}
            };

            // [Main Execution Wrapper]
            (async () => {
                try {
                    // Wrap user code so 'return' works
                    const __result = await (async () => {
                        ${aiCode}
                    })();

                    // Output success result as JSON
                    if (__result !== undefined) {
                        console.log(JSON.stringify(__result));
                    }
                } catch (err) {
                    // Capture runtime errors
                    // We log a specific prefix so we can distinguish app errors from Deno crashes
                    console.error("RUNTIME_ERROR: " + err.message);
                }
            })();
        `;

        // Spawn Deno with limited permissions
        const deno: ChildProcess = spawn('deno', [
            'run', 
            '--no-prompt',
            '--allow-net',      
            '--no-allow-read',   
            '--no-allow-write',  
            '--no-allow-env',    
            '-'                  
        ]);

        deno.on('error', (err) => {
            if ('code' in err && err.code === 'ENOENT') {
                resolve(JSON.stringify({ error: "Configuration Error: 'deno' is not installed or not found in PATH." }));
            } else {
                resolve(JSON.stringify({ error: `Failed to start sandbox: ${err.message}` }));
            }
        });

        let output = '';
        let errorOutput = '';

        deno.stdin?.write(fullScript);
        deno.stdin?.end();

        deno.stdout?.on('data', (data) => output += data.toString());
        deno.stderr?.on('data', (data) => errorOutput += data.toString());

        deno.on('close', (code) => {
            const finalLog = (output + errorOutput).trim();
            
            // Check for our specific runtime error tag
            if (finalLog.includes("RUNTIME_ERROR:")) {
                const errorMsg = finalLog.split("RUNTIME_ERROR:")[1].trim();
                resolve(JSON.stringify({ error: errorMsg }));
            } 
            // Check for Deno crash (e.g. syntax error in the script itself)
            else if (code !== 0 && !finalLog) {
                resolve(JSON.stringify({ error: `Script crashed (Exit Code ${code})` }));
            } 
            // Check for valid JSON output
            else {
                // If the output is JSON, return it raw (Node will parse it)
                // If it's just text logs, wrap it
                try {
                    JSON.parse(finalLog); // Test parse
                    resolve(finalLog);
                } catch (e) {
                    resolve(JSON.stringify({ status: "done", logs: finalLog }));
                }
            }
        });

        // Timeout handling
        setTimeout(() => {
            if (!deno.killed) {
                deno.kill();
                resolve(JSON.stringify({ error: "Execution Timed Out" }));
            }
        }, timeoutMs);
    });
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Executes AI-generated code in a secure Deno sandbox.
 * 
 * Concurrency is automatically managed (max 25 concurrent processes).
 * The 26th request will wait in line automatically.
 * 
 * @param code - The JavaScript code to execute
 * @param env - Key-Value pairs of tokens/IDs to expose to the script
 * @param timeout - Max execution time in milliseconds (default: 8000ms)
 * @returns Promise resolving to console output logs as JSON string
 * 
 * @example
 * const result = await executeAiCode(`
 *   const response = await fetch('https://api.twitch.tv/...');
 *   console.log(await response.json());
 * `, { 
 *   CLIENT_ID: '...',
 *   AUTH_TOKEN: '...'
 * });
 * 
 * // Result will be JSON string like: '{"data": {...}}' or '{"error": "..."}'
 */
export async function executeAiCode(
    code: string,
    env: SandboxEnv = {},
    timeout: number = DEFAULT_TIMEOUT_MS
): Promise<string> {
    const queue = getLimit();
    return queue(() => runDenoProcess(code, env, timeout));
}
