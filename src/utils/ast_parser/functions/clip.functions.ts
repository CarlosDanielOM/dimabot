import { registerFunction, type FunctionHandler } from '../evaluator.js';
import * as ClipFunctions from '../../../functions/clips/index.js';

const createClipHandler: FunctionHandler = async (_args, ctx) => {
    const result = await ClipFunctions.createClip(ctx.broadcasterId);
    if (result.error || !result.clipID) {
        return '';
    }
    return `https://clips.twitch.tv/${result.clipID}`;
};

export function registerClipFunctions(): void {
    registerFunction('create.clip', createClipHandler);
}
