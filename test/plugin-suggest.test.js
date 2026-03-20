const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {
  passesLargeReadFilters,
  buildLargeReadSuggestion,
  formatSuggestionLogLine,
  renderSuggestionLogLine,
  emitLargeReadSuggestion,
  SUGGESTION_CONTRACT_VERSION,
} = require('../openclaw/suggest');

test('passesLargeReadFilters rejects below threshold', () => {
  const r = passesLargeReadFilters('/tmp/x', 1024, { maxFileBytes: 2048 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.skipReason, 'below-size-threshold');
});

test('passesLargeReadFilters respects extension allowlist', () => {
  const r = passesLargeReadFilters('/tmp/a.log', 9_000_000, {
    maxFileBytes: 1024,
    extensions: ['json'],
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.skipReason, 'extension-filter');
});

test('buildLargeReadSuggestion returns structured fields', () => {
  const suggestion = buildLargeReadSuggestion(path.join(__dirname, '..', 'package.json'), 9_000_000, {
    maxFileBytes: 1024,
  });
  assert.ok(suggestion);
  assert.strictEqual(suggestion.schemaVersion, SUGGESTION_CONTRACT_VERSION);
  assert.strictEqual(suggestion.trigger, 'large-read');
  assert.ok(suggestion.confidenceScore != null && Number.isFinite(suggestion.confidenceScore));
  assert.ok(['reduce', 'raw-read', 'rtk-shell'].includes(suggestion.action));
  assert.ok(Array.isArray(suggestion.why));
  assert.ok(suggestion.logLine.includes('openclaw-context-optimizer'));
  assert.ok(formatSuggestionLogLine(suggestion).includes('→'));
  assert.strictEqual(renderSuggestionLogLine(suggestion), suggestion.logLine);
});

test('emitLargeReadSuggestion invokes onSuggestion and can silence logs', () => {
  const suggestion = buildLargeReadSuggestion(path.join(__dirname, '..', 'package.json'), 9_000_000, {
    maxFileBytes: 1024,
  });
  assert.ok(suggestion);
  const seen = [];
  emitLargeReadSuggestion(
    {
      onSuggestion: (s, meta) => {
        seen.push({ s, meta });
      },
      logSuggestions: false,
    },
    suggestion,
    { toolName: 'read', params: { path: '/x' } },
  );
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].meta.toolName, 'read');
});
