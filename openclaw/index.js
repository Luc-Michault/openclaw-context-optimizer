/**
 * OpenClaw plugin for openclaw-context-optimizer.
 * Default: passive registration + optional verbose log.
 * Opt-in: suggestOnLargeRead logs policy hints before large file read tool calls.
 */

const fs = require('fs');
const path = require('path');
const policyPath = path.join(__dirname, '..', 'src', 'policy.js');

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
      '[openclaw-context-optimizer] registered defaultPreset=%s maxFileBytes=%s suggestOnLargeRead=%s matchers=%s extensions=%s',
      defaultPreset,
      maxFileBytes,
      Boolean(cfg.suggestOnLargeRead),
      Array.isArray(cfg.matchers) ? cfg.matchers.length : 0,
      Array.isArray(cfg.extensions) ? cfg.extensions.join(',') : '(any)',
    );
  }

  if (!cfg.suggestOnLargeRead || typeof api?.on !== 'function') return;

  const { advise } = require(policyPath);
  const logSuggestions = cfg.logSuggestions !== false;

  api.on(
    'before_tool_call',
    (event) => {
      const tool = event && event.toolName;
      if (!tool || !readTools.includes(tool)) return;
      const params = event.params || {};
      const fp =
        params.path || params.file || params.targetPath || params.filePath || params.uri;
      if (typeof fp !== 'string' || !fp.trim()) return;

      const normalizedPath = fp.replace(/\\/g, '/');
      if (Array.isArray(cfg.matchers) && cfg.matchers.length) {
        const ok = cfg.matchers.some((m) => normalizedPath.includes(String(m)));
        if (!ok) return;
      }

      let resolved;
      let size = 0;
      try {
        resolved = path.resolve(fp);
        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) size = fs.statSync(resolved).size;
      } catch {
        return;
      }
      if (size < maxFileBytes) return;

      const ext = path.extname(resolved).replace(/^\./, '').toLowerCase();
      if (Array.isArray(cfg.extensions) && cfg.extensions.length) {
        const allow = new Set(cfg.extensions.map((x) => String(x).replace(/^\./, '').toLowerCase()));
        if (!allow.has(ext)) return;
      }

      const a = advise({ path: resolved, sizeBytes: size, maxFileBytes });
      const hint = a.recommendedCli || a.recommendedCommand || `${a.action} (${a.reducerCommand || 'n/a'})`;
      if (logSuggestions && typeof console.warn === 'function') {
        console.warn(
          `[openclaw-context-optimizer] Large read ~${size} B: ${resolved} → ${a.action} — ${hint} (preset=${a.preset || '—'})`,
        );
      }
    },
    { priority: 3 },
  );
};
