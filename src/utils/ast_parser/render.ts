import type { ExecutionContext } from './types.js';
import type { SyntaxDefinition } from './types.js';
import { SyntaxRegistry } from './registry.js';
import { parse } from './parser.js';
import { evaluate } from './evaluator.js';

interface RenderAstResult {
    parsedText: string;
    context: ExecutionContext;
}

function isEscaped(input: string, index: number): boolean {
    let backslashes = 0;
    for (let i = index - 1; i >= 0 && input[i] === '\\'; i--) {
        backslashes++;
    }
    return backslashes % 2 === 1;
}

function findExpressionEnd(input: string, startIndex: number): number {
    let depth = 1;
    let inQuote: 'single' | 'double' | null = null;

    for (let i = startIndex; i < input.length; i++) {
        const char = input[i];

        if (inQuote) {
            if (char === '\\') {
                i++;
                continue;
            }

            if ((inQuote === 'single' && char === "'") || (inQuote === 'double' && char === '"')) {
                inQuote = null;
            }

            continue;
        }

        if (char === '"') {
            inQuote = 'double';
            continue;
        }

        if (char === "'") {
            inQuote = 'single';
            continue;
        }

        if (char === '(') {
            depth++;
            continue;
        }

        if (char === ')') {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
    }

    return -1;
}

function getStartTokens(registry: Map<string, SyntaxDefinition>): string[] {
    return Array.from(registry.keys()).sort((a, b) => b.length - a.length);
}

function findMatchingStartToken(
    input: string,
    index: number,
    startTokens: string[]
): string | null {
    for (const token of startTokens) {
        if (input.startsWith(token, index)) {
            return token;
        }
    }
    return null;
}

export async function renderAstWithSourceReference(
    input: string,
    context: ExecutionContext,
    registry: Map<string, SyntaxDefinition> = SyntaxRegistry
): Promise<RenderAstResult> {
    const startTokens = getStartTokens(registry);
    let output = '';
    let i = 0;
    let currentContext = context;

    while (i < input.length) {
        const token = findMatchingStartToken(input, i, startTokens);

        if (!token || isEscaped(input, i)) {
            output += input[i];
            i++;
            continue;
        }

        const expressionEnd = findExpressionEnd(input, i + token.length);
        if (expressionEnd === -1) {
            output += input[i];
            i++;
            continue;
        }

        const expression = input.slice(i, expressionEnd + 1);
        const { ast, error } = parse(expression, registry);

        if (error) {
            output += expression;
            i = expressionEnd + 1;
            continue;
        }

        const result = await evaluate(ast, currentContext);
        currentContext = result.context;
        output += String(result.value ?? '');
        i = expressionEnd + 1;
    }

    return {
        parsedText: output,
        context: currentContext
    };
}
