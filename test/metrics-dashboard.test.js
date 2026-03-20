const { test } = require('node:test');
const assert = require('node:assert');
const { formatDashboard } = require('../src/metrics');

test('metrics dashboard renders preset/source/runtime fields', () => {
  const output = formatDashboard([
    {
      ts: '2026-03-20T18:00:00.000Z',
      command: 'smart-read',
      target: 'README.md',
      inputTokensEst: 200,
      outputTokensEst: 50,
      ratio: 0.25,
      sourceType: 'file',
      preset: 'agent',
      durationMs: 9,
      success: true,
      repoKey: 'demo',
    },
  ]);
  assert.match(output, /presets: agent:1/);
  assert.match(output, /sources: file 1  stdin 0/);
  assert.match(output, /avgMs: 9/);
  assert.match(output, /smart-read/);
  assert.match(output, /repos: demo:1/);
  assert.match(output, /avg ratio \/ command:/);
  assert.match(output, /workflowTag:/);
});
