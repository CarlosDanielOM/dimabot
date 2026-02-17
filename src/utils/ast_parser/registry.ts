import type { AstNode, ParseResult, ParserHandler, SyntaxDefinition, LiteralNode, GetVarNode, SetVarNode, FunctionNode, ConditionalNode, ExecutionContext } from './types.js';

export type { SyntaxDefinition } from './types.js';

export function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseLiteral(tokens: string[], currentIndex: number): ParseResult {
    const token = tokens[currentIndex];
    const literalNode: LiteralNode = {
        type: 'literal',
        value: token
    };
    return { node: literalNode, newIndex: currentIndex + 1 };
}

export const parseExpression = (
    tokens: string[],
    currentIndex: number,
    registry: Map<string, SyntaxDefinition>
): ParseResult => {
    const token = tokens[currentIndex];
    
    if (token === undefined) {
        return parseLiteral(tokens, currentIndex);
    }
    
    const definition = registry.get(token);
    if (definition) {
        return definition.handler(tokens, currentIndex, registry);
    }
    
    if (token === ')') {
        return { node: { type: 'literal', value: '' }, newIndex: currentIndex };
    }
    
    return parseLiteral(tokens, currentIndex);
};

const parseVariable: ParserHandler = (tokens, currentIndex, registry) => {
    const varName = tokens[currentIndex + 1];
    const nextToken = tokens[currentIndex + 2];
    
    if (nextToken === ')' || nextToken === undefined) {
        const getNode: GetVarNode = {
            type: 'getVar',
            name: varName
        };
        return { node: getNode, newIndex: currentIndex + 3 };
    }
    
    const valueResult = parseExpression(tokens, currentIndex + 2, registry);
    const closingParen = tokens[valueResult.newIndex];
    
    let finalIndex = valueResult.newIndex;
    if (closingParen === ')') {
        finalIndex = valueResult.newIndex + 1;
    }
    
    const setNode: SetVarNode = {
        type: 'setVar',
        name: varName,
        value: valueResult.node
    };
    
    return { node: setNode, newIndex: finalIndex };
};

const parseFunction: ParserHandler = (tokens, currentIndex, registry) => {
    const funcName = tokens[currentIndex + 1];
    const args: AstNode[] = [];
    let i = currentIndex + 2;
    
    while (i < tokens.length && tokens[i] !== ')') {
        const result = parseExpression(tokens, i, registry);
        if (result.node.type !== 'literal' || (result.node as LiteralNode).value !== '') {
            args.push(result.node);
        }
        i = result.newIndex;
    }
    
    if (tokens[i] === ')') {
        i++;
    }
    
    const funcNode: FunctionNode = {
        type: 'function',
        name: funcName,
        args
    };
    
    return { node: funcNode, newIndex: i };
};

const COMPARISON_OPERATORS = ['==', '!=', '>=', '<=', '~=', '<>', '>', '<', '='];

const parseConditional: ParserHandler = (tokens, currentIndex, registry) => {
    let i = currentIndex + 1;
    
    const leftResult = parseExpression(tokens, i, registry);
    i = leftResult.newIndex;
    
    let operator = '';
    for (const op of COMPARISON_OPERATORS) {
        if (tokens[i] === op) {
            operator = op;
            i++;
            break;
        }
    }
    
    if (!operator) {
        for (const op of COMPARISON_OPERATORS) {
            const combined = tokens[i] + (tokens[i + 1] || '');
            if (combined === op) {
                operator = op;
                i += 2;
                break;
            }
        }
    }
    
    const rightResult = parseExpression(tokens, i, registry);
    i = rightResult.newIndex;
    
    let trueBranch: AstNode = { type: 'literal', value: '' };
    let falseBranch: AstNode = { type: 'literal', value: '' };
    
    if (tokens[i] === '?') {
        i++;
        const trueResult = parseExpression(tokens, i, registry);
        trueBranch = trueResult.node;
        i = trueResult.newIndex;
        
        if (tokens[i] === ':') {
            i++;
            const falseResult = parseExpression(tokens, i, registry);
            falseBranch = falseResult.node;
            i = falseResult.newIndex;
        }
    }
    
    if (tokens[i] === ')') {
        i++;
    }
    
    const condNode: ConditionalNode = {
        type: 'conditional',
        left: leftResult.node,
        operator: operator || '==',
        right: rightResult.node,
        trueBranch,
        falseBranch
    };
    
    return { node: condNode, newIndex: i };
};

export const createSyntaxRegistry = (): Map<string, SyntaxDefinition> => {
    const registry = new Map<string, SyntaxDefinition>();
    
    registry.set('$(', {
        startToken: '$(',
        endToken: ')',
        handler: parseFunction
    });
    
    registry.set('%(', {
        startToken: '%(',
        endToken: ')',
        handler: parseVariable
    });
    
    registry.set('*(', {
        startToken: '*(',
        endToken: ')',
        handler: parseConditional
    });
    
    return registry;
};

export const SyntaxRegistry = createSyntaxRegistry();

export function registerSyntax(definition: SyntaxDefinition): void {
    SyntaxRegistry.set(definition.startToken, definition);
}
