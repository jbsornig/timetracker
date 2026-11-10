const test = require('node:test');
const assert = require('node:assert');
const { normalizeBoxCount, BoxCountError } = require('./box-count');

test('blank values mean not recorded', () => {
  assert.strictEqual(normalizeBoxCount(undefined), null);
  assert.strictEqual(normalizeBoxCount(null), null);
  assert.strictEqual(normalizeBoxCount(''), null);
  assert.strictEqual(normalizeBoxCount('  '), null);
});

test('whole numbers are kept, including zero and numeric strings', () => {
  assert.strictEqual(normalizeBoxCount(0), 0);
  assert.strictEqual(normalizeBoxCount('6'), 6);
  assert.strictEqual(normalizeBoxCount(12), 12);
});

test('negative, fractional and non-numeric values are rejected', () => {
  for (const bad of [-1, 1.5, 'abc', '2 boxes']) {
    assert.throws(() => normalizeBoxCount(bad), BoxCountError);
  }
});
