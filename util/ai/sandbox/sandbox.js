import ivm from 'isolated-vm';
import { createPolicyValidator } from './policy.js';

/**
 * @typedef {Object} SandboxResult
 * @property {any} result - The return value from the executed code
 * @property {string[]} logs - Captured console logs
 * @property {string|null} error - Error message if execution failed (truncated to 50 lines)
 * @property {number} executionTime - Time taken to execute in milliseconds
 * @property {boolean} timedOut - Whether the execution timed out
 */

/**
 * @typedef {Object} SandboxOptions
 * @property {number} [memoryLimit=128] - Memory limit in MB
 * @property {number} [timeout=30000] - Timeout in milliseconds
 * @property {Object<string, string>} [env={}] - Environment variables to inject
 * @property {string} [policyPath] - Path to doc-llm.txt for endpoint policy
 */

const MAX_ERROR_LINES = 50;
const DEFAULT_MEMORY_LIMIT = 128; // MB
const DEFAULT_TIMEOUT = 30000; // 30 seconds

/**
 * Truncate error stack trace to a maximum number of lines
 * @param {string} errorMessage - The full error message/stack
 * @returns {string}
 */
function truncateError(errorMessage) {
    if (!errorMessage) return '';
    const lines = errorMessage.split('\n');
    if (lines.length <= MAX_ERROR_LINES) return errorMessage;
    return lines.slice(0, MAX_ERROR_LINES).join('\n') + `\n... (${lines.length - MAX_ERROR_LINES} more lines truncated)`;
}

/**
 * Create the fetch bridge function that runs in the main thread
 * @param {ReturnType<typeof createPolicyValidator>} policyValidator
 * @param {Object<string, string>} envVars - Environment variables for header replacement
 * @returns {Function}
 */
function createFetchBridge(policyValidator, envVars) {
    return async function fetchBridge(url, options = {}) {
        const method = (options.method || 'GET').toUpperCase();
        
        // Validate the request against policy
        const validation = policyValidator.validate(method, url);
        
        if (!validation.allowed) {
            throw new Error(`[Sandbox Policy Violation] ${validation.reason}`);
        }

        // Replace template variables in headers with env values
        const headers = { ...options.headers };
        for (const [key, value] of Object.entries(headers)) {
            if (typeof value === 'string') {
                headers[key] = value.replace(/\{\{(\w+)\}\}/g, (_, envKey) => {
                    return envVars[envKey] || '';
                });
            }
        }

        try {
            const response = await fetch(url, {
                ...options,
                method,
                headers
            });

            // Serialize the response for the isolate
            const responseData = {
                ok: response.ok,
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
                url: response.url
            };

            // Try to get body based on content type
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                responseData.body = await response.json();
            } else {
                responseData.body = await response.text();
            }

            return responseData;
        } catch (error) {
            throw new Error(`[Fetch Error] ${error.message}`);
        }
    };
}

/**
 * Execute AI-generated code in a secure sandbox
 * @param {string} code - The code to execute
 * @param {SandboxOptions} [options={}] - Execution options
 * @returns {Promise<SandboxResult>}
 */
export async function runSandbox(code, options = {}) {
    const {
        memoryLimit = DEFAULT_MEMORY_LIMIT,
        timeout = DEFAULT_TIMEOUT,
        env = {},
        policyPath
    } = options;

    const startTime = Date.now();
    const logs = [];
    let result = null;
    let error = null;
    let timedOut = false;

    // Create isolate with memory limit
    const isolate = new ivm.Isolate({ memoryLimit });
    
    try {
        // Create context
        const context = await isolate.createContext();
        const jail = context.global;

        // Set up global reference
        await jail.set('global', jail.derefInto());

        // Create policy validator
        const policyValidator = createPolicyValidator(policyPath);

        // Create fetch bridge
        const fetchBridge = createFetchBridge(policyValidator, env);

        // Inject fetch as a reference callback
        await jail.set('__fetchBridge', new ivm.Reference(async (urlRef, optionsRef) => {
            const url = urlRef;
            const fetchOptions = optionsRef ? JSON.parse(optionsRef) : {};
            return JSON.stringify(await fetchBridge(url, fetchOptions));
        }));

        // Inject console.log capture
        await jail.set('__logBridge', new ivm.Reference((messageRef) => {
            logs.push(String(messageRef));
        }));

        // Inject environment variables (read-only copy)
        await jail.set('__envData', new ivm.ExternalCopy(env).copyInto());

        // Set up the runtime environment inside the isolate
        const setupScript = await isolate.compileScript(`
            // Create env object (frozen for security)
            const env = Object.freeze(__envData);

            // Create console wrapper
            const console = {
                log: (...args) => __logBridge.apply(undefined, [args.map(a => {
                    try {
                        return typeof a === 'object' ? JSON.stringify(a) : String(a);
                    } catch {
                        return String(a);
                    }
                }).join(' ')]),
                error: (...args) => __logBridge.apply(undefined, ['[ERROR] ' + args.map(a => {
                    try {
                        return typeof a === 'object' ? JSON.stringify(a) : String(a);
                    } catch {
                        return String(a);
                    }
                }).join(' ')]),
                warn: (...args) => __logBridge.apply(undefined, ['[WARN] ' + args.map(a => {
                    try {
                        return typeof a === 'object' ? JSON.stringify(a) : String(a);
                    } catch {
                        return String(a);
                    }
                }).join(' ')]),
                info: (...args) => __logBridge.apply(undefined, ['[INFO] ' + args.map(a => {
                    try {
                        return typeof a === 'object' ? JSON.stringify(a) : String(a);
                    } catch {
                        return String(a);
                    }
                }).join(' ')])
            };

            // Create fetch wrapper
            async function fetch(url, options = {}) {
                const optionsStr = JSON.stringify(options);
                const resultStr = await __fetchBridge.apply(undefined, [url, optionsStr], { result: { promise: true } });
                return JSON.parse(resultStr);
            }

            // Make these available globally
            global.env = env;
            global.console = console;
            global.fetch = fetch;
        `);

        await setupScript.run(context);

        // Wrap user code in async IIFE
        const wrappedCode = `
            (async () => {
                try {
                    ${code}
                } catch (e) {
                    throw e;
                }
            })()
        `;

        // Compile and run the user code
        const userScript = await isolate.compileScript(wrappedCode);
        
        // Run with timeout
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                timedOut = true;
                reject(new Error('Execution timed out after ' + timeout + 'ms'));
            }, timeout);
        });

        const executionPromise = userScript.run(context, { 
            promise: true,
            timeout
        });

        try {
            const rawResult = await Promise.race([executionPromise, timeoutPromise]);
            
            // Try to serialize the result
            if (rawResult !== undefined) {
                try {
                    result = typeof rawResult === 'object' ? rawResult : rawResult;
                } catch {
                    result = String(rawResult);
                }
            }
        } catch (execError) {
            if (execError.message.includes('timed out') || execError.message.includes('Timeout')) {
                timedOut = true;
            }
            error = truncateError(execError.stack || execError.message);
        }

    } catch (err) {
        error = truncateError(err.stack || err.message);
    } finally {
        // Dispose of the isolate to free memory
        isolate.dispose();
    }

    const executionTime = Date.now() - startTime;

    return {
        result,
        logs,
        error,
        executionTime,
        timedOut
    };
}

/**
 * Create a reusable sandbox runner with preset options
 * @param {SandboxOptions} defaultOptions - Default options for all executions
 * @returns {{ run: (code: string, options?: Partial<SandboxOptions>) => Promise<SandboxResult> }}
 */
export function createSandbox(defaultOptions = {}) {
    return {
        async run(code, options = {}) {
            return runSandbox(code, { ...defaultOptions, ...options });
        }
    };
}

export default {
    runSandbox,
    createSandbox
};
