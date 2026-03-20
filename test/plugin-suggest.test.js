const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {
  passesLargeReadFilters,
  buildLargeReadSuggestion,
  formatSuggestionForAgent,
  formatSuggestionLogLine,
  renderSuggestionLogLine,
  emitLargeReadSuggestion,
  traceLargeReadSuggestion,
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

test('passesLargeReadFilters glob matchers **/*.log', () => {
  const ok = passesLargeReadFilters('/var/log/nested/app.log', 9_000_000, {
    maxFileBytes: 1024,
    matchers: ['**/*.log'],
  });
  assert.strictEqual(ok.ok, true);
  const miss = passesLargeReadFilters('/var/log/nested/app.txt', 9_000_000, {
    maxFileBytes: 1024,
    matchers: ['**/*.log'],
  });
  assert.strictEqual(miss.ok, false);
  assert.strictEqual(miss.skipReason, 'matcher-miss');
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
  assert.ok(Array.isArray(suggestion.worthReadingExactlyReasons));
  assert.ok(formatSuggestionForAgent(suggestion).includes(suggestion.action));
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

test('traceLargeReadSuggestion reports skipReason when below threshold', () => {
  const tr = traceLargeReadSuggestion('/tmp/x', 500, { maxFileBytes: 9_000_000 });
  assert.strictEqual(tr.gateOk, false);
  assert.strictEqual(tr.skipReason, 'below-size-threshold');
});

test('traceLargeReadSuggestion includes advise when gate passes', () => {
  const tr = traceLargeReadSuggestion(path.join(__dirname, '..', 'package.json'), 9_000_000, {
    maxFileBytes: 1024,
  });
  assert.strictEqual(tr.gateOk, true);
  assert.ok(tr.advise && tr.advise.action);
});
