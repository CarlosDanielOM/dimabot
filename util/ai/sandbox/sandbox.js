const { spawn } = require('child_process');
// 1. SAFETY VALVE: Concurrency Limit
// Only allow 25 scripts to run at the exact same time. 
// The 26th request will wait in line automatically.
// This ensures you never exceed ~1.5GB RAM (approx 50MB per Deno process).
let limit = null; 

// Default timeout if not specified
const DEFAULT_TIMEOUT_MS = 8000; 

async function getLimit() {
    if(limit) return limit;

    const { default: pLimit } = await import('p-limit');
    limit = pLimit(25);
    return limit;
}

/**
 * Low-level function to spawn the Deno process.
 * Do not call this directly; use executeAiCode() to ensure queuing.
 */
function runDenoProcess(aiCode, envVars, timeoutMs) {
    return new Promise((resolve, reject) => {
        // 1. Prepare 'env' Object
        const envEntries = Object.entries(envVars || {})
            .map(([k, v]) => `${k}: "${String(v).replace(/"/g, '\\"')}"`)
            .join(',\n');

        // 2. The Simplified Wrapper
        // WE REMOVED the "const CHANNEL_ID = env.CHANNEL_ID" injection.
        // This prevents "Assignment to constant variable" errors if the AI tries to use those names.
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

        // 3. Spawn Deno
        const deno = spawn('deno', [
            'run', 
            '--no-prompt',
            '--allow-net',      
            '--no-allow-read',   
            '--no-allow-write',  
            '--no-allow-env',    
            '-'                  
        ]);

        deno.on('error', (err) => {
            if (err.code === 'ENOENT') {
                resolve(JSON.stringify({ error: "Configuration Error: 'deno' is not installed or not found in PATH." }));
            } else {
                resolve(JSON.stringify({ error: `Failed to start sandbox: ${err.message}` }));
            }
        });

        let output = '';
        let errorOutput = '';

        deno.stdin.write(fullScript);
        deno.stdin.end();

        deno.stdout.on('data', (data) => output += data.toString());
        deno.stderr.on('data', (data) => errorOutput += data.toString());

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

        setTimeout(() => {
            if (!deno.killed) {
                deno.kill();
                resolve(JSON.stringify({ error: "Execution Timed Out" }));
            }
        }, timeoutMs);
    });
}

/**
 * Executes AI-generated code in a secure Deno sandbox.
 * @param {string} code - The Javascript code to execute.
 * @param {object} env - Key-Value pairs of tokens/IDs to expose to the script.
 * @param {number} [timeout=8000] - Max execution time in milliseconds.
 * @returns {Promise<string>} - The console output logs.
 */
async function executeAiCode(code, env = {}, timeout = DEFAULT_TIMEOUT_MS) {
    // Wrap the execution in the p-limit queue
    const queue = await getLimit();
    return queue(() => runDenoProcess(code, env, timeout));
}

module.exports = { executeAiCode };