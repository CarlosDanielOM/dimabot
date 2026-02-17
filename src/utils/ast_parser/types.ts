export type NodeType = 'root' | 'setVar' | 'getVar' | 'function' | 'conditional' | 'literal' | 'custom';

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
    value: AstNode;
}

export interface GetVarNode extends BaseNode {
    type: 'getVar';
    name: string;
}

export interface FunctionNode extends BaseNode {
    type: 'function';
    name: string;
    args: AstNode[];
}

export interface ConditionalNode extends BaseNode {
    type: 'conditional';
    left: AstNode;
    operator: string;
    right: AstNode;
    trueBranch: AstNode;
    falseBranch: AstNode;
}

export interface LiteralNode extends BaseNode {
    type: 'literal';
    value: string;
}

export interface CustomNode<T = unknown> extends BaseNode {
    type: 'custom';
    customType: string;
    data: T;
}

export type AstNode = RootNode | SetVarNode | GetVarNode | FunctionNode | ConditionalNode | LiteralNode | CustomNode;

export interface IStreamerData {
    id?: string;
    name?: string;
    [key: string]: unknown;
}

export interface ExecutionContext {
    variables: Map<string, unknown>;
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
