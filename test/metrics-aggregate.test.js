const { test } = require('node:test');
const assert = require('node:assert');
const { aggregateMetrics } = require('../src/metrics');

test('aggregateMetrics groups by command and preset', () => {
  const agg = aggregateMetrics([
    { command: 'smart-read', preset: 'agent', inputTokensEst: 100, outputTokensEst: 20, target: 'a', ratio: 0.2 },
    { command: 'smart-read', preset: 'agent', inputTokensEst: 200, outputTokensEst: 40, target: 'b', ratio: 0.2 },
    { command: 'smart-log', preset: 'aggressive', inputTokensEst: 500, outputTokensEst: 50, target: 'c', ratio: 0.1 },
  ]);
  assert.strictEqual(agg.windowRuns, 3);
  assert.strictEqual(agg.byCommand['smart-read'], 2);
  assert.strictEqual(agg.byPreset.agent, 2);
  assert.ok(agg.topInputsApprox[0].inputTokensEst >= 500);
  assert.ok(agg.avgRatioByCommand['smart-read'] != null);
  assert.ok(agg.workflowTagGroups && typeof agg.workflowTagGroups['(no tag)'] === 'object');
  assert.ok(agg.tuningHints && Array.isArray(agg.tuningHints.hints));
  assert.ok(Array.isArray(agg.qualityHints));
});
