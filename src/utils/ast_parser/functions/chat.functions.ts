import { registerFunction, type FunctionHandler } from '../evaluator.js';
import * as ChatFunctions from '../../../functions/chats/index.js';

const chatSendHandler: FunctionHandler = async (args, ctx) => {
    const message = (args[0] ?? '').toString().trim();
    if (!message) {
        return '';
    }
    const result = await ChatFunctions.sendTwitchChatMessage(ctx.broadcasterId, message);
    if (result.error) {
        return `chat.send: ${result.message}`;
    }
    return '';
};

export function registerChatFunctions(): void {
    registerFunction('chat.send', chatSendHandler);
}