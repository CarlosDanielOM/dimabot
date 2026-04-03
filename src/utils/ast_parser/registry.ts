import type { AstNode, ParseResult, ParserHandler, SyntaxDefinition, LiteralNode, GetVarNode, SetVarNode, ExistsNode, FunctionNode, ConditionalNode, BinaryExpressionNode, UnaryExpressionNode, TernaryExpressionNode, TemplateNode, TemplateSegment, VariableStorage, ArrayAccessor, BinaryOperator, UnaryOperator, ArrayLiteralNode, LoopAssignNode, LoopAssignOperator, LoopVarNode, ForLoopNode } from './types.js';
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

function isLoopVarToken(token: string | undefined): token is `#${string}` {
    return typeof token === 'string' && /^#[a-zA-Z_][a-zA-Z0-9_]*$/.test(token);
}

function createLoopVarNode(rawName: string): LoopVarNode {
    return {
        type: 'loopVar',
        name: rawName.slice(1)
    };
}

function parseTokensToNodes(tokens: string[], registry: Map<string, SyntaxDefinition>): AstNode[] {
    const nodes: AstNode[] = [];
    let i = 0;

    while (i < tokens.length) {
        const token = tokens[i];

        if (!token || token === ';' || token === '}' || token === ')') {
            i++;
            continue;
        }

        const result = parseExpression(tokens, i, registry);
        if (result.node.type !== 'literal' || (result.node as LiteralNode).value !== '') {
            nodes.push(result.node);
        }

        if (result.newIndex === i) {
            i++;
            continue;
        }

        i = result.newIndex;
    }

    return nodes;
}

function parseTokensToSingleNode(tokens: string[], registry: Map<string, SyntaxDefinition>): AstNode {
    if (tokens.length === 0) {
        return { type: 'literal', value: '' };
    }

    const result = parseStarExpression(tokens, 0, registry, 0);
    const remaining = tokens.slice(result.newIndex).filter((token) => token !== ';' && token !== ')' && token !== '}');

    if (remaining.length === 0) {
        return result.node;
    }

    const nodes = [result.node, ...parseTokensToNodes(remaining, registry)];
    return { type: 'root', children: nodes };
}

function findTopLevelToken(tokens: string[], target: string, startIndex: number, endIndex: number): number {
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    for (let i = startIndex; i < endIndex; i++) {
        const token = tokens[i];

        if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && token === target) {
            return i;
        }

        if (token === '(' || token.endsWith('(')) {
            parenDepth++;
            continue;
        }

        if (token === ')') {
            if (parenDepth > 0) {
                parenDepth--;
            }
            continue;
        }

        if (token === '[') {
            bracketDepth++;
            continue;
        }

        if (token === ']') {
            if (bracketDepth > 0) {
                bracketDepth--;
            }
            continue;
        }

        if (token === '{') {
            braceDepth++;
            continue;
        }

        if (token === '}') {
            if (braceDepth > 0) {
                braceDepth--;
            }
            continue;
        }
    }

    return -1;
}

function parseLoopVarOrAssignment(tokens: string[], currentIndex: number, registry: Map<string, SyntaxDefinition>): ParseResult {
    const rawName = tokens[currentIndex];

    if (!isLoopVarToken(rawName)) {
        return parseLiteral(tokens, currentIndex);
    }

    const operatorToken = tokens[currentIndex + 1];
    if (operatorToken && ['=', '+=', '-=', '*=', '/=', '%=', '++', '--'].includes(operatorToken)) {
        const operator = operatorToken as LoopAssignOperator;

        if (operator === '++' || operator === '--') {
            const node: LoopAssignNode = {
                type: 'loopAssign',
                name: rawName.slice(1),
                operator
            };
            return { node, newIndex: currentIndex + 2 };
        }

        const valueResult = parseStarExpression(tokens, currentIndex + 2, registry, 0);
        const node: LoopAssignNode = {
            type: 'loopAssign',
            name: rawName.slice(1),
            operator,
            value: valueResult.node
        };
        return { node, newIndex: valueResult.newIndex };
    }

    return {
        node: createLoopVarNode(rawName),
        newIndex: currentIndex + 1
    };
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

function splitArrayLiteralItems(content: string): string[] {
    const items: string[] = [];
    let current = '';
    let inQuote: 'single' | 'double' | null = null;
    let bracketDepth = 0;
    let parenDepth = 0;
    let braceDepth = 0;

    for (let i = 0; i < content.length; i++) {
        const char = content[i];

        if (inQuote) {
            current += char;
            if (char === '\\' && i + 1 < content.length) {
                current += content[i + 1];
                i++;
                continue;
            }

            if ((inQuote === 'single' && char === '\'') || (inQuote === 'double' && char === '"')) {
                inQuote = null;
            }
            continue;
        }

        if (char === '"') {
            inQuote = 'double';
            current += char;
            continue;
        }

        if (char === '\'') {
            inQuote = 'single';
            current += char;
            continue;
        }

        if (char === '[') {
            bracketDepth++;
            current += char;
            continue;
        }

        if (char === ']') {
            bracketDepth = Math.max(0, bracketDepth - 1);
            current += char;
            continue;
        }

        if (char === '(') {
            parenDepth++;
            current += char;
            continue;
        }

        if (char === ')') {
            parenDepth = Math.max(0, parenDepth - 1);
            current += char;
            continue;
        }

        if (char === '{') {
            braceDepth++;
            current += char;
            continue;
        }

        if (char === '}') {
            braceDepth = Math.max(0, braceDepth - 1);
            current += char;
            continue;
        }

        if (char === ',' && bracketDepth === 0 && parenDepth === 0 && braceDepth === 0) {
            const trimmed = current.trim();
            if (trimmed.length > 0) {
                items.push(trimmed);
            }
            current = '';
            continue;
        }

        current += char;
    }

    const last = current.trim();
    if (last.length > 0) {
        items.push(last);
    }

    return items;
}

function parseArrayLiteral(content: string, registry: Map<string, SyntaxDefinition>): ArrayLiteralNode {
    const rawItems = splitArrayLiteralItems(content);
    const items: AstNode[] = [];

    for (const rawItem of rawItems) {
        const tokenized = tokenize(rawItem, registry);

        if (tokenized.tokens.length === 0) {
            items.push({ type: 'literal', value: '' });
            continue;
        }

        const itemResult = parseStarExpression(tokenized.tokens, 0, registry, 0);
        items.push(itemResult.node);
    }

    return {
        type: 'arrayLiteral',
        items
    };
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

    if (token === ';' || token === '}' || token === ')') {
        return { node: { type: 'literal', value: '' }, newIndex: currentIndex + (token === ')' ? 0 : 1) };
    }

    if (isLoopVarToken(token)) {
        return parseLoopVarOrAssignment(tokens, currentIndex, registry);
    }
    
    const definition = registry.get(token);
    if (definition) {
        return definition.handler(tokens, currentIndex, registry);
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

    if (token.startsWith('__ARRAY__:')) {
        const content = token.slice('__ARRAY__:'.length);
        const arrayNode = parseArrayLiteral(content, registry);
        return { node: arrayNode, newIndex: currentIndex + 1 };
    }
    
    return parseLiteral(tokens, currentIndex);
};

const parseVariable: ParserHandler = (tokens, currentIndex, registry) => {
    const rawName = tokens[currentIndex + 1];
    const { storage } = parseVarName(rawName);
    let i = currentIndex + 2;

    let userSelector: AstNode | undefined;
    if ((storage === 'cacheUser' || storage === 'dbUser') && tokens[i] === '(') {
        const selectorResult = parseExpression(tokens, i + 1, registry);
        userSelector = selectorResult.node;
        i = selectorResult.newIndex;
        if (tokens[i] === ')') {
            i++;
        }
    }
    
    let accessor: ArrayAccessor | undefined;
    
    if (tokens[i] === '[') {
        i++;
        
        if (tokens[i] === ']') {
            i++;
            accessor = { type: 'array' };
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
    }

    if (tokens[i] === '.') {
        i++;
        if (tokens[i] === 'length') {
            i++;
            accessor = { type: 'length' };
        }
    }
    
    const nextToken = tokens[i];
    
    if (accessor?.type === 'array' && nextToken && nextToken !== ')' && nextToken !== '.') {
        const valueResult = parseExpression(tokens, i, registry);
        i = valueResult.newIndex;
        if (tokens[i] === ')') i++;
        
        const setNode: SetVarNode = {
            type: 'setVar',
            name: rawName,
            storage,
            value: valueResult.node,
            accessor: { type: 'append' },
            userSelector
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
            accessor: { type: 'setIndex', index: accessor.index },
            userSelector
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
            value: valueResult.node,
            userSelector
        };
        return { node: setNode, newIndex: i };
    }
    
    if (tokens[i] === ')') i++;
    
    const getNode: GetVarNode = {
        type: 'getVar',
        name: rawName,
        storage,
        accessor,
        userSelector
    };
    return { node: getNode, newIndex: i };
};

const parseExists: ParserHandler = (tokens, currentIndex, registry) => {
    const rawName = tokens[currentIndex + 1];
    const { storage } = parseVarName(rawName);
    let i = currentIndex + 2;

    let userSelector: AstNode | undefined;
    if ((storage === 'cacheUser' || storage === 'dbUser') && tokens[i] === '(') {
        const selectorResult = parseExpression(tokens, i + 1, registry);
        userSelector = selectorResult.node;
        i = selectorResult.newIndex;
        if (tokens[i] === ')') {
            i++;
        }
    }
    
    let accessor: ArrayAccessor | undefined;
    
    if (tokens[i] === '[') {
        i++;
        
        if (tokens[i] === ']') {
            i++;
            accessor = { type: 'array' };
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
    }

    if (tokens[i] === '.') {
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
        accessor,
        userSelector
    };
    return { node: existsNode, newIndex: i };
};

const parseCommandRef: ParserHandler = (tokens, currentIndex, registry) => {
    let i = currentIndex + 1;
    const commandName = tokens[i];

    if (!commandName || commandName === ')') {
        return { node: { type: 'literal', value: '' }, newIndex: currentIndex + 2 };
    }

    i++;
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

    return {
        node: {
            type: 'commandRef',
            commandName: String(commandName),
            args
        },
        newIndex: i
    };
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
    
    if (token === undefined || token === ')' || token === ';' || token === '}') {
        return { node: { type: 'literal', value: '' }, newIndex: i };
    }

    if (isLoopVarToken(token)) {
        return parseLoopVarOrAssignment(tokens, i, registry);
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

    if (token.startsWith('__ARRAY__:')) {
        const content = token.slice('__ARRAY__:'.length);
        const arrayNode = parseArrayLiteral(content, registry);
        return { node: arrayNode, newIndex: i + 1 };
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
        
        if (!token || token === ')' || token === ':' || token === ';' || token === '}') {
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

function parseForLoop(tokens: string[], currentIndex: number, registry: Map<string, SyntaxDefinition>): ParseResult {
    let i = currentIndex + 1;

    if (String(tokens[i] || '').toLowerCase() !== 'for') {
        return { node: { type: 'literal', value: '[Loop error: invalid loop syntax]' }, newIndex: currentIndex + 1 };
    }

    i++;
    const loopVarToken = tokens[i];
    if (!isLoopVarToken(loopVarToken)) {
        return { node: { type: 'literal', value: '[Loop error: invalid loop variable]' }, newIndex: currentIndex + 1 };
    }

    const loopVar = loopVarToken.slice(1);
    i++;

    const bodyStart = findTopLevelToken(tokens, '{', i, tokens.length);
    if (bodyStart === -1) {
        return { node: { type: 'literal', value: '[Loop error: missing loop body]' }, newIndex: currentIndex + 1 };
    }

    let braceDepth = 1;
    let bodyEnd = bodyStart + 1;
    while (bodyEnd < tokens.length && braceDepth > 0) {
        if (tokens[bodyEnd] === '{') {
            braceDepth++;
        } else if (tokens[bodyEnd] === '}') {
            braceDepth--;
        }
        bodyEnd++;
    }

    if (braceDepth !== 0) {
        return { node: { type: 'literal', value: '[Loop error: unclosed loop body]' }, newIndex: currentIndex + 1 };
    }

    const bodyTokens = tokens.slice(bodyStart + 1, bodyEnd - 1);
    const body = parseTokensToNodes(bodyTokens, registry);
    const modeToken = String(tokens[i] || '').toLowerCase();

    let loopNode: ForLoopNode;
    if (modeToken === 'in') {
        const iterable = parseTokensToSingleNode(tokens.slice(i + 1, bodyStart), registry);
        loopNode = {
            type: 'forLoop',
            loopVar,
            mode: 'foreach',
            iterable,
            body
        };
    } else {
        const firstSemi = findTopLevelToken(tokens, ';', i, bodyStart);
        const secondSemi = firstSemi === -1 ? -1 : findTopLevelToken(tokens, ';', firstSemi + 1, bodyStart);

        if (firstSemi === -1 || secondSemi === -1) {
            return { node: { type: 'literal', value: '[Loop error: invalid range loop syntax]' }, newIndex: currentIndex + 1 };
        }

        const init = parseTokensToSingleNode(tokens.slice(i - 1, firstSemi), registry);
        const condition = parseTokensToSingleNode(tokens.slice(firstSemi + 1, secondSemi), registry);
        const update = parseTokensToSingleNode(tokens.slice(secondSemi + 1, bodyStart), registry);

        loopNode = {
            type: 'forLoop',
            loopVar,
            mode: 'range',
            init,
            condition,
            update,
            body
        };
    }

    let newIndex = bodyEnd;
    if (tokens[newIndex] === ')') {
        newIndex++;
    }

    return { node: loopNode, newIndex };
}

const parseCompute: ParserHandler = (tokens, currentIndex, registry) => {
    if (String(tokens[currentIndex + 1] || '').toLowerCase() === 'for') {
        return parseForLoop(tokens, currentIndex, registry);
    }

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

    registry.set('#(', {
        startToken: '#(',
        endToken: ')',
        handler: parseCommandRef
    });
    
    return registry;
};

export const SyntaxRegistry = createSyntaxRegistry();

export function registerSyntax(definition: SyntaxDefinition): void {
    SyntaxRegistry.set(definition.startToken, definition);
}
