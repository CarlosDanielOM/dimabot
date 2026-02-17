import type { AstNode, ExecutionContext, EvaluateResult, LiteralNode, GetVarNode, SetVarNode, FunctionNode, ConditionalNode, CustomNode, RootNode } from './types.js';

type ComparisonOperator = '==' | '=' | '!=' | '<>' | '>' | '<' | '>=' | '<=' | '~=';

function safeCompare(left: string, operator: ComparisonOperator, right: string): boolean {
    const trimmedLeft = String(left).trim();
    const trimmedRight = String(right).trim();
    
    const leftNum = parseFloat(trimmedLeft);
    const rightNum = parseFloat(trimmedRight);
    const bothNumeric = !isNaN(leftNum) && !isNaN(rightNum);
    
    switch (operator) {
        case '==':
        case '=':
            return bothNumeric ? leftNum === rightNum : trimmedLeft.toLowerCase() === trimmedRight.toLowerCase();
        case '!=':
        case '<>':
            return bothNumeric ? leftNum !== rightNum : trimmedLeft.toLowerCase() !== trimmedRight.toLowerCase();
        case '>':
            return bothNumeric ? leftNum > rightNum : trimmedLeft > trimmedRight;
        case '<':
            return bothNumeric ? leftNum < rightNum : trimmedLeft < trimmedRight;
        case '>=':
            return bothNumeric ? leftNum >= rightNum : trimmedLeft >= trimmedRight;
        case '<=':
            return bothNumeric ? leftNum <= rightNum : trimmedLeft <= trimmedRight;
        case '~=':
            return trimmedLeft.toLowerCase().includes(trimmedRight.toLowerCase());
        default:
            return false;
    }
}

export type FunctionHandler = (args: unknown[], context: ExecutionContext) => Promise<unknown>;

const functionRegistry = new Map<string, FunctionHandler>();

export function registerFunction(name: string, handler: FunctionHandler): void {
    functionRegistry.set(name, handler);
}

export function getFunctionHandler(name: string): FunctionHandler | undefined {
    return functionRegistry.get(name);
}

export async function evaluate(node: AstNode, context: ExecutionContext): Promise<EvaluateResult> {
    switch (node.type) {
        case 'literal': {
            const literalNode = node as LiteralNode;
            return { value: literalNode.value, context };
        }
        
        case 'getVar': {
            const getNode = node as GetVarNode;
            const value = context.variables.get(getNode.name) ?? '';
            return { value: String(value), context };
        }
        
        case 'setVar': {
            const setNode = node as SetVarNode;
            const valueResult = await evaluate(setNode.value, context);
            const value = String(valueResult.value);
            context.variables.set(setNode.name, value);
            return { value, context: valueResult.context };
        }
        
        case 'function': {
            const funcNode = node as FunctionNode;
            const evaluatedArgs = await Promise.all(
                funcNode.args.map(arg => evaluate(arg, context))
            );
            const args = evaluatedArgs.map(r => r.value);
            
            const handler = functionRegistry.get(funcNode.name);
            if (!handler) {
                return { value: `[Unknown function: ${funcNode.name}]`, context };
            }
            
            const result = await handler(args, context);
            return { value: result, context };
        }
        
        case 'conditional': {
            const condNode = node as ConditionalNode;
            const leftResult = await evaluate(condNode.left, context);
            const rightResult = await evaluate(condNode.right, context);
            
            const leftValue = String(leftResult.value);
            const rightValue = String(rightResult.value);
            const result = safeCompare(leftValue, condNode.operator as ComparisonOperator, rightValue);
            
            const branchResult = await evaluate(
                result ? condNode.trueBranch : condNode.falseBranch,
                rightResult.context
            );
            
            return { value: branchResult.value, context: branchResult.context };
        }
        
        case 'custom': {
            const customNode = node as CustomNode;
            return { value: `[Custom node not implemented: ${customNode.customType}]`, context };
        }
        
        case 'root': {
            const rootNode = node as RootNode;
            const results: string[] = [];
            let currentContext = context;
            
            for (const child of rootNode.children) {
                const result = await evaluate(child, currentContext);
                currentContext = result.context;
                if (result.value !== undefined && result.value !== '') {
                    results.push(String(result.value));
                }
            }
            
            return { value: results.join(' '), context: currentContext };
        }
        
        default:
            return { value: '', context };
    }
}

export function createExecutionContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
    return {
        variables: new Map<string, unknown>(),
        broadcasterId: '',
        userId: '',
        userLogin: '',
        userDisplayName: '',
        userPlan: 'free',
        userLevel: 1,
        count: 0,
        streamer: null,
        ...overrides
    };
}
