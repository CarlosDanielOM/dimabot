import type { FunctionHandler } from '../evaluator.js';
import { registerFunction } from '../evaluator.js';

const randomHandler: FunctionHandler = async (args, _ctx) => {
    const maxNumber = parseInt(String(args[0] || '100'), 10) || 100;
    return String(Math.floor(Math.random() * maxNumber));
};

export function registerRandomFunctions(): void {
    registerFunction('random', randomHandler);
}
