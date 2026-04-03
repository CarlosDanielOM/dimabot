import Anthropic from '@anthropic-ai/sdk';
import { debug, error } from '../../logger.js';
import { createFetchWithRetry } from '../fetch.utils.js';

const ANTHROPIC_MODEL = 'MiniMax-M2.7-highspeed';
const BASE_URL = 'https://api.minimax.io/anthropic';
const COST_PER_M_INPUT = 0.60;
const COST_PER_M_OUTPUT = 2.40;
const MINIMAX_TIMEOUT = 60000;

let _client: Anthropic | null = null;

const fetchWithRetry = createFetchWithRetry({ timeout: MINIMAX_TIMEOUT, retries: 3 });

function getClient(): Anthropic {
    if (!_client) {
        debug({ function: 'minimax.getClient', message: '[MiniMax] Initializing Anthropic client', baseURL: BASE_URL }, { destination: 'console' });
        _client = new Anthropic({
            baseURL: BASE_URL,
            apiKey: process.env.MINI_TOKEN_PLAN_API_KEY,
        });
    }
    return _client;
}

export function calculateMiniMaxCost(promptTokens: number, completionTokens: number): number {
    const inputCost = (promptTokens / 1_000_000) * COST_PER_M_INPUT;
    const outputCost = (completionTokens / 1_000_000) * COST_PER_M_OUTPUT;
    const total = inputCost + outputCost;
    debug({
        function: 'minimax.calculateMiniMaxCost',
        message: '[MiniMax] Cost calculated',
        promptTokens,
        completionTokens,
        inputCost: inputCost.toFixed(6),
        outputCost: outputCost.toFixed(6),
        totalCost: total.toFixed(6)
    }, { destination: 'console' });
    return total;
}

export interface MiniMaxChatParams {
    model?: string;
    messages: Anthropic.MessageParam[];
    maxTokens?: number;
    system?: string;
    stream?: boolean;
    channelID?: string;
}

export interface MiniMaxChatResult {
    content: string;
    inputTokens: number;
    outputTokens: number;
    stopReason?: string;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    return Promise.race([promise, timeout]);
}

export async function minimaxChat(params: MiniMaxChatParams): Promise<MiniMaxChatResult> {
    const client = getClient();
    const model = params.model || ANTHROPIC_MODEL;

    debug({
        function: 'minimax.minimaxChat',
        message: '[MiniMax] Sending chat request',
        channelID: params.channelID,
        model,
        messageCount: params.messages.length,
        maxTokens: params.maxTokens,
        hasSystem: !!params.system
    }, { destination: 'console' });

    const startTime = Date.now();

    const filteredMessages = ((params.messages || []) as Anthropic.MessageParam[])
        .filter((msg) => (msg.role as string) !== 'system');

    debug({
        function: 'minimax.minimaxChat',
        message: '[MiniMax] Messages after filtering system role',
        channelID: params.channelID,
        originalCount: params.messages.length,
        filteredCount: filteredMessages.length
    }, { destination: 'console' });

    try {
        const messageResult = await withTimeout(
            client.messages.create({
                model,
                messages: filteredMessages as Anthropic.MessageParam[],
                max_tokens: params.maxTokens ?? 4096,
                system: params.system,
                stream: false,
            }),
            MINIMAX_TIMEOUT,
            'MiniMax API'
        );

        const duration = Date.now() - startTime;

        const msg = messageResult as unknown as {
            usage: { input_tokens: number; output_tokens: number };
            content: Array<{ type: string; text?: string }>;
            stop_reason: string | null;
        };

        const usage = msg.usage;
        const inputTokens = usage.input_tokens;
        const outputTokens = usage.output_tokens;

        const textBlocks = msg.content.filter((block: any) => block.type === 'text');
        const content = textBlocks.length > 0 ? (textBlocks[textBlocks.length - 1].text ?? '') : '';

        debug({
            function: 'minimax.minimaxChat',
            message: '[MiniMax] Response received',
            channelID: params.channelID,
            duration,
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
            stopReason: msg.stop_reason,
            contentLength: content.length
        }, { destination: 'console' });

        return {
            content,
            inputTokens,
            outputTokens,
            stopReason: msg.stop_reason ?? undefined,
        };
    } catch (err) {
        const duration = Date.now() - startTime;
        await error({
            function: 'minimax.minimaxChat',
            message: '[MiniMax] Chat request failed',
            channelID: params.channelID,
            duration,
            error: err instanceof Error ? err.message : String(err)
        }, { channelId: params.channelID, destination: 'both' });
        throw err;
    }
}

export { ANTHROPIC_MODEL as MINIMAX_MODEL, BASE_URL, COST_PER_M_INPUT, COST_PER_M_OUTPUT };
