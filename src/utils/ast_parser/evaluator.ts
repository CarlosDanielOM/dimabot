import { commandHandler } from '../../handlers/commands.handler.js';
import { getDragonflyClient } from '../../utils/databases/dragonfly.database.js';
import { parse } from './parser.js';
import type {
    ArrayLiteralNode,
    AstNode,
    BinaryExpressionNode,
    CommandRefNode,
    ConditionalNode,
    CustomNode,
    EvaluateResult,
    ExecutionContext,
    ExistsNode,
    FunctionNode,
    GetVarNode,
    LiteralNode,
    RootNode,
    SetVarNode,
    TemplateNode,
    TernaryExpressionNode,
    UnaryExpressionNode,
    VariableStorage
} from './types.js';

type InternalComparisonOperator = '==' | '=' | '!=' | '<>' | '>' | '<' | '>=' | '<=' | '~=';

function toNumberSafe(value: unknown): number {
    if (typeof value === 'number' && !isNaN(value) && isFinite(value)) {
        return value;
    }
    const str = String(value ?? '').trim();
    if (str === '' || str === 'null' || str === 'undefined') {
        return 0;
    }
    const num = parseFloat(str);
    return isNaN(num) || !isFinite(num) ? 0 : num;
}

function isTruthy(value: unknown): boolean {
    if (value === true || value === 1) return true;
    if (value === false || value === 0 || value === null || value === undefined) return false;
    const str = String(value).toLowerCase().trim();
    if (str === 'true' || str === '1') return true;
    if (str === 'false' || str === '0' || str === '') return false;
    return true;
}

function stripVarPrefix(name: string, storage: VariableStorage): string {
    switch (storage) {
        case 'dbUser':
            return name.startsWith('**') ? name.slice(2) : name;
        case 'db':
            return name.startsWith('*') && !name.startsWith('**') ? name.slice(1) : name;
        case 'cacheUser':
            return name.startsWith('##') ? name.slice(2) : name;
        case 'cache':
            return name.startsWith('#') && !name.startsWith('##') ? name.slice(1) : name;
        default:
            return name;
    }
}

function safeCompare(left: string, operator: InternalComparisonOperator, right: string): boolean {
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

function buildCacheKey(
    platform: string,
    channelId: string,
    scopeType: string,
    scopeName: string,
    varName: string,
    userScope?: string
): string {
    const normalizedScopeName = String(scopeName || '').trim().replace(/\s+/g, '_') || 'default';
    const normalizedScopeType = String(scopeType || '').trim() || 'command';

    if (userScope) {
        return `${platform}:${channelId}:scope:${normalizedScopeType}:${normalizedScopeName}:${varName}:${userScope}`;
    }
    return `${platform}:${channelId}:scope:${normalizedScopeType}:${normalizedScopeName}:${varName}`;
}

function normalizeUserLogin(login: string): string {
    return String(login || '').trim().replace(/^@+/, '').toLowerCase();
}

function getCacheUserScopeCandidates(context: ExecutionContext, targetUserLogin?: string): string[] {
    const normalizedTarget = normalizeUserLogin(String(targetUserLogin || ''));
    if (normalizedTarget) {
        return [`login:${normalizedTarget}`];
    }

    const candidates: string[] = [];
    if (context.userId) {
        candidates.push(`id:${context.userId}`);
    }
    const normalizedCurrentLogin = normalizeUserLogin(context.userLogin);
    if (normalizedCurrentLogin) {
        candidates.push(`login:${normalizedCurrentLogin}`);
    }

    return candidates.length > 0 ? [...new Set(candidates)] : ['id:unknown'];
}

function getScopeCandidates(context: ExecutionContext): string[] {
    const candidates = [context.scopeName, ...(context.scopeAliases || [])]
        .map((scope) => String(scope || '').trim())
        .filter((scope) => scope.length > 0);

    if (candidates.length === 0) {
        return ['default'];
    }

    return [...new Set(candidates)];
}

function canWriteDbVariables(plan: 'free' | 'premium' | 'pro'): boolean {
    return plan === 'premium' || plan === 'pro';
}

async function getValueFromStorage(
    name: string,
    storage: VariableStorage,
    context: ExecutionContext,
    targetUserLogin?: string
): Promise<string> {
    const strippedName = stripVarPrefix(name, storage);

    switch (storage) {
        case 'memory': {
            const val = context.variables.get(strippedName);
            if (val !== undefined) return String(val);
            const arr = context.arrays.get(strippedName);
            if (arr) return JSON.stringify(arr);
            return '';
        }

        case 'cache':
        case 'cacheUser': {
            const redis = await getDragonflyClient();
            const scopeCandidates = getScopeCandidates(context);
            const userScopeCandidates = storage === 'cacheUser'
                ? getCacheUserScopeCandidates(context, targetUserLogin)
                : [undefined];

            for (const scopeName of scopeCandidates) {
                for (const userScope of userScopeCandidates) {
                    const key = buildCacheKey(
                        context.platform,
                        context.broadcasterId,
                        context.scopeType,
                        scopeName,
                        strippedName,
                        userScope
                    );
                    const cached = await redis.get(key);
                    if (cached !== null && cached !== undefined) {
                        return cached;
                    }
                }
            }
            return '';
        }

        case 'db': {
            if (context.commandVariables.has(strippedName)) {
                return context.commandVariables.get(strippedName) ?? '';
            }
            const loadedValue = await context.loadChannelVariable(strippedName);
            if (loadedValue !== undefined && loadedValue !== null && loadedValue !== '') {
                context.commandVariables.set(strippedName, loadedValue);
                return loadedValue;
            }
            return '';
        }

        case 'dbUser': {
            if (context.userCommandVariables.has(strippedName)) {
                return context.userCommandVariables.get(strippedName) ?? '';
            }
            const loadedValue = await context.loadUserVariable(strippedName, targetUserLogin);
            if (loadedValue !== undefined && loadedValue !== null && loadedValue !== '') {
                context.userCommandVariables.set(strippedName, loadedValue);
                return loadedValue;
            }
            return '';
        }

        default:
            return '';
    }
}

async function getArrayFromStorage(
    name: string,
    storage: VariableStorage,
    context: ExecutionContext,
    targetUserLogin?: string
): Promise<string[]> {
    if (name === 'responses' && storage === 'memory') {
        return context.commandResponses;
    }

    const value = await getValueFromStorage(name, storage, context, targetUserLogin);
    if (!value) return [];

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [String(parsed)];
    } catch {
        return [];
    }
}

async function checkKeyExists(
    name: string,
    storage: VariableStorage,
    context: ExecutionContext,
    targetUserLogin?: string
): Promise<boolean> {
    const strippedName = stripVarPrefix(name, storage);

    switch (storage) {
        case 'memory': {
            if (context.variables.has(strippedName)) return true;
            if (context.arrays.has(strippedName)) return true;
            return false;
        }

        case 'cache':
        case 'cacheUser': {
            const redis = await getDragonflyClient();
            const scopeCandidates = getScopeCandidates(context);
            const userScopeCandidates = storage === 'cacheUser'
                ? getCacheUserScopeCandidates(context, targetUserLogin)
                : [undefined];

            for (const scopeName of scopeCandidates) {
                for (const userScope of userScopeCandidates) {
                    const key = buildCacheKey(
                        context.platform,
                        context.broadcasterId,
                        context.scopeType,
                        scopeName,
                        strippedName,
                        userScope
                    );
                    const exists = await redis.exists(key);
                    if (exists === 1) {
                        return true;
                    }
                }
            }
            return false;
        }

        case 'db': {
            if (context.commandVariables.has(strippedName)) {
                return true;
            }
            const loadedValue = await context.loadChannelVariable(strippedName);
            if (loadedValue !== undefined && loadedValue !== null && loadedValue !== '') {
                context.commandVariables.set(strippedName, loadedValue);
                return true;
            }
            return false;
        }

        case 'dbUser': {
            if (context.userCommandVariables.has(strippedName)) {
                return true;
            }
            const loadedValue = await context.loadUserVariable(strippedName, targetUserLogin);
            if (loadedValue !== undefined && loadedValue !== null && loadedValue !== '') {
                context.userCommandVariables.set(strippedName, loadedValue);
                return true;
            }
            return false;
        }

        default:
            return false;
    }
}

async function checkArrayKeyExists(
    name: string,
    storage: VariableStorage,
    context: ExecutionContext,
    targetUserLogin?: string
): Promise<boolean> {
    if (name === 'responses' && storage === 'memory') {
        return context.commandResponses.length > 0;
    }

    return checkKeyExists(name, storage, context, targetUserLogin);
}

async function saveValueToStorage(
    name: string,
    storage: VariableStorage,
    value: string,
    context: ExecutionContext
): Promise<void> {
    const strippedName = stripVarPrefix(name, storage);

    if ((storage === 'db' || storage === 'dbUser') && !canWriteDbVariables(context.userPlan)) {
        return;
    }

    switch (storage) {
        case 'memory': {
            context.variables.set(strippedName, value);
            break;
        }

        case 'cache':
        case 'cacheUser': {
            const redis = await getDragonflyClient();
            if (storage === 'cacheUser') {
                const userScopeCandidates = getCacheUserScopeCandidates(context);
                for (const userScope of userScopeCandidates) {
                    const key = buildCacheKey(
                        context.platform,
                        context.broadcasterId,
                        context.scopeType,
                        context.scopeName,
                        strippedName,
                        userScope
                    );
                    await redis.set(key, value);
                    await redis.expire(key, 86400);
                }
            } else {
                const key = buildCacheKey(
                    context.platform,
                    context.broadcasterId,
                    context.scopeType,
                    context.scopeName,
                    strippedName
                );
                await redis.set(key, value);
                await redis.expire(key, 86400);
            }
            break;
        }

        case 'db':
            await context.saveChannelVariable(strippedName, value);
            context.commandVariables.set(strippedName, value);
            break;

        case 'dbUser':
            await context.saveUserVariable(strippedName, value);
            context.userCommandVariables.set(strippedName, value);
            break;
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
            const { name, storage, accessor, userSelector } = getNode;
            let targetUserLogin: string | undefined;
            let workingContext = context;

            if ((storage === 'cacheUser' || storage === 'dbUser') && userSelector) {
                const selectorResult = await evaluate(userSelector, workingContext);
                targetUserLogin = String(selectorResult.value ?? '').trim();
                workingContext = selectorResult.context;
            }

            if (name === 'responses' && storage === 'memory') {
                if (!accessor) {
                    return { value: JSON.stringify(context.commandResponses), context };
                }

                switch (accessor.type) {
                    case 'index': {
                        const indexResult = await evaluate(accessor.index, context);
                        const index = parseInt(String(indexResult.value), 10);
                        if (isNaN(index) || index < 0 || index >= context.commandResponses.length) {
                            return { value: '', context };
                        }
                        return { value: context.commandResponses[index], context };
                    }

                    case 'random': {
                        if (context.commandResponses.length === 0) return { value: '', context };
                        const idx = Math.floor(Math.random() * context.commandResponses.length);
                        return { value: context.commandResponses[idx], context };
                    }

                    case 'length': {
                        return { value: String(context.commandResponses.length), context };
                    }
                }
                return { value: '', context };
            }

            if (!accessor) {
                const value = await getValueFromStorage(name, storage, workingContext, targetUserLogin);
                return { value, context: workingContext };
            }

            const arrayData = await getArrayFromStorage(name, storage, workingContext, targetUserLogin);

            switch (accessor.type) {
                case 'index': {
                    const indexResult = await evaluate(accessor.index, workingContext);
                    const index = parseInt(String(indexResult.value), 10);
                    if (isNaN(index) || index < 0 || index >= arrayData.length) {
                        return { value: '', context: workingContext };
                    }
                    return { value: arrayData[index], context: workingContext };
                }

                case 'random': {
                    if (arrayData.length === 0) return { value: '', context: workingContext };
                    const idx = Math.floor(Math.random() * arrayData.length);
                    return { value: arrayData[idx], context: workingContext };
                }

                case 'length': {
                    return { value: String(arrayData.length), context: workingContext };
                }
            }
            return { value: '', context: workingContext };
        }

        case 'setVar': {
            const setNode = node as SetVarNode;
            const { name, storage, value, accessor } = setNode;
            const valueResult = await evaluate(value, context);
            const valueStr = String(valueResult.value);
            let currentContext = valueResult.context;
            const appendValues = Array.isArray(valueResult.value)
                ? valueResult.value.map((item) => String(item))
                : [valueStr];

            if (name === 'responses' && storage === 'memory') {
                if (accessor?.type === 'append') {
                    context.commandResponses.push(...appendValues);
                    await context.saveResponses();
                    return { value: '', context: currentContext };
                }

                if (accessor?.type === 'setIndex') {
                    const indexResult = await evaluate(accessor.index, currentContext);
                    const index = parseInt(String(indexResult.value), 10);
                    if (!isNaN(index) && index >= 0 && index < context.commandResponses.length) {
                        context.commandResponses[index] = valueStr;
                        await context.saveResponses();
                    }
                    return { value: '', context: indexResult.context };
                }
                return { value: '', context: currentContext };
            }

            if (!accessor) {
                await saveValueToStorage(name, storage, valueStr, context);
                return { value: '', context: currentContext };
            }

            const arrayData = await getArrayFromStorage(name, storage, context);

            switch (accessor.type) {
                case 'append': {
                    arrayData.push(...appendValues);
                    await saveValueToStorage(name, storage, JSON.stringify(arrayData), context);
                    return { value: '', context: currentContext };
                }

                case 'setIndex': {
                    const indexResult = await evaluate(accessor.index, currentContext);
                    const index = parseInt(String(indexResult.value), 10);
                    if (!isNaN(index) && index >= 0 && index < arrayData.length) {
                        arrayData[index] = valueStr;
                        await saveValueToStorage(name, storage, JSON.stringify(arrayData), context);
                    }
                    return { value: '', context: indexResult.context };
                }
            }
            return { value: '', context: currentContext };
        }

        case 'function': {
            const funcNode = node as FunctionNode;
            const evaluatedArgs = await Promise.all(
                funcNode.args.map((arg) => evaluate(arg, context))
            );
            const args = evaluatedArgs.map((r) => r.value);

            const handler = functionRegistry.get(funcNode.name);
            if (!handler) {
                return { value: `[Unknown function: ${funcNode.name}]`, context };
            }

            const result = await handler(args, context);
            return { value: result, context };
        }

        case 'conditional': {
            const condNode = node as ConditionalNode;
            let result: boolean;
            let evalContext = context;

            if (condNode.condition) {
                const condResult = await evaluate(condNode.condition, context);
                evalContext = condResult.context;
                const condValue = String(condResult.value).toLowerCase().trim();
                if (condValue === 'true' || condValue === '1') {
                    result = true;
                } else if (condValue === 'false' || condValue === '0' || condValue === '') {
                    result = false;
                } else {
                    result = true;
                }
            } else if (condNode.left && condNode.right && condNode.operator) {
                const leftResult = await evaluate(condNode.left, context);
                const rightResult = await evaluate(condNode.right, leftResult.context);
                evalContext = rightResult.context;

                const leftValue = String(leftResult.value);
                const rightValue = String(rightResult.value);
                result = safeCompare(leftValue, condNode.operator as InternalComparisonOperator, rightValue);
            } else {
                result = false;
            }

            const branchResult = await evaluate(
                result ? condNode.trueBranch : condNode.falseBranch,
                evalContext
            );

            return { value: branchResult.value, context: branchResult.context };
        }

        case 'exists': {
            const existsNode = node as ExistsNode;
            const { name, storage, accessor, userSelector } = existsNode;
            let targetUserLogin: string | undefined;
            let workingContext = context;

            if ((storage === 'cacheUser' || storage === 'dbUser') && userSelector) {
                const selectorResult = await evaluate(userSelector, workingContext);
                targetUserLogin = String(selectorResult.value ?? '').trim();
                workingContext = selectorResult.context;
            }

            if (name === 'responses' && storage === 'memory') {
                if (!accessor) {
                    return { value: context.commandResponses.length > 0 ? 'true' : 'false', context };
                }

                switch (accessor.type) {
                    case 'index': {
                        const indexResult = await evaluate(accessor.index, context);
                        const index = parseInt(String(indexResult.value), 10);
                        const exists = !isNaN(index) && index >= 0 && index < context.commandResponses.length;
                        return { value: exists ? 'true' : 'false', context: indexResult.context };
                    }

                    case 'random': {
                        return { value: context.commandResponses.length > 0 ? 'true' : 'false', context };
                    }

                    case 'length': {
                        return { value: 'true', context };
                    }
                }
                return { value: 'false', context };
            }

            if (!accessor) {
                const exists = await checkKeyExists(name, storage, workingContext, targetUserLogin);
                return { value: exists ? 'true' : 'false', context: workingContext };
            }

            const arrayExists = await checkArrayKeyExists(name, storage, workingContext, targetUserLogin);

            switch (accessor.type) {
                case 'index': {
                    if (!arrayExists) {
                        return { value: 'false', context: workingContext };
                    }
                    const arrayData = await getArrayFromStorage(name, storage, workingContext, targetUserLogin);
                    const indexResult = await evaluate(accessor.index, workingContext);
                    const index = parseInt(String(indexResult.value), 10);
                    const exists = !isNaN(index) && index >= 0 && index < arrayData.length;
                    return { value: exists ? 'true' : 'false', context: indexResult.context };
                }

                case 'random': {
                    if (!arrayExists) {
                        return { value: 'false', context: workingContext };
                    }
                    const arrayData = await getArrayFromStorage(name, storage, workingContext, targetUserLogin);
                    return { value: arrayData.length > 0 ? 'true' : 'false', context: workingContext };
                }

                case 'length': {
                    return { value: arrayExists ? 'true' : 'false', context: workingContext };
                }
            }
            return { value: 'false', context: workingContext };
        }

        case 'binary': {
            const binaryNode = node as BinaryExpressionNode;
            const { operator, left, right } = binaryNode;

            const leftResult = await evaluate(left, context);
            const rightResult = await evaluate(right, leftResult.context);
            const evalContext = rightResult.context;

            const arithmeticOps = ['+', '-', '*', '/', '%'];
            const comparisonOps = ['==', '!=', '>=', '<=', '>', '<', '=', '~=', '<>'];

            if (arithmeticOps.includes(operator)) {
                const leftNum = toNumberSafe(leftResult.value);
                const rightNum = toNumberSafe(rightResult.value);

                let result: number;
                switch (operator) {
                    case '+': result = leftNum + rightNum; break;
                    case '-': result = leftNum - rightNum; break;
                    case '*': result = leftNum * rightNum; break;
                    case '/':
                        result = rightNum === 0 ? 0 : leftNum / rightNum;
                        break;
                    case '%':
                        result = rightNum === 0 ? 0 : leftNum % rightNum;
                        break;
                    default: result = 0;
                }

                const intResult = Number.isInteger(result) ? result : Math.round(result * 1000000) / 1000000;
                return { value: String(intResult), context: evalContext };
            }

            if (comparisonOps.includes(operator)) {
                const leftValue = String(leftResult.value);
                const rightValue = String(rightResult.value);
                const result = safeCompare(leftValue, operator as InternalComparisonOperator, rightValue);
                return { value: result ? 'true' : 'false', context: evalContext };
            }

            return { value: '', context: evalContext };
        }

        case 'unary': {
            const unaryNode = node as UnaryExpressionNode;
            const { operator, argument } = unaryNode;

            const argResult = await evaluate(argument, context);
            const numValue = toNumberSafe(argResult.value);

            let result: number;
            switch (operator) {
                case '+': result = numValue; break;
                case '-': result = -numValue; break;
                default: result = numValue;
            }

            return { value: String(result), context: argResult.context };
        }

        case 'ternary': {
            const ternaryNode = node as TernaryExpressionNode;
            const { test, consequent, alternate } = ternaryNode;

            const testResult = await evaluate(test, context);
            const isTrue = isTruthy(testResult.value);

            const branchResult = await evaluate(
                isTrue ? consequent : alternate,
                testResult.context
            );

            return { value: branchResult.value, context: branchResult.context };
        }

        case 'template': {
            const templateNode = node as TemplateNode;
            const { segments } = templateNode;

            const parts: string[] = [];
            let currentContext = context;

            for (const segment of segments) {
                if (segment.type === 'text') {
                    parts.push(segment.value);
                } else {
                    const segmentResult = await evaluate(segment.node, currentContext);
                    currentContext = segmentResult.context;
                    parts.push(String(segmentResult.value ?? ''));
                }
            }

            return { value: parts.join(''), context: currentContext };
        }

        case 'arrayLiteral': {
            const arrayNode = node as ArrayLiteralNode;
            const values: string[] = [];
            let currentContext = context;

            for (const item of arrayNode.items) {
                const result = await evaluate(item, currentContext);
                currentContext = result.context;
                values.push(String(result.value ?? ''));
            }

            return { value: values, context: currentContext };
        }

        case 'custom': {
            const customNode = node as CustomNode;
            return { value: `[Custom node not implemented: ${customNode.customType}]`, context };
        }

        case 'commandRef': {
            const cmdRefNode = node as CommandRefNode;
            const { commandName, args } = cmdRefNode;

            const MAX_COMMAND_REF_DEPTH = 5;
            const currentDepth = context.commandRefDepth ?? 0;
            if (currentDepth >= MAX_COMMAND_REF_DEPTH) {
                return { value: '', context };
            }

            const visitedCommands = context.visitedCommands ?? new Set<string>();
            const commandKey = `${context.broadcasterId}:${commandName.toLowerCase()}`;
            if (visitedCommands.has(commandKey)) {
                return { value: '', context };
            }

            const newVisitedCommands = new Set(visitedCommands);
            newVisitedCommands.add(commandKey);

            let argsString = '';
            if (args.length > 0) {
                const argsResults: string[] = [];
                let argsContext = context;
                for (const arg of args) {
                    const argResult = await evaluate(arg, argsContext);
                    argsContext = argResult.context;
                    argsResults.push(String(argResult.value ?? ''));
                }
                argsString = argsResults.join(' ');
            }

            try {
                const fakeEventData = {
                    chatter_user_id: context.broadcasterId,
                    chatter_user_login: context.userLogin || context.broadcasterId,
                    chatter_user_name: context.userDisplayName || context.broadcasterId,
                    badges: []
                };

                const result = await commandHandler(
                    context.broadcasterId,
                    fakeEventData,
                    commandName.toLowerCase(),
                    argsString || undefined
                );

                if (result.error || !result.message) {
                    return { value: '', context };
                }

                const nestedContext: ExecutionContext = {
                    ...context,
                    visitedCommands: newVisitedCommands,
                    commandRefDepth: currentDepth + 1,
                    argument: argsString || context.argument,
                    commandName: commandName.toLowerCase()
                };

                const { ast, error } = parse(result.message);
                if (error) {
                    return { value: result.message, context: nestedContext };
                }

                const nestedResult = await evaluate(ast, nestedContext);
                return { value: nestedResult.value, context: nestedResult.context };
            } catch (error) {
                console.error('Error in commandRef evaluation:', {
                    commandName,
                    args: argsString,
                    broadcasterId: context.broadcasterId,
                    error: error instanceof Error ? error.message : String(error)
                });
                return { value: '', context };
            }
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
        arrays: new Map<string, string[]>(),
        broadcasterId: '',
        userId: '',
        userLogin: '',
        userDisplayName: '',
        userPlan: 'free',
        userLevel: 1,
        count: 0,
        streamer: null,
        platform: 'twitch',
        scopeType: 'command',
        scopeName: '',
        scopeAliases: [],
        commandName: '',
        commandId: '',
        commandResponses: [],
        commandVariables: new Map<string, string>(),
        userCommandVariables: new Map<string, string>(),
        saveResponses: async () => {},
        saveChannelVariable: async () => {},
        loadChannelVariable: async () => '',
        saveUserVariable: async () => {},
        loadUserVariable: async () => '',
        ...overrides
    };
}
