import { registerFunction, type FunctionHandler } from '../evaluator.js';
import { TriggerSchema } from '../../../schemas/trigger.schema.js';
import { TriggerFileSchema } from '../../../schemas/trigger_file.schema.js';
import { sendTrigger } from '../../../functions/triggers/send_trigger.trigger.js';

function parseQueueFlag(raw: unknown): boolean | null {
    const normalized = String(raw).trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    return null;
}

const triggerSendHandler: FunctionHandler = async (args, ctx) => {
    if (args.length === 0) {
        return 'Usage: $(trigger.send trigger_name true|false)';
    }

    let queue = false;
    let triggerNameParts = [...args].map((arg) => String(arg).trim()).filter(Boolean);

    const maybeQueueArg = triggerNameParts[triggerNameParts.length - 1];
    const parsedQueue = maybeQueueArg ? parseQueueFlag(maybeQueueArg) : null;
    if (parsedQueue !== null) {
        queue = parsedQueue;
        triggerNameParts = triggerNameParts.slice(0, -1);
    }

    const triggerName = triggerNameParts.join(' ').trim();

    if (!triggerName) {
        return 'Usage: $(trigger.send trigger_name true|false)';
    }

    const trigger = await TriggerSchema.findOne({
        channelID: ctx.broadcasterId,
        name: triggerName,
        type: 'redemption'
    });

    if (!trigger) {
        return `Trigger not found: ${triggerName}`;
    }

    if (!trigger.isEnabled) {
        return `Trigger is disabled: ${triggerName}`;
    }

    const file = await TriggerFileSchema.findOne({
        _id: trigger.fileID,
        channelID: ctx.broadcasterId
    });

    if (!file) {
        return `Trigger file not found: ${trigger.file}`;
    }

    const result = await sendTrigger(ctx.broadcasterId, {
        url: file.fileUrl,
        mediaType: file.fileType,
        volume: trigger.volume
    }, queue);

    return result.error ? result.message : '';
};

export function registerTriggerFunctions(): void {
    registerFunction('trigger.send', triggerSendHandler);
}
