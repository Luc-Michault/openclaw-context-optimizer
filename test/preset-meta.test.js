const { test } = require('node:test');
const assert = require('node:assert');
const { smartReadText } = require('../src/index');

test('meta.presetCoerced when preset name is unknown', () => {
  const r = smartReadText('hello\n', 'x.txt', { cli: { preset: 'typo-preset' } });
  assert.strictEqual(r.meta.preset, 'balanced');
  assert.strictEqual(r.meta.presetRequested, 'typo-preset');
  assert.strictEqual(r.meta.presetCoerced, true);
});

test('meta.presetCoerced false for known preset', () => {
  const r = smartReadText('hello\n', 'x.txt', { cli: { preset: 'agent' } });
  assert.strictEqual(r.meta.preset, 'agent');
  assert.strictEqual(r.meta.presetRequested, 'agent');
  assert.strictEqual(r.meta.presetCoerced, false);
});
