import type { TokenizeResult, SyntaxDefinition } from './types.js';
import { escapeRegExp, SyntaxRegistry } from './registry.js';

export function tokenize(input: string, registry: Map<string, SyntaxDefinition> = SyntaxRegistry): TokenizeResult {
    const tokens: string[] = [];
    let i = 0;
    
    const startTokens = Array.from(registry.keys());
    
    while (i < input.length) {
        const remaining = input.slice(i);
        
        let matched = false;
        
        for (const startToken of startTokens) {
            if (remaining.startsWith(startToken)) {
                tokens.push(startToken);
                i += startToken.length;
                matched = true;
                break;
            }
        }
        
        if (matched) continue;
        
        if (remaining[0] === ')') {
            tokens.push(')');
            i += 1;
            continue;
        }
        
        if (remaining[0] === '"') {
            let endQuote = i + 1;
            while (endQuote < input.length && input[endQuote] !== '"') {
                if (input[endQuote] === '\\' && endQuote + 1 < input.length) {
                    endQuote += 2;
                } else {
                    endQuote++;
                }
            }
            
            const quotedContent = input.slice(i + 1, endQuote);
            tokens.push(quotedContent);
            i = endQuote + 1;
            continue;
        }
        
        if (remaining[0] === '?') {
            tokens.push('?');
            i += 1;
            continue;
        }
        
        if (remaining[0] === ':') {
            tokens.push(':');
            i += 1;
            continue;
        }
        
        const opMatch = remaining.match(/^(==|!=|>=|<=|~=|<>|[=<>])/);
        if (opMatch) {
            tokens.push(opMatch[1]);
            i += opMatch[1].length;
            continue;
        }
        
        if (/\s/.test(remaining[0])) {
            i += 1;
            continue;
        }
        
        let literalEnd = i;
        while (literalEnd < input.length) {
            const char = input[literalEnd];
            const slice = input.slice(literalEnd);
            
            if (/\s/.test(char)) break;
            if (char === ')') break;
            if (char === '?' || char === ':') break;
            
            let isStartToken = false;
            for (const startToken of startTokens) {
                if (slice.startsWith(startToken)) {
                    isStartToken = true;
                    break;
                }
            }
            if (isStartToken) break;
            
            const opMatch = slice.match(/^(==|!=|>=|<=|~=|<>|[=<>])/);
            if (opMatch) break;
            
            literalEnd++;
        }
        
        if (literalEnd > i) {
            const literal = input.slice(i, literalEnd);
            tokens.push(literal);
            i = literalEnd;
        } else {
            i++;
        }
    }
    
    return { tokens };
}

export function buildTokenizerRegex(registry: Map<string, SyntaxDefinition>): RegExp {
    const startTokens = Array.from(registry.keys());
    const escaped = startTokens.map(t => escapeRegExp(t));
    
    return new RegExp(`(${escaped.join('|')}|\\s+|"|\\?|:|\\)|==|!=|>=|<=|~=|<>|[=<>])`);
}
