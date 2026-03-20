const { test } = require('node:test');
const assert = require('node:assert');
const { smartJsonText } = require('../src/index');

test('very large array of objects finishes within node budget', () => {
  const items = Array.from({ length: 12_000 }, (_, id) => ({ id, v: 1 }));
  const json = JSON.stringify({ items });
  const t0 = Date.now();
  const r = smartJsonText(json, 'big.json', { preset: 'schema' });
  const ms = Date.now() - t0;
  assert.ok(ms < 10_000, `expected fast run, got ${ms}ms`);
  assert.ok(r.stats.structureNodesVisited < 60_000, 'structure walk should stay bounded');
  assert.ok(
    r.operationalHints.some((h) => h.includes('array of objects') && h.includes('unionKeys')),
    'homogeneous array hint without per-element walk',
  );
});
