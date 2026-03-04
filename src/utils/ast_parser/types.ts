export type NodeType = 'root' | 'setVar' | 'getVar' | 'function' | 'conditional' | 'literal' | 'custom' | 'exists' | 'binary' | 'unary' | 'ternary' | 'template' | 'arrayLiteral' | 'commandRef';

export type TemplateSegment = { type: 'text'; value: string } | { type: 'expr'; node: AstNode };

export type ArithmeticOperator = '+' | '-' | '*' | '/' | '%';
export type ComparisonOperator = '==' | '!=' | '>=' | '<=' | '>' | '<' | '=' | '~=' | '<>';
export type UnaryOperator = '+' | '-';
export type BinaryOperator = ArithmeticOperator | ComparisonOperator;

export type VariableStorage = 'memory' | 'cache' | 'cacheUser' | 'db' | 'dbUser';

export interface ParsedVarName {
    name: string;
    storage: VariableStorage;
}

export type ArrayAccessor = 
    | { type: 'index'; index: AstNode }
    | { type: 'random' }
    | { type: 'length' }
    | { type: 'append' }
    | { type: 'setIndex'; index: AstNode };

export interface BaseNode {
    type: NodeType;
}

export interface RootNode extends BaseNode {
    type: 'root';
    children: AstNode[];
}

export interface SetVarNode extends BaseNode {
    type: 'setVar';
    name: string;
    storage: VariableStorage;
    value: AstNode;
    accessor?: ArrayAccessor;
    userSelector?: AstNode;
}

export interface GetVarNode extends BaseNode {
    type: 'getVar';
    name: string;
    storage: VariableStorage;
    accessor?: ArrayAccessor;
    userSelector?: AstNode;
}

export interface ExistsNode extends BaseNode {
    type: 'exists';
    name: string;
    storage: VariableStorage;
    accessor?: ArrayAccessor;
    userSelector?: AstNode;
}

export interface CommandRefNode extends BaseNode {
    type: 'commandRef';
    commandName: string;
    args: AstNode[];
}

export interface FunctionNode extends BaseNode {
    type: 'function';
    name: string;
    args: AstNode[];
}

export interface ConditionalNode extends BaseNode {
    type: 'conditional';
    condition?: AstNode;
    left?: AstNode;
    operator?: string;
    right?: AstNode;
    trueBranch: AstNode;
    falseBranch: AstNode;
}

export interface BinaryExpressionNode extends BaseNode {
    type: 'binary';
    operator: BinaryOperator;
    left: AstNode;
    right: AstNode;
}

export interface UnaryExpressionNode extends BaseNode {
    type: 'unary';
    operator: UnaryOperator;
    argument: AstNode;
}

export interface TernaryExpressionNode extends BaseNode {
    type: 'ternary';
    test: AstNode;
    consequent: AstNode;
    alternate: AstNode;
}

export interface TemplateNode extends BaseNode {
    type: 'template';
    segments: TemplateSegment[];
}

export interface LiteralNode extends BaseNode {
    type: 'literal';
    value: string;
}

export interface ArrayLiteralNode extends BaseNode {
    type: 'arrayLiteral';
    items: AstNode[];
}

export interface CustomNode<T = unknown> extends BaseNode {
    type: 'custom';
    customType: string;
    data: T;
}

export type AstNode = RootNode | SetVarNode | GetVarNode | ExistsNode | FunctionNode | ConditionalNode | BinaryExpressionNode | UnaryExpressionNode | TernaryExpressionNode | TemplateNode | LiteralNode | ArrayLiteralNode | CustomNode | CommandRefNode;

export interface IStreamerData {
    id?: string;
    name?: string;
    [key: string]: unknown;
}

export interface ExecutionContext {
    variables: Map<string, unknown>;
    arrays: Map<string, string[]>;
    broadcasterId: string;
    userId: string;
    userLogin: string;
    userDisplayName: string;
    userPlan: 'free' | 'premium' | 'pro';
    userLevel: number;
    argument?: string;
    count: number;
    eventData?: Record<string, unknown>;
    eventsubData?: Record<string, unknown>;
    extraContext?: Record<string, unknown>;
    streamer?: IStreamerData | null;
    platform: string;
    scopeType: string;
    scopeName: string;
    scopeAliases: string[];
    commandName: string;
    commandId: string;
    visitedCommands?: Set<string>;
    commandRefDepth?: number;
    commandResponses: string[];
    commandVariables: Map<string, string>;
    userCommandVariables: Map<string, string>;
    saveResponses: () => Promise<void>;
    saveChannelVariable: (name: string, value: string) => Promise<void>;
    loadChannelVariable: (name: string) => Promise<string>;
    saveUserVariable: (name: string, value: string) => Promise<void>;
    loadUserVariable: (name: string, targetUserLogin?: string) => Promise<string>;
}

export interface ParseResult {
    node: AstNode;
    newIndex: number;
}

export type ParserHandler = (
    tokens: string[],
    currentIndex: number,
    registry: Map<string, SyntaxDefinition>
) => ParseResult;

export interface SyntaxDefinition {
    startToken: string;
    endToken: string;
    handler: ParserHandler;
}

export interface TokenizeResult {
    tokens: string[];
    error?: string;
}

export interface AstParseResult {
    ast: RootNode;
    error?: string;
}

export interface EvaluateResult {
    value: unknown;
    context: ExecutionContext;
}
