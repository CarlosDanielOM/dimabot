# AST Parser Guide for Command System

## The Problem

**Current:** You parse and execute in one pass (right-to-left)

```
%(target $(user)) $(ban %(target) 3)
```

Right-to-left → fails because `%(target)` needs `$(user)` but hasn't been parsed yet.

---

## The Solution: Two-Phase Parser

### Phase 1: Tokenize → Parse → AST (Structure only, no execution)
### Phase 2: Walk AST → Evaluate (Execute in correct order)

---

## Visual Example

**Input:**
```
%(target $(user)) $(ban %(target) 3)
```

### Step 1: Tokenize
```
['%(', 'target', '$(', 'user', ')', ')', '$(', 'ban', '%(', 'target', ')', '3', ')']
```

### Step 2: Build AST (Tree Structure)

```
ROOT
├─ SetVar
│  ├─ name: "target"
│  └─ value:
│     └─ Function
│        ├─ name: "user"
│        └─ args: []
└─ Function
   ├─ name: "ban"
   └─ args:
      ├─ GetVar
      │  └─ name: "target"
      └─ Literal
         └─ value: "3"
```

### Step 3: Evaluate AST (Depth-first, left-to-right)

**First node (SetVar):**
1. Evaluate `value` subtree → call `user()` → returns "dom"
2. Set variable `target` = "dom"

**Second node (Function):**
1. Get `args[0]` → GetVar("target") → returns "dom"
2. Get `args[1]` → Literal("3") → returns "3"
3. Call `ban("dom", "3")` → executes

---

## TypeScript Interface

```typescript
// AST Node Types
type AstNode =
  | SetVarNode
  | GetVarNode
  | FunctionNode
  | ConditionalNode
  | LiteralNode;

// Variable: %(name value)
interface SetVarNode {
  type: 'setVar';
  name: string;
  value: AstNode;  // Can be nested!
}

// Variable reference: %(name)
interface GetVarNode {
  type: 'getVar';
  name: string;
}

// Function call: $(function arg1 arg2)
interface FunctionNode {
  type: 'function';
  name: string;      // e.g., "ban", "user", "twitch.subs"
  args: AstNode[];   // Nested nodes
}

// Conditional: *(val1 op val2 ? true : false)
interface ConditionalNode {
  type: 'conditional';
  left: AstNode;
  operator: string;
  right: AstNode;
  trueBranch: AstNode;
  falseBranch: AstNode;
}

// Plain text/number
interface LiteralNode {
  type: 'literal';
  value: string | number;
}
```

---

## Parser Implementation (High-Level)

```typescript
function parse(input: string): AstNode[] {
  const tokens = tokenize(input);  // Split into ['%(', 'target', ...]
  const nodes: AstNode[] = [];

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];

    if (token === '%(') {
      // Parse variable set: %(name value)
      i++;
      const name = tokens[i++];

      // value could be nested, so we parse recursively
      const value = parseExpression(tokens, i);
      i = value.newIndex;

      nodes.push({
        type: 'setVar',
        name,
        value: value.node
      });

      i++;  // Skip ')'
    } else if (token === '$(') {
      // Parse function: $(name args...)
      i++;
      const name = tokens[i++];

      const args: AstNode[] = [];
      while (tokens[i] !== ')') {
        const arg = parseExpression(tokens, i);
        args.push(arg.node);
        i = arg.newIndex;
      }

      nodes.push({
        type: 'function',
        name,
        args
      });

      i++;  // Skip ')'
    }
    // ... handle *(), literal, etc.
  }

  return nodes;
}

// Recursive helper for nested expressions
function parseExpression(tokens: string[], i: number): { node: AstNode, newIndex: number } {
  const token = tokens[i];

  if (token === '$(') {
    // Parse nested function
    return parseFunction(tokens, i);
  } else if (token === '%(') {
    // Check if this is setVar or getVar by looking ahead
    const nextToken = tokens[i + 2];  // Skip %(name)
    if (nextToken === ')') {
      // This is getVar: %(name)
      return parseGetVar(tokens, i);
    } else {
      // This is setVar: %(name value)
      return parseSetVar(tokens, i);
    }
  } else {
    // This is a literal
    return { node: { type: 'literal', value: token }, newIndex: i + 1 };
  }
}
```

---

## Evaluator (The Easy Part)

```typescript
interface Context {
  variables: Map<string, any>;
  user: string;    // Who triggered the command
  channel: string; // Current channel
  // ... other context
}

async function evaluate(node: AstNode, context: Context): Promise<any> {
  switch (node.type) {
    case 'literal':
      return node.value;

    case 'getVar':
      return context.variables.get(node.name);

    case 'setVar':
      const value = await evaluate(node.value, context);
      context.variables.set(node.name, value);
      return value;

    case 'function':
      // Evaluate all args first (depth-first)
      const evaluatedArgs = await Promise.all(
        node.args.map(arg => evaluate(arg, context))
      );
      return await executeFunction(node.name, evaluatedArgs, context);

    case 'conditional':
      const left = await evaluate(node.left, context);
      const right = await evaluate(node.right, context);
      const result = compare(left, node.operator, right);
      return await evaluate(result ? node.trueBranch : node.falseBranch, context);
  }
}
```

---

## Key Insight

**Parser phase (build AST):**
- Reads the structure
- Doesn't execute anything
- Stores the "shape" of what to do

**Evaluator phase (walk AST):**
- Executes in the correct order
- Can handle any nesting depth
- Variables work anywhere because structure is known

---

## Example Walkthrough

**Input:** `%(target $(user)) $(ban %(target) 3)`

**After Parse (AST built):**
```json
[
  { "type": "setVar", "name": "target", "value": { "type": "function", "name": "user" } },
  { "type": "function", "name": "ban", "args": [
    { "type": "getVar", "name": "target" },
    { "type": "literal", "value": "3" }
  ]}
]
```

**After Evaluate (step by step):**
1. SetVar.target → calls `user()` → returns "dom" → stores `target = "dom"`
2. Function.ban → gets `target` → "dom" → calls `ban("dom", "3")`

Works perfectly. No right-to-left weirdness.

---

## Migration Path

**Don't rewrite everything at once.**

1. Build the new parser alongside the old one
2. Add a flag: `command.useAstParser = true`
3. Test with a few streamers, compare results
4. When confident, flip the switch

The old parser is still useful for simple commands. The new one handles the complex stuff.

---

## When You're Ready

Hit me up with:
1. Your current tokenization code (how you split strings into tokens)
2. The function registry (your available functions)

I can help you write the actual parser code in TypeScript.
