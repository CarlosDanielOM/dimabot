import test from 'node:test';
import assert from 'node:assert/strict';

import { parse } from './parser.js';
import { createExecutionContext, evaluate } from './evaluator.js';
import { registerDelayFunctions } from './functions/delay.functions.js';

registerDelayFunctions();

async function evaluateInput(input: string, setup?: (context: ReturnType<typeof createExecutionContext>) => void) {
    const context = createExecutionContext();
    setup?.(context);

    const { ast, error } = parse(input);
    assert.equal(error, undefined);

    return evaluate(ast, context);
}

test('foreach loop iterates over stored array values', async () => {
    const result = await evaluateInput(
        '*(for #item in %(items[]) { %(out[] #item) }) %(out[])',
        (context) => {
            context.variables.set('items', JSON.stringify(['a', 'b', 'c']));
        }
    );

    assert.equal(result.value, '["a","b","c"]');
});

test('range loop appends incremented values', async () => {
    const result = await evaluateInput('*(for #i = 0; #i < 3; #i++ { %(out[] #i) }) %(out[])');

    assert.equal(result.value, '["0","1","2"]');
});

test('continue skips the current iteration body', async () => {
    const result = await evaluateInput(
        '*(for #i = 0; #i < 5; #i++ { *(#i == 2 ? $(continue) : "") %(out[] #i) }) %(out[])'
    );

    assert.equal(result.value, '["0","1","3","4"]');
});

test('break exits the innermost loop', async () => {
    const result = await evaluateInput(
        '*(for #i = 0; #i < 6; #i++ { *(#i == 3 ? $(break) : "") %(out[] #i) }) %(out[])'
    );

    assert.equal(result.value, '["0","1","2"]');
});

test('free plan truncates loops at 25 iterations', async () => {
    const result = await evaluateInput(
        '*(for #i = 0; #i < 40; #i++ { %(out[] #i) }) %(out[].length)',
        (context) => {
            context.userPlan = 'free';
        }
    );

    assert.equal(result.value, '25');
});

test('bare loop variable outside a loop remains literal text', async () => {
    const result = await evaluateInput('#count');

    assert.equal(result.value, '#count');
});

test('array length accessor works with explicit array syntax', async () => {
    const result = await evaluateInput('%(items[].length)', (context) => {
        context.variables.set('items', JSON.stringify(['x', 'y', 'z', 'w']));
    });

    assert.equal(result.value, '4');
});
