import { runSandbox } from './sandbox.js';

/**
 * @typedef {Object} QueueJob
 * @property {string} id - Unique job identifier
 * @property {string} code - The code to execute
 * @property {Object<string, string>} env - Environment variables
 * @property {number} createdAt - Timestamp when job was created
 * @property {string} [policyPath] - Optional path to doc-llm.txt
 */

/**
 * @typedef {Object} QueuedJobResult
 * @property {string} jobId - The job ID
 * @property {any} result - The execution result
 * @property {string[]} logs - Captured logs
 * @property {string|null} error - Error if any
 * @property {number} executionTime - Execution time in ms
 * @property {boolean} timedOut - Whether execution timed out
 * @property {number} queueTime - Time spent waiting in queue in ms
 */

const QUEUE_KEY = 'sandbox:queue';
const ACTIVE_KEY = 'sandbox:active';
const RESULTS_KEY = 'sandbox:results';
const MAX_CONCURRENT = 25;
const RESULT_TTL = 3600; // 1 hour TTL for results

/**
 * Create a sandbox queue manager
 * @param {import('ioredis').Redis} redisClient - The Redis client instance
 * @returns {Object}
 */
export function createSandboxQueue(redisClient) {
    let isProcessing = false;
    let processingPromise = null;

    /**
     * Generate a unique job ID
     * @returns {string}
     */
    function generateJobId() {
        return `job_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }

    /**
     * Get current number of active jobs
     * @returns {Promise<number>}
     */
    async function getActiveCount() {
        const count = await redisClient.get(ACTIVE_KEY);
        return parseInt(count || '0', 10);
    }

    /**
     * Increment active job counter atomically
     * @returns {Promise<boolean>} - Returns true if slot was acquired
     */
    async function acquireSlot() {
        // Use a Lua script for atomic check-and-increment
        const script = `
            local current = tonumber(redis.call('GET', KEYS[1]) or '0')
            if current < tonumber(ARGV[1]) then
                redis.call('INCR', KEYS[1])
                return 1
            end
            return 0
        `;
        const result = await redisClient.eval(script, 1, ACTIVE_KEY, MAX_CONCURRENT);
        return result === 1;
    }

    /**
     * Release a slot (decrement active counter)
     * @returns {Promise<void>}
     */
    async function releaseSlot() {
        const script = `
            local current = tonumber(redis.call('GET', KEYS[1]) or '0')
            if current > 0 then
                redis.call('DECR', KEYS[1])
            end
            return current - 1
        `;
        await redisClient.eval(script, 1, ACTIVE_KEY);
    }

    /**
     * Add a job to the queue
     * @param {string} code - The code to execute
     * @param {Object<string, string>} env - Environment variables
     * @param {Object} [options] - Additional options
     * @param {string} [options.policyPath] - Path to doc-llm.txt
     * @returns {Promise<string>} - The job ID
     */
    async function enqueue(code, env = {}, options = {}) {
        const jobId = generateJobId();
        const job = {
            id: jobId,
            code,
            env,
            policyPath: options.policyPath,
            createdAt: Date.now()
        };

        // Add job to queue
        await redisClient.rpush(QUEUE_KEY, JSON.stringify(job));

        // Trigger processing if not already running
        processQueue();

        return jobId;
    }

    /**
     * Process jobs from the queue
     * @returns {Promise<void>}
     */
    async function processQueue() {
        // Prevent multiple concurrent processors
        if (isProcessing) return processingPromise;

        isProcessing = true;
        processingPromise = (async () => {
            try {
                while (true) {
                    // Check if we can acquire a slot
                    const hasSlot = await acquireSlot();
                    if (!hasSlot) {
                        // Wait a bit before trying again
                        await new Promise(resolve => setTimeout(resolve, 100));
                        continue;
                    }

                    // Try to get a job from the queue
                    const jobData = await redisClient.lpop(QUEUE_KEY);
                    
                    if (!jobData) {
                        // No jobs, release the slot and exit
                        await releaseSlot();
                        break;
                    }

                    // Process the job asynchronously (don't await - let it run in parallel)
                    processJob(JSON.parse(jobData)).catch(err => {
                        console.error('[SandboxQueue] Error processing job:', err);
                    });
                }
            } finally {
                isProcessing = false;
                processingPromise = null;
            }
        })();

        return processingPromise;
    }

    /**
     * Process a single job
     * @param {QueueJob} job
     * @returns {Promise<void>}
     */
    async function processJob(job) {
        const queueTime = Date.now() - job.createdAt;

        try {
            // Execute the sandbox
            const sandboxResult = await runSandbox(job.code, {
                env: job.env,
                policyPath: job.policyPath
            });

            // Store the result
            const result = {
                jobId: job.id,
                ...sandboxResult,
                queueTime
            };

            await redisClient.setex(
                `${RESULTS_KEY}:${job.id}`,
                RESULT_TTL,
                JSON.stringify(result)
            );

        } catch (error) {
            // Store error result
            const result = {
                jobId: job.id,
                result: null,
                logs: [],
                error: error.message,
                executionTime: 0,
                timedOut: false,
                queueTime
            };

            await redisClient.setex(
                `${RESULTS_KEY}:${job.id}`,
                RESULT_TTL,
                JSON.stringify(result)
            );
        } finally {
            // Always release the slot
            await releaseSlot();

            // Check if there are more jobs to process
            const queueLength = await redisClient.llen(QUEUE_KEY);
            if (queueLength > 0) {
                processQueue();
            }
        }
    }

    /**
     * Get the result of a job
     * @param {string} jobId - The job ID
     * @param {number} [timeout=35000] - Max time to wait for result in ms
     * @returns {Promise<QueuedJobResult|null>}
     */
    async function getResult(jobId, timeout = 35000) {
        const resultKey = `${RESULTS_KEY}:${jobId}`;
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            const resultData = await redisClient.get(resultKey);
            if (resultData) {
                return JSON.parse(resultData);
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        return null;
    }

    /**
     * Execute code and wait for result (convenience method)
     * @param {string} code - The code to execute
     * @param {Object<string, string>} env - Environment variables
     * @param {Object} [options] - Additional options
     * @returns {Promise<QueuedJobResult>}
     */
    async function execute(code, env = {}, options = {}) {
        const jobId = await enqueue(code, env, options);
        const result = await getResult(jobId);
        
        if (!result) {
            return {
                jobId,
                result: null,
                logs: [],
                error: 'Job execution timed out or result not found',
                executionTime: 0,
                timedOut: true,
                queueTime: 0
            };
        }

        return result;
    }

    /**
     * Get queue statistics
     * @returns {Promise<{ queueLength: number, activeJobs: number, maxConcurrent: number }>}
     */
    async function getStats() {
        const [queueLength, activeJobs] = await Promise.all([
            redisClient.llen(QUEUE_KEY),
            getActiveCount()
        ]);

        return {
            queueLength,
            activeJobs,
            maxConcurrent: MAX_CONCURRENT
        };
    }

    /**
     * Clear all pending jobs from the queue
     * @returns {Promise<number>} - Number of jobs cleared
     */
    async function clearQueue() {
        const length = await redisClient.llen(QUEUE_KEY);
        await redisClient.del(QUEUE_KEY);
        return length;
    }

    return {
        enqueue,
        getResult,
        execute,
        getStats,
        clearQueue,
        processQueue
    };
}

export default {
    createSandboxQueue
};
