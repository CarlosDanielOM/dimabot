Technical Spec: AST Command Parser for Native Twitch Webhooks

Role: Senior Node.js/TypeScript Engineer.
Context: We are migrating a legacy command system to a robust, extensible AST (Abstract Syntax Tree) parser. The bot uses Twitch Native Webhooks (EventSub).

1. The Problem

The current parsing logic is brittle, hardcoded, and parses right-to-left.

Fails: %(target $(user)) $(ban %(target)) — target is undefined when ban executes.

Rigidity: Adding a new syntax type (e.g., ^() for permissions) currently requires rewriting the core parser loop.

Goal: Implement a Two-Phase Architecture (Parse -> Evaluate) that is Configuration-Driven. The parser should not know strictly about $ or % but should look up behaviors in a registry to allow easy future extensions.

2. Syntax Grammar

The parser must support the following core types but remain open for extension.

2.1 Variables %(...)

Get: %(variableName) → Returns value from context.

Set: %(variableName value) → Sets value in context.

2.2 Functions $(...)

Call: $(functionName arg1 arg2 ...)

Async: Functions are asynchronous.

2.3 Conditionals *(...)

Format: *(left op right ? trueBranch : falseBranch)

2.4 Literals & Strings

Unquoted: Basic alphanumeric values.

Quoted: Double-quoted strings ("Hello World") preserving whitespace.

2.5 Extensibility (Crucial)

The system must allow registering new prefixes (e.g., ^()) without modifying the parse() function's core loop.

3. Architecture

3.1 Configuration Registry

The parser behavior should be driven by a configuration map, not hardcoded if/else statements.

// Pass registry to handler so it can recursively parse nested expressions
type ParserHandler = (
  tokens: string[], 
  currentIndex: number, 
  registry: Map<string, SyntaxDefinition>
) => { node: AstNode, newIndex: number };

interface SyntaxDefinition {
  startToken: string; // e.g., "$(", "%(", "^("
  endToken: string;   // e.g., ")"
  handler: ParserHandler;
}

// The Registry is a Map for O(1) lookups
// Key: startToken (e.g., "$(") -> Value: SyntaxDefinition
const SyntaxRegistry = new Map<string, SyntaxDefinition>();

// Register default handlers
SyntaxRegistry.set("$(", { startToken: "$(", endToken: ")", handler: parseFunction });
SyntaxRegistry.set("%(", { startToken: "%(", endToken: ")", handler: parseVariable });
SyntaxRegistry.set("*(", { startToken: "*(", endToken: ")", handler: parseConditional });
// Future extension example:
// SyntaxRegistry.set("^(", { startToken: "^(", endToken: ")", handler: parsePermission });


3.2 Tokenizer (Phase 1)

Splits raw string into tokens.

Input: %(target "hello world")

Output: ['%(', 'target', '"hello world"', ')']

Constraint: The Tokenizer must dynamically split based on the keys present in the Registry Map.

Implementation Strategy: Extract all startToken keys from the registry to build a dynamic Regular Expression.

// Example: Dynamically build regex from registry keys
const keys = Array.from(registry.keys()).map(k => escapeRegExp(k)).join("|");
// Matches startTokens (from registry), quotes, or whitespace
const tokenRegex = new RegExp(`(${keys}|"|\\s+)`); 


3.3 AST Builder (Phase 2)

Recursive descent parser.

Logic: When iterating tokens, check if the current token exists as a key in the Registry. If it does, delegate to that definition's handler.

Node Interfaces:

type NodeType = 'root' | 'setVar' | 'getVar' | 'function' | 'conditional' | 'literal' | 'custom';

interface BaseNode {
  type: NodeType;
}
// ... (Previous specific interfaces remain the same)

// Generic Interface for future extensions
interface CustomNode<T = any> extends BaseNode {
  type: 'custom';
  customType: string; // e.g. "permissionCheck"
  data: T;
}

// Example usage:
// type PermissionNode = CustomNode<{ permission: string; fallback?: string }>;


3.4 Evaluator (Phase 3)

Async visitor.

Context:

interface ExecutionContext {
  variables: Map<string, any>;
  broadcasterId: string;
  userId: string;
  userDisplayName: string;
  apiClient: any;
}



4. Implementation Requirements

4.1 Extensibility Pattern

Registry Pattern: Do not write if (token === '$(') inside the main loop.

Dynamic Lookup: Use SyntaxRegistry.get(token) for O(1) access instead of iterating through an array.

Benefit: If we want to add ^() next month, we only define a new SyntaxDefinition and ParserHandler without touching tokenize or parse.

4.2 Execution Logic

Promise.all: Function arguments must resolve in parallel.

Scoping: Variable scope is ephemeral (per command execution).

4.3 Error Handling

Graceful Failure: If a specific syntax handler fails, it should bubble up a readable error with the position.

5. Task

Please implement the following in TypeScript:

Define the Registry: Create the SyntaxRegistry as a Map with default implementations for $, %, and *.

Dynamic Tokenizer: Implement tokenize(input) that dynamically builds its regex from the Registry's keys.

Registry-Driven Parser: Implement parse(tokens) that delegates to the Registry handlers using map.get().

Evaluator: Implement evaluate() to execute the resulting AST.

Test Case:
Input: %(target $(touser)) $(ban %(target))
Validate that the logic works via the registry lookups.
