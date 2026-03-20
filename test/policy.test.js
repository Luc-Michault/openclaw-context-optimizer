const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {
  shouldReduce,
  recommendedReducer,
  recommendedPreset,
  explainPolicyDecision,
  advise,
} = require('../src/policy');

test('large log recommends reduce', () => {
  const r = shouldReduce({ path: 'app.log', sizeBytes: 500_000, extension: 'log' });
  assert.strictEqual(r.reduce, true);
});

test('small json may skip reduce', () => {
  const r = shouldReduce({ path: 'x.json', sizeBytes: 1024, extension: 'json' });
  assert.strictEqual(r.reduce, false);
});

test('commandHint exec leans away from file reducers', () => {
  const r = shouldReduce({ path: 'x.txt', sizeBytes: 10_000_000, extension: 'txt', commandHint: 'exec' });
  assert.strictEqual(r.reduce, false);
});

test('recommendedReducer picks smart-json for .json files', () => {
  const r = recommendedReducer({ path: '/tmp/a.json', extension: 'json' });
  assert.strictEqual(r.command, 'smart-json');
});

test('recommendedReducer picks smart-tree for directories', () => {
  const r = recommendedReducer({ path: __dirname, extension: '' });
  assert.strictEqual(r.command, 'smart-tree');
});

test('recommendedPreset triage for tree kind', () => {
  assert.strictEqual(recommendedPreset({ kind: 'tree', sizeBytes: 0 }), 'triage');
});

test('explainPolicyDecision is non-empty string', () => {
  const s = explainPolicyDecision({
    path: path.join(__dirname, '..', 'package.json'),
    sizeBytes: 400,
    extension: 'json',
  });
  assert.ok(s.includes('action:') && s.includes('next:'));
});

test('advise directory recommends smart-tree', () => {
  const a = advise({ path: __dirname, sizeBytes: 0 });
  assert.strictEqual(a.isDirectory, true);
  assert.strictEqual(a.action, 'reduce');
  assert.strictEqual(a.reducerCommand, 'smart-tree');
  assert.ok(a.recommendedCli && a.recommendedCli.includes('smart-tree'));
});

test('advise exec hint is rtk-shell', () => {
  const a = advise({ path: '/tmp/x.log', sizeBytes: 9_000_000, commandHint: 'exec' });
  assert.strictEqual(a.action, 'rtk-shell');
  assert.strictEqual(a.shouldReduce, false);
});
