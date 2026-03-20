/**
 * OpenClaw plugin for openclaw-context-optimizer.
 * Default: passive registration + optional verbose log.
 * Opt-in: suggestOnLargeRead — structured suggestions (openclaw/suggest.js).
 */

const {
  buildLargeReadSuggestion,
  emitLargeReadSuggestion,
  traceLargeReadSuggestion,
} = require('./suggest');

module.exports = function register(api) {
  const cfg = api?.config || {};
  if (cfg.enabled === false) return;

  const verbose = cfg.verbose === true;
  const defaultPreset = cfg.defaultPreset || 'agent';
  const maxFileBytes =
    cfg.maxFileBytes != null && Number(cfg.maxFileBytes) > 0
      ? Number(cfg.maxFileBytes)
      : 2 * 1024 * 1024;
  const readTools =
    Array.isArray(cfg.readToolNames) && cfg.readToolNames.length
      ? cfg.readToolNames.map((s) => String(s))
      : ['read'];

  if (verbose) {
    console.log(
      '[openclaw-context-optimizer] registered defaultPreset=%s maxFileBytes=%s suggestOnLargeRead=%s onSuggestion=%s silent=%s suggestDryRunVerbose=%s matchers=%s extensions=%s',
      defaultPreset,
      maxFileBytes,
      Boolean(cfg.suggestOnLargeRead),
      typeof cfg.onSuggestion === 'function' ? 'yes' : 'no',
      cfg.silent === true ? 'yes' : 'no',
      cfg.suggestDryRunVerbose === true ? 'yes' : 'no',
      Array.isArray(cfg.matchers) ? cfg.matchers.length : 0,
      Array.isArray(cfg.extensions) ? cfg.extensions.join(',') : '(any)',
    );
  }

  if (!cfg.suggestOnLargeRead || typeof api?.on !== 'function') return;

  const fs = require('fs');
  const path = require('path');

  api.on(
    'before_tool_call',
    (event) => {
      const tool = event && event.toolName;
      if (!tool || !readTools.includes(tool)) return;
      const params = event.params || {};
      const fp =
        params.path || params.file || params.targetPath || params.filePath || params.uri;
      if (typeof fp !== 'string' || !fp.trim()) return;

      let resolved;
      let size = 0;
      try {
        resolved = path.resolve(fp);
        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) size = fs.statSync(resolved).size;
      } catch {
        return;
      }

      if (cfg.suggestDryRunVerbose === true && typeof console.info === 'function') {
        const tr = traceLargeReadSuggestion(resolved, size, cfg);
        console.info('[openclaw-context-optimizer] suggest trace:', JSON.stringify(tr));
      }
      const suggestion = buildLargeReadSuggestion(resolved, size, cfg);
      emitLargeReadSuggestion(cfg, suggestion, { toolName: tool, params });
    },
    { priority: 3 },
  );
};
