import type { RootNode, AstNode, AstParseResult, LiteralNode } from './types.js';
import { tokenize } from './tokenizer.js';
import { parseExpression, SyntaxRegistry } from './registry.js';
import type { SyntaxDefinition } from './types.js';

export function parse(input: string, registry: Map<string, SyntaxDefinition> = SyntaxRegistry): AstParseResult {
    const { tokens, error: tokenizeError } = tokenize(input, registry);
    
    if (tokenizeError) {
        return {
            ast: { type: 'root', children: [] },
            error: tokenizeError
        };
    }
    
    const children: AstNode[] = [];
    let i = 0;
    
    while (i < tokens.length) {
        const token = tokens[i];
        
        const definition = registry.get(token);
        if (definition) {
            const result = definition.handler(tokens, i, registry);
            children.push(result.node);
            i = result.newIndex;
        } else if (token === ')') {
            i++;
        } else {
            const literalNode: LiteralNode = {
                type: 'literal',
                value: token
            };
            children.push(literalNode);
            i++;
        }
    }
    
    const ast: RootNode = {
        type: 'root',
        children
    };
    
    return { ast };
}

export function parseToAst(input: string): AstParseResult {
    return parse(input);
}

export function printAst(node: AstNode, indent: number = 0): string {
    const prefix = '  '.repeat(indent);
    let output = '';
    
    switch (node.type) {
        case 'root':
            output += `${prefix}ROOT\n`;
            for (const child of node.children) {
                output += printAst(child, indent + 1);
            }
            break;
            
        case 'setVar':
            output += `${prefix}SetVar\n`;
            output += `${prefix}  name: "${node.name}"\n`;
            output += `${prefix}  value:\n`;
            output += printAst(node.value, indent + 2);
            break;
            
        case 'getVar':
            output += `${prefix}GetVar("${node.name}")\n`;
            break;
            
        case 'function':
            output += `${prefix}Function("${node.name}")\n`;
            if (node.args.length > 0) {
                output += `${prefix}  args:\n`;
                for (const arg of node.args) {
                    output += printAst(arg, indent + 2);
                }
            }
            break;
            
        case 'conditional':
            output += `${prefix}Conditional\n`;
            output += `${prefix}  left:\n`;
            output += printAst(node.left, indent + 2);
            output += `${prefix}  operator: "${node.operator}"\n`;
            output += `${prefix}  right:\n`;
            output += printAst(node.right, indent + 2);
            output += `${prefix}  trueBranch:\n`;
            output += printAst(node.trueBranch, indent + 2);
            output += `${prefix}  falseBranch:\n`;
            output += printAst(node.falseBranch, indent + 2);
            break;
            
        case 'literal':
            output += `${prefix}Literal("${node.value}")\n`;
            break;
            
        case 'custom':
            output += `${prefix}Custom("${node.customType}")\n`;
            output += `${prefix}  data: ${JSON.stringify(node.data)}\n`;
            break;
    }
    
    return output;
}
