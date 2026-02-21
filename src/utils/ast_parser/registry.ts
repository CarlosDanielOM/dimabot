import type { AstNode, ParseResult, ParserHandler, SyntaxDefinition, LiteralNode, GetVarNode, SetVarNode, ExistsNode, FunctionNode, ConditionalNode, BinaryExpressionNode, UnaryExpressionNode, TernaryExpressionNode, TemplateNode, TemplateSegment, VariableStorage, ArrayAccessor, BinaryOperator, UnaryOperator } from './types.js';
import { tokenize } from './tokenizer.js';

export type { SyntaxDefinition } from './types.js';

export function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseVarName(rawName: string): { name: string; storage: VariableStorage } {
    if (rawName.startsWith('**')) {
        return { name: rawName.slice(2), storage: 'dbUser' };
    }
    if (rawName.startsWith('*')) {
        return { name: rawName.slice(1), storage: 'db' };
    }
    if (rawName.startsWith('##')) {
        return { name: rawName.slice(2), storage: 'cacheUser' };
    }
    if (rawName.startsWith('#')) {
        return { name: rawName.slice(1), storage: 'cache' };
    }
    return { name: rawName, storage: 'memory' };
}

function parseLiteral(tokens: string[], currentIndex: number): ParseResult {
    const token = tokens[currentIndex];
    const literalNode: LiteralNode = {
        type: 'literal',
        value: token
    };
    return { node: literalNode, newIndex: currentIndex + 1 };
}

function parseTemplateString(content: string, registry: Map<string, SyntaxDefinition>): TemplateNode {
    const segments: TemplateSegment[] = [];
    let i = 0;
    
    while (i < content.length) {
        const dollarBrace = content.indexOf('${', i);
        
        if (dollarBrace === -1) {
            if (i < content.length) {
                segments.push({ type: 'text', value: content.slice(i) });
            }
            break;
        }
        
        if (dollarBrace > i) {
            segments.push({ type: 'text', value: content.slice(i, dollarBrace) });
        }
        
        let braceDepth = 1;
        let j = dollarBrace + 2;
        let foundClose = false;
        
        while (j < content.length && braceDepth > 0) {
            if (content[j] === '{') {
                braceDepth++;
            } else if (content[j] === '}') {
                braceDepth--;
            }
            j++;
        }
        
        if (braceDepth === 0) {
            const exprContent = content.slice(dollarBrace + 2, j - 1);
            
            try {
                const innerTokens = tokenize(exprContent, registry);
                if (innerTokens.tokens.length > 0) {
                    const exprResult = parseStarExpression(innerTokens.tokens, 0, registry, 0);
                    segments.push({ type: 'expr', node: exprResult.node });
                } else {
                    segments.push({ type: 'text', value: '' });
                }
            } catch {
                segments.push({ type: 'text', value: `[Parse error: ${exprContent}]` });
            }
            
            i = j;
            foundClose = true;
        }
        
        if (!foundClose) {
            segments.push({ type: 'text', value: content.slice(dollarBrace) });
            break;
        }
    }
    
    if (segments.length === 0) {
        segments.push({ type: 'text', value: '' });
    }
    
    const templateNode: TemplateNode = {
        type: 'template',
        segments
    };
    return templateNode;
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
    
    if (token.startsWith('__TEMPLATE__:')) {
        const content = token.slice('__TEMPLATE__:'.length);
        const unescapedContent = content
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\');
        const templateNode = parseTemplateString(unescapedContent, registry);
        return { node: templateNode, newIndex: currentIndex + 1 };
    }
    
    return parseLiteral(tokens, currentIndex);
};

const parseVariable: ParserHandler = (tokens, currentIndex, registry) => {
    const rawName = tokens[currentIndex + 1];
    const { storage } = parseVarName(rawName);
    let i = currentIndex + 2;
    
    let accessor: ArrayAccessor | undefined;
    
    if (tokens[i] === '[') {
        i++;
        
        if (tokens[i] === ']') {
            i++;
            accessor = { type: 'append' };
        } else if (tokens[i] === 'random') {
            i++;
            if (tokens[i] === ']') i++;
            accessor = { type: 'random' };
        } else {
            const indexResult = parseExpression(tokens, i, registry);
            i = indexResult.newIndex;
            if (tokens[i] === ']') i++;
            accessor = { type: 'index', index: indexResult.node };
        }
    } else if (tokens[i] === '.') {
        i++;
        if (tokens[i] === 'length') {
            i++;
            accessor = { type: 'length' };
        }
    }
    
    const nextToken = tokens[i];
    
    if (accessor?.type === 'append' && nextToken && nextToken !== ')') {
        const valueResult = parseExpression(tokens, i, registry);
        i = valueResult.newIndex;
        if (tokens[i] === ')') i++;
        
        const setNode: SetVarNode = {
            type: 'setVar',
            name: rawName,
            storage,
            value: valueResult.node,
            accessor: { type: 'append' }
        };
        return { node: setNode, newIndex: i };
    }
    
    if (accessor?.type === 'index' && nextToken && nextToken !== ')') {
        const valueResult = parseExpression(tokens, i, registry);
        i = valueResult.newIndex;
        if (tokens[i] === ')') i++;
        
        const setNode: SetVarNode = {
            type: 'setVar',
            name: rawName,
            storage,
            value: valueResult.node,
            accessor: { type: 'setIndex', index: accessor.index }
        };
        return { node: setNode, newIndex: i };
    }
    
    if (!accessor && nextToken && nextToken !== ')') {
        const valueResult = parseExpression(tokens, i, registry);
        i = valueResult.newIndex;
        if (tokens[i] === ')') i++;
        
        const setNode: SetVarNode = {
            type: 'setVar',
            name: rawName,
            storage,
            value: valueResult.node
        };
        return { node: setNode, newIndex: i };
    }
    
    if (tokens[i] === ')') i++;
    
    const getNode: GetVarNode = {
        type: 'getVar',
        name: rawName,
        storage,
        accessor
    };
    return { node: getNode, newIndex: i };
};

const parseExists: ParserHandler = (tokens, currentIndex, registry) => {
    const rawName = tokens[currentIndex + 1];
    const { storage } = parseVarName(rawName);
    let i = currentIndex + 2;
    
    let accessor: ArrayAccessor | undefined;
    
    if (tokens[i] === '[') {
        i++;
        
        if (tokens[i] === 'random') {
            i++;
            if (tokens[i] === ']') i++;
            accessor = { type: 'random' };
        } else {
            const indexResult = parseExpression(tokens, i, registry);
            i = indexResult.newIndex;
            if (tokens[i] === ']') i++;
            accessor = { type: 'index', index: indexResult.node };
        }
    } else if (tokens[i] === '.') {
        i++;
        if (tokens[i] === 'length') {
            i++;
            accessor = { type: 'length' };
        }
    }
    
    if (tokens[i] === ')') i++;
    
    const existsNode: ExistsNode = {
        type: 'exists',
        name: rawName,
        storage,
        accessor
    };
    return { node: existsNode, newIndex: i };
};

const parseFunction: ParserHandler = (tokens, currentIndex, registry) => {
    let i = currentIndex + 1;
    const nameParts: string[] = [];
    
    while (i < tokens.length) {
        const token = tokens[i];
        
        if (token === ')' || token === '(') break;
        
        if (token === '.') {
            i++;
            continue;
        }
        
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(token)) {
            nameParts.push(token);
            i++;
            
            if (tokens[i] !== '.') break;
        } else {
            break;
        }
    }
    
    const funcName = nameParts.join('.');
    const args: AstNode[] = [];
    
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
const ARITHMETIC_HIGH = ['*', '/', '%'];
const ARITHMETIC_LOW = ['+', '-'];
const ALL_BINARY_OPS = [...COMPARISON_OPERATORS, ...ARITHMETIC_HIGH, ...ARITHMETIC_LOW];

function isBinaryOperator(token: string): token is BinaryOperator {
    return ALL_BINARY_OPS.includes(token);
}

function getPrecedence(token: string): number {
    if (token === '?' || token === ':') return 1;
    if (COMPARISON_OPERATORS.includes(token)) return 2;
    if (ARITHMETIC_LOW.includes(token)) return 3;
    if (ARITHMETIC_HIGH.includes(token)) return 4;
    return 0;
}

function isRightAssociative(_token: string): boolean {
    return false;
}

function parseAtom(
    tokens: string[],
    i: number,
    registry: Map<string, SyntaxDefinition>
): ParseResult {
    const token = tokens[i];
    
    if (token === undefined || token === ')') {
        return { node: { type: 'literal', value: '' }, newIndex: i };
    }
    
    if (token === '(') {
        const innerResult = parseStarExpression(tokens, i + 1, registry, 0);
        let newIndex = innerResult.newIndex;
        if (tokens[newIndex] === ')') {
            newIndex++;
        }
        return { node: innerResult.node, newIndex };
    }
    
    if (token === '+' || token === '-') {
        const op = token as UnaryOperator;
        const argResult = parseAtom(tokens, i + 1, registry);
        const unaryNode: UnaryExpressionNode = {
            type: 'unary',
            operator: op,
            argument: argResult.node
        };
        return { node: unaryNode, newIndex: argResult.newIndex };
    }
    
    if (token.startsWith('__TEMPLATE__:')) {
        const content = token.slice('__TEMPLATE__:'.length);
        const unescapedContent = content
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\');
        const templateNode = parseTemplateString(unescapedContent, registry);
        return { node: templateNode, newIndex: i + 1 };
    }
    
    const definition = registry.get(token);
    if (definition) {
        return definition.handler(tokens, i, registry);
    }
    
    return parseLiteral(tokens, i);
}

function parseStarExpression(
    tokens: string[],
    i: number,
    registry: Map<string, SyntaxDefinition>,
    minPrecedence: number
): ParseResult {
    let leftResult = parseAtom(tokens, i, registry);
    let left = leftResult.node;
    let currentIndex = leftResult.newIndex;
    
    while (true) {
        const token = tokens[currentIndex];
        
        if (!token || token === ')' || token === ':') {
            break;
        }
        
        if (token === '?') {
            if (minPrecedence > 1) break;
            
            currentIndex++;
            const consequentResult = parseStarExpression(tokens, currentIndex, registry, 0);
            currentIndex = consequentResult.newIndex;
            
            if (tokens[currentIndex] === ':') {
                currentIndex++;
                const alternateResult = parseStarExpression(tokens, currentIndex, registry, 0);
                currentIndex = alternateResult.newIndex;
                
                const ternaryNode: TernaryExpressionNode = {
                    type: 'ternary',
                    test: left,
                    consequent: consequentResult.node,
                    alternate: alternateResult.node
                };
                left = ternaryNode;
            } else {
                const ternaryNode: TernaryExpressionNode = {
                    type: 'ternary',
                    test: left,
                    consequent: consequentResult.node,
                    alternate: { type: 'literal', value: '' }
                };
                left = ternaryNode;
            }
            continue;
        }
        
        if (!isBinaryOperator(token)) {
            break;
        }
        
        const precedence = getPrecedence(token);
        if (precedence < minPrecedence) {
            break;
        }
        
        const op = token as BinaryOperator;
        const rightAssociative = isRightAssociative(token);
        const nextMinPrecedence = rightAssociative ? precedence : precedence + 1;
        
        currentIndex++;
        const rightResult = parseStarExpression(tokens, currentIndex, registry, nextMinPrecedence);
        
        const binaryNode: BinaryExpressionNode = {
            type: 'binary',
            operator: op,
            left,
            right: rightResult.node
        };
        left = binaryNode;
        currentIndex = rightResult.newIndex;
    }
    
    return { node: left, newIndex: currentIndex };
}

const parseCompute: ParserHandler = (tokens, currentIndex, registry) => {
    const result = parseStarExpression(tokens, currentIndex + 1, registry, 0);
    let i = result.newIndex;
    
    if (tokens[i] === ')') {
        i++;
    }
    
    return { node: result.node, newIndex: i };
};

const parseConditional: ParserHandler = (tokens, currentIndex, registry) => {
    let i = currentIndex + 1;
    
    const firstResult = parseExpression(tokens, i, registry);
    i = firstResult.newIndex;
    
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
    
    let left: AstNode | undefined;
    let right: AstNode | undefined;
    let condition: AstNode | undefined;
    
    if (operator) {
        left = firstResult.node;
        const rightResult = parseExpression(tokens, i, registry);
        right = rightResult.node;
        i = rightResult.newIndex;
    } else {
        condition = firstResult.node;
    }
    
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
        ...(condition ? { condition } : {}),
        ...(left ? { left } : {}),
        operator: operator || undefined,
        ...(right ? { right } : {}),
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
        handler: parseCompute
    });
    
    registry.set('^(', {
        startToken: '^(',
        endToken: ')',
        handler: parseExists
    });
    
    return registry;
};

export const SyntaxRegistry = createSyntaxRegistry();

export function registerSyntax(definition: SyntaxDefinition): void {
    SyntaxRegistry.set(definition.startToken, definition);
}
