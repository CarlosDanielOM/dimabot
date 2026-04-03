import type { FunctionHandler } from '../evaluator.js';
import { registerFunction } from '../evaluator.js';

const MAX_DELAY_SECONDS = 60;

const delayHandler: FunctionHandler = async (args) => {
    if (args.length === 0) {
        return 'delay: missing argument (seconds)';
    }

    const raw = args[0];
    const seconds = Number(raw);

    if (!Number.isFinite(seconds)) {
        return `delay: "${raw}" is not a valid number`;
    }

    if (seconds < 0 || seconds > MAX_DELAY_SECONDS) {
        return `delay: must be between 0 and ${MAX_DELAY_SECONDS} seconds`;
    }

    const ms = Math.round(seconds * 1000);
    await new Promise(resolve => setTimeout(resolve, ms));
    return '';
};

const breakHandler: FunctionHandler = async (_args, ctx) => {
    ctx.loopExit = 'break';
    return '';
};

const continueHandler: FunctionHandler = async (_args, ctx) => {
    ctx.loopExit = 'continue';
    return '';
};

export function registerDelayFunctions(): void {
    registerFunction('delay', delayHandler);
    registerFunction('break', breakHandler);
    registerFunction('continue', continueHandler);
}
