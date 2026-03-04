import path from 'node:path';
import dotenv from 'dotenv';

const isDev = process.env.NODE_ENV !== 'production';

if (isDev) {
    dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
}

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

//? Imports after dotenv config
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { error as logError, info as logInfo, warn as logWarn } from '../utils/logger.js';

const RESTART_DELAY_MS = Math.max(1000, Number(process.env.CRON_WORKER_RESTART_DELAY_MS || 5000));
const runtime = process.env.CRON_WORKER_RUNTIME === 'tsx' ? 'tsx' : 'node';
const isShuttingDown = { value: false };
const supervisorDryRun = process.argv.includes('--dry-run');
const supervisorOnce = process.argv.includes('--once');

interface WorkerDefinition {
    name: string;
    sourceEntry: string;
    distEntry: string;
}

interface ManagedWorker {
    definition: WorkerDefinition;
    process: ChildProcess | null;
    restartCount: number;
    exitCode: number | null;
}

const WORKERS: WorkerDefinition[] = [
    {
        name: 'follow-ledger',
        sourceEntry: 'src/workers/follow_ledger.worker.ts',
        distEntry: 'dist/workers/follow_ledger.worker.js'
    },
    {
        name: 'stream-analytics',
        sourceEntry: 'src/workers/stream_analytics.worker.ts',
        distEntry: 'dist/workers/stream_analytics.worker.js'
    },
    {
        name: 'stream-memory',
        sourceEntry: 'src/workers/stream_memory.worker.ts',
        distEntry: 'dist/workers/stream_memory.worker.js'
    },
    {
        name: 'temporary-roles',
        sourceEntry: 'src/workers/temporary_roles.worker.ts',
        distEntry: 'dist/workers/temporary_roles.worker.js'
    },
    {
        name: 'timer',
        sourceEntry: 'src/workers/timer.worker.ts',
        distEntry: 'dist/workers/timer.worker.js'
    }
];

function resolveWorkerEntry(worker: WorkerDefinition): { command: string; args: string[] } {
    let entryPath: string;

    if (runtime === 'tsx') {
        // tsx mode: resolve from process.cwd() using sourceEntry
        entryPath = path.resolve(process.cwd(), worker.sourceEntry);
    } else {
        // node mode: resolve from compiled supervisor file location using import.meta.url
        const compiledFileDir = path.dirname(fileURLToPath(import.meta.url));
        entryPath = path.resolve(compiledFileDir, path.basename(worker.distEntry));
    }

    const args: string[] = [entryPath];

    if (supervisorDryRun) {
        args.push('--dry-run');
    }
    if (supervisorOnce) {
        args.push('--once');
    }

    if (runtime === 'tsx') {
        return {
            command: 'tsx',
            args
        };
    }
    return {
        command: process.execPath,
        args
    };
}

function spawnWorker(managed: ManagedWorker): void {
    const { definition } = managed;
    const { command, args } = resolveWorkerEntry(definition);
    const child = spawn(command, args, {
        stdio: 'inherit',
        env: {
            ...process.env,
            CRON_SUPERVISOR: 'true',
            CRON_WORKER_NAME: definition.name
        }
    });
    managed.process = child;
    void logInfo({
        worker: 'cron_supervisor',
        message: 'Started cron worker process',
        name: definition.name,
        pid: child.pid,
        runtime,
        restartCount: managed.restartCount
    }, { destination: 'console' });
    child.on('exit', (code, signal) => {
        managed.process = null;
        managed.exitCode = code ?? (signal ? 1 : 0);

        void logWarn({
            worker: 'cron_supervisor',
            message: 'Cron worker process exited',
            name: definition.name,
            code: managed.exitCode,
            signal,
            restarting: !isShuttingDown.value && !supervisorOnce
        }, { destination: 'console' });

        if (isShuttingDown.value) {
            return;
        }

        if (supervisorOnce) {
            return;
        }

        managed.restartCount += 1;
        setTimeout(() => {
            if (isShuttingDown.value) {
                return;
            }
            spawnWorker(managed);
        }, RESTART_DELAY_MS);
    });
    child.on('error', (error) => {
        void logError({
            worker: 'cron_supervisor',
            message: 'Cron worker process failed',
            name: definition.name,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        }, { destination: 'console' });
    });
}

function startAllWorkers(): ManagedWorker[] {
    const managedWorkers: ManagedWorker[] = WORKERS.map((definition) => ({
        definition,
        process: null,
        restartCount: 0,
        exitCode: null
    }));
    for (const managed of managedWorkers) {
        spawnWorker(managed);
    }
    return managedWorkers;
}

function allWorkersExited(managedWorkers: ManagedWorker[]): boolean {
    return managedWorkers.every((managed) => managed.process === null);
}

function setupShutdown(managedWorkers: ManagedWorker[]): void {
    const shutdown = async (signal: string): Promise<void> => {
        if (isShuttingDown.value) {
            return;
        }
        isShuttingDown.value = true;
        await logInfo({
            worker: 'cron_supervisor',
            message: 'Shutting down cron supervisor',
            signal,
            workers: managedWorkers.map((managed) => ({
                name: managed.definition.name,
                pid: managed.process?.pid ?? null
            }))
        }, { destination: 'console' });
        for (const managed of managedWorkers) {
            if (!managed.process || managed.process.killed) {
                continue;
            }
            managed.process.kill('SIGTERM');
        }
        setTimeout(() => {
            process.exit(0);
        }, 500).unref?.();
    };
    process.once('SIGINT', () => {
        void shutdown('SIGINT');
    });
    process.once('SIGTERM', () => {
        void shutdown('SIGTERM');
    });
}

async function waitForAllWorkers(managedWorkers: ManagedWorker[]): Promise<void> {
    while (!allWorkersExited(managedWorkers)) {
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

async function bootstrap(): Promise<void> {
    await logInfo({
        worker: 'cron_supervisor',
        message: 'Starting cron supervisor',
        runtime,
        restartDelayMs: RESTART_DELAY_MS,
        workers: WORKERS.map((worker) => worker.name),
        mode: supervisorOnce ? 'once' : 'normal',
        dryRun: supervisorDryRun
    }, { destination: 'console' });
    const managedWorkers = startAllWorkers();

    if (supervisorOnce) {
        await waitForAllWorkers(managedWorkers);
        const allSuccess = managedWorkers.every((managed) => managed.exitCode === 0);
        await logInfo({
            worker: 'cron_supervisor',
            message: 'All workers completed',
            results: managedWorkers.map((managed) => ({
                name: managed.definition.name,
                exitCode: managed.exitCode
            }))
        }, { destination: 'console' });
        process.exit(allSuccess ? 0 : 1);
    }

    setupShutdown(managedWorkers);
}

bootstrap().catch(async (error) => {
    await logError({
        worker: 'cron_supervisor',
        message: 'Failed to bootstrap cron supervisor',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
    }, { destination: 'console' });
    process.exit(1);
});
