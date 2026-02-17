import type { ExecutionContext } from '../types.js';
import { registerFunction, type FunctionHandler } from '../evaluator.js';

const countHandler: FunctionHandler = async (args, ctx) => {
    let incrementArg = String(args[0] || ctx.argument || '0');
    if (incrementArg !== '0') {
        incrementArg = incrementArg.replace(/\+/g, '');
    }
    const increment = parseInt(incrementArg, 10) || 0;
    const newCount = ctx.count + increment;
    ctx.count = newCount;
    return String(newCount);
};

const scountHandler: FunctionHandler = async (_args, ctx) => {
    ctx.count = ctx.count + 1;
    return String(ctx.count);
};

const bitsHandler: FunctionHandler = async (_args, ctx) => {
    if (ctx.extraContext?.bits !== undefined) {
        return String(ctx.extraContext.bits);
    }
    return '0';
};

export function registerCountFunctions(): void {
    registerFunction('count', countHandler);
    registerFunction('scount', scountHandler);
    registerFunction('bits', bitsHandler);
}
