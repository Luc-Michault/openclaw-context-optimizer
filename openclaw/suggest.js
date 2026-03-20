/**
 * Large-read suggestion API for OpenClaw (v0.8).
 * Stable contract for runtime / wrappers; logging is a separate render step.
 */

const path = require('path');

/** Bump when adding/removing top-level suggestion fields (semver of the object, not the package). */
const SUGGESTION_CONTRACT_VERSION = '0.8.0';

/** Documented stable keys (for consumers); order not guaranteed on object iteration. */
const LARGE_READ_SUGGESTION_KEYS = [
  'schemaVersion',
  'trigger',
  'path',
  'sizeBytes',
  'action',
  'confidence',
  'confidenceScore',
  'why',
  'recommendedCli',
  'recommendedCommand',
  'nextStepIfInsufficient',
  'preset',
  'kind',
  'reducerCommand',
  'shouldReduce',
  'alternatives',
  'worthReadingExactly',
  'repoContext',
  'pathRoles',
  'isDirectory',
  'extension',
  'basename',
  'projectNote',
  'repoRoot',
  'logLine',
];

/**
 * @param {string} resolvedPath absolute file path
 * @param {number} sizeBytes file size
 * @param {object} cfg plugin config (maxFileBytes, matchers?, extensions?)
 * @returns {{ ok: false, skipReason: string } | { ok: true }}
 */
function passesLargeReadFilters(resolvedPath, sizeBytes, cfg) {
  const maxFileBytes =
    cfg.maxFileBytes != null && Number(cfg.maxFileBytes) > 0
      ? Number(cfg.maxFileBytes)
      : 2 * 1024 * 1024;

  if (!resolvedPath || typeof resolvedPath !== 'string') {
    return { ok: false, skipReason: 'no-path' };
  }
  if (sizeBytes < maxFileBytes) {
    return { ok: false, skipReason: 'below-size-threshold' };
  }

  const normalizedPath = resolvedPath.replace(/\\/g, '/');
  if (Array.isArray(cfg.matchers) && cfg.matchers.length) {
    const hit = cfg.matchers.some((m) => normalizedPath.includes(String(m)));
    if (!hit) return { ok: false, skipReason: 'matcher-miss' };
  }

  const ext = path.extname(resolvedPath).replace(/^\./, '').toLowerCase();
  if (Array.isArray(cfg.extensions) && cfg.extensions.length) {
    const allow = new Set(cfg.extensions.map((x) => String(x).replace(/^\./, '').toLowerCase()));
    if (!allow.has(ext)) return { ok: false, skipReason: 'extension-filter' };
  }

  return { ok: true };
}

/**
 * Render the default one-line log form (generation ≠ rendering).
 * @param {object} s suggestion object (must include path, sizeBytes, action, preset, recommendedCli/Command)
 */
function renderSuggestionLogLine(s) {
  if (!s || !s.path) return '';
  const hint = s.recommendedCli || s.recommendedCommand || `${s.action}`;
  return `[openclaw-context-optimizer] Large read ~${s.sizeBytes} B: ${s.path} → ${s.action} — ${hint} (preset=${s.preset || '—'})`;
}

/** @deprecated use renderSuggestionLogLine */
function formatSuggestionLogLine(s) {
  return s && s.logLine ? s.logLine : renderSuggestionLogLine(s);
}

/**
 * Build a versioned, stable-shaped suggestion from policy.advise (null if filters fail).
 */
function buildLargeReadSuggestion(resolvedPath, sizeBytes, cfg = {}) {
  const gate = passesLargeReadFilters(resolvedPath, sizeBytes, cfg);
  if (!gate.ok) return null;

  const policyPath = path.join(__dirname, '..', 'src', 'policy.js');
  const { advise } = require(policyPath);
  const maxFB =
    cfg.maxFileBytes != null && Number(cfg.maxFileBytes) > 0
      ? Number(cfg.maxFileBytes)
      : 2 * 1024 * 1024;

  const d = advise({ path: resolvedPath, sizeBytes, maxFileBytes: maxFB });

  const suggestion = {
    schemaVersion: SUGGESTION_CONTRACT_VERSION,
    trigger: 'large-read',
    path: resolvedPath,
    sizeBytes,
    action: d.action,
    confidence: d.confidence,
    confidenceScore: d.confidenceScore != null ? d.confidenceScore : null,
    why: d.why,
    recommendedCli: d.recommendedCli,
    recommendedCommand: d.recommendedCommand,
    nextStepIfInsufficient: d.nextStepIfInsufficient,
    preset: d.preset,
    kind: d.kind,
    reducerCommand: d.reducerCommand,
    shouldReduce: d.shouldReduce,
    alternatives: d.alternatives,
    worthReadingExactly: d.worthReadingExactly,
    repoContext: d.repoContext,
    pathRoles: d.pathRoles,
    isDirectory: d.isDirectory,
    extension: d.extension,
    basename: d.basename,
    projectNote: d.projectNote,
    repoRoot: d.repoRoot,
    logLine: '',
  };
  suggestion.logLine = renderSuggestionLogLine(suggestion);
  return suggestion;
}

/**
 * Optional callback + optional console line — keeps generation separate from delivery.
 * @param {object} cfg plugin config (onSuggestion?, logSuggestions?)
 * @param {object|null} suggestion from buildLargeReadSuggestion
 * @param {{ toolName?: string, params?: object }} eventMeta
 */
function emitLargeReadSuggestion(cfg, suggestion, eventMeta = {}) {
  if (!suggestion) return;
  if (typeof cfg.onSuggestion === 'function') {
    try {
      cfg.onSuggestion(suggestion, eventMeta);
    } catch (e) {
      if (typeof console.error === 'function') {
        console.error('[openclaw-context-optimizer] onSuggestion error:', e && e.message ? e.message : e);
      }
    }
  }
  if (cfg.logSuggestions !== false && typeof console.warn === 'function') {
    console.warn(suggestion.logLine || renderSuggestionLogLine(suggestion));
  }
}

module.exports = {
  SUGGESTION_CONTRACT_VERSION,
  LARGE_READ_SUGGESTION_KEYS,
  passesLargeReadFilters,
  buildLargeReadSuggestion,
  renderSuggestionLogLine,
  formatSuggestionLogLine,
  emitLargeReadSuggestion,
};
