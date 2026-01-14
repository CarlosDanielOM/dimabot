const ivm = require('isolated-vm');
const { createPolicyValidator } = require('./policy.js');

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
 * @property {Object<string, Function>} [utils={}] - Utility functions to inject
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
async function runSandbox(code, options = {}) {
    const {
        memoryLimit = DEFAULT_MEMORY_LIMIT,
        timeout = DEFAULT_TIMEOUT,
        env = {},
        policyPath,
        utils = {}
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

        // Inject utilities as reference callbacks
        const utilsJail = await isolate.createContext();
        for (const [name, fn] of Object.entries(utils)) {
            if (typeof fn === 'function') {
                await jail.set(`__util_${name}`, new ivm.Reference(fn));
            }
        }

        // Set up the runtime environment inside the isolate
        const setupScript = await isolate.compileScript(`
            // Ensure Array prototypes are available (should be by default, but this reinforces it)
            if (!Array.prototype.find) {
                Array.prototype.find = function(predicate) {
                    if (this == null) throw new TypeError('Array.prototype.find called on null or undefined');
                    if (typeof predicate !== 'function') throw new TypeError('predicate must be a function');
                    var list = Object(this);
                    var length = list.length >>> 0;
                    var thisArg = arguments[1];
                    var value;
                    for (var i = 0; i < length; i++) {
                        value = list[i];
                        if (predicate.call(thisArg, value, i, list)) return value;
                    }
                    return undefined;
                };
            }

            // Create env object (frozen for security)
            const env = Object.freeze(__envData);

            // Set up utilities
            ${Object.keys(utils).map(name => `
                const ${name} = (...args) => {
                    return __util_${name}.apply(undefined, args, { result: { copy: true }, arguments: { copy: true } });
                };
            `).join('\n')}

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
                const responseData = JSON.parse(resultStr);
                
                // Create a Response-like object with standard methods
                return {
                    ok: responseData.ok,
                    status: responseData.status,
                    statusText: responseData.statusText,
                    headers: responseData.headers,
                    url: responseData.url,
                    // Add standard Response methods
                    json: async () => {
                        if (typeof responseData.body === 'string') {
                            return JSON.parse(responseData.body);
                        }
                        return responseData.body;
                    },
                    text: async () => {
                        if (typeof responseData.body === 'string') {
                            return responseData.body;
                        }
                        return JSON.stringify(responseData.body);
                    },
                    // Direct access to body for convenience
                    body: responseData.body
                };
            }

            // Result serializer helper for transferring return values
            function __resultSerializer(value) {
                // Handle cases where value might be a proxy or have lost its prototype
                if (Array.isArray(value) && !value.find) {
                    Object.setPrototypeOf(value, Array.prototype);
                }
                
                // Special marker for undefined (JSON.stringify removes undefined)
                if (value === undefined) {
                    return JSON.stringify({ __type: 'undefined' });
                }
                
                try {
                    // Serialize the value to JSON
                    return JSON.stringify({ __type: 'value', data: value });
                } catch (err) {
                    // Handle non-serializable values (functions, circular refs, etc.)
                    return JSON.stringify({ 
                        __type: 'error', 
                        message: 'Value is not serializable: ' + err.message 
                    });
                }
            }

            // Make these available globally
            global.env = env;
            ${Object.keys(utils).map(name => `global.${name} = ${name};`).join('\n')}
            global.console = console;
            global.fetch = fetch;
            global.__resultSerializer = __resultSerializer;
        `);

        await setupScript.run(context);

        // Wrap user code in async IIFE with result serialization
        const wrappedCode = `
            (async () => {
                try {
                    const __userResult = await (async () => {
                        ${code}
                    })();
                    return __resultSerializer(__userResult);
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
            
            // Deserialize the result from the isolate
            if (rawResult !== undefined && rawResult !== null) {
                try {
                    // Copy the value from the isolate context
                    const serializedResult = typeof rawResult.copy === 'function' 
                        ? rawResult.copy() 
                        : rawResult;
                    
                    // Parse the JSON-serialized result
                    const parsed = JSON.parse(serializedResult);
                    
                    // Handle different result types
                    if (parsed.__type === 'undefined') {
                        result = undefined;
                    } else if (parsed.__type === 'value') {
                        result = parsed.data;
                    } else if (parsed.__type === 'error') {
                        // Non-serializable value
                        error = parsed.message;
                        result = null;
                    } else {
                        // Fallback for unexpected format
                        result = parsed;
                    }
                } catch (deserializeError) {
                    // If deserialization fails, try to get string representation
                    try {
                        result = typeof rawResult.copy === 'function' 
                            ? rawResult.copy() 
                            : String(rawResult);
                    } catch {
                        result = '[Unable to deserialize result]';
                    }
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
function createSandbox(defaultOptions = {}) {
    return {
        async run(code, options = {}) {
            return runSandbox(code, { ...defaultOptions, ...options });
        }
    };
}

module.exports = {
    runSandbox,
    createSandbox
};
