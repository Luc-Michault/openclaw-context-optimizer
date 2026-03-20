const fs = require('fs');
const path = require('path');

/** Below this (non-log), raw `read` is usually enough. */
const SMALL_FILE_BYTES = 24 * 1024;
/** Above this, strongly prefer a reducer for text-ish artifacts. */
const LARGE_TEXT_BYTES = 256 * 1024;
/** Very large → aggressive preset by default. */
const HUGE_BYTES = 2 * 1024 * 1024;

function normalizeExt(p, extension) {
  if (extension != null && extension !== '') return String(extension).replace(/^\./, '').toLowerCase();
  return path.extname(p || '').replace(/^\./, '').toLowerCase();
}

function findRepoRoot(startPath) {
  if (!startPath) return null;
  let dir = fs.existsSync(startPath) && fs.statSync(startPath).isDirectory() ? startPath : path.dirname(startPath);
  dir = path.resolve(dir);
  for (let i = 0; i < 8; i += 1) {
    const hasGit = fs.existsSync(path.join(dir, '.git'));
    const hasPkg = fs.existsSync(path.join(dir, 'package.json'));
    const hasCargo = fs.existsSync(path.join(dir, 'Cargo.toml'));
    if (hasGit || hasPkg || hasCargo) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function isRepoRootish(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  try {
    if (!fs.statSync(dir).isDirectory()) return false;
  } catch {
    return false;
  }
  const markers = ['.git', 'package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml'];
  return markers.some((m) => fs.existsSync(path.join(dir, m)));
}

const LOCK_OR_CONFIG = /^(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|\.env\.example)$/i;

/**
 * @param {{ path?: string; sizeBytes?: number; extension?: string; commandHint?: string }} input
 */
function shouldReduce(input) {
  const p = input.path || '';
  const sizeBytes = Number(input.sizeBytes) || 0;
  const ext = normalizeExt(p, input.extension);
  const hint = (input.commandHint || '').toLowerCase();

  if (hint === 'shell' || hint === 'exec' || hint === 'rtk' || hint === 'pipeline') {
    return {
      reduce: false,
      reason: 'command output / shell stream: prefer RTK or head/tail/jq-style shaping before model ingestion',
    };
  }

  if (!p && sizeBytes === 0) {
    return { reduce: false, reason: 'no path or size; cannot recommend' };
  }

  const base = path.basename(p);

  if (LOCK_OR_CONFIG.test(base) && sizeBytes < SMALL_FILE_BYTES) {
    return { reduce: false, reason: 'small lockfile/config artifact: verbatim read is appropriate' };
  }

  if (ext === 'log' || /\.log$/i.test(p)) {
    if (sizeBytes > SMALL_FILE_BYTES) {
      return { reduce: true, reason: 'log files are usually repetitive; reducer surfaces patterns and anomalies' };
    }
    return { reduce: false, reason: 'small log; targeted read may suffice' };
  }

  if (['json', 'jsonl', 'ndjson'].includes(ext)) {
    if (sizeBytes > SMALL_FILE_BYTES) {
      return { reduce: true, reason: 'large JSON benefits from structural sketch + bounded anomaly scan' };
    }
    return { reduce: false, reason: 'small JSON; raw read is cheap' };
  }

  if (['csv', 'tsv'].includes(ext)) {
    if (sizeBytes > SMALL_FILE_BYTES) {
      return { reduce: true, reason: 'tabular summaries expose width/schema issues without full scan in chat' };
    }
    return { reduce: false, reason: 'small table; raw read may suffice' };
  }

  if (['md', 'txt'].includes(ext) || ext === '') {
    if (sizeBytes >= LARGE_TEXT_BYTES) {
      return { reduce: true, reason: 'large text/doc: dedupe + section/triage hints reduce noise' };
    }
    if (sizeBytes > SMALL_FILE_BYTES) {
      return { reduce: true, reason: 'medium text: reducer gives first-pass triage before deep read' };
    }
    return { reduce: false, reason: 'small file: verbatim read is appropriate' };
  }

  if (sizeBytes >= HUGE_BYTES) {
    return { reduce: true, reason: 'very large file: always preview/triage before full read' };
  }

  return {
    reduce: sizeBytes > SMALL_FILE_BYTES,
    reason:
      sizeBytes > SMALL_FILE_BYTES
        ? 'non-trivial size: reducer can bound context while preserving anomalies'
        : 'small artifact: raw read unless you need structural hints only',
  };
}

/**
 * @param {{ path?: string; extension?: string; mimeHint?: string }} input
 * @returns {{ command: string; kind: string }}
 */
function recommendedReducer(input) {
  const p = input.path || '';
  const ext = normalizeExt(p, input.extension);
  const mime = (input.mimeHint || '').toLowerCase();

  if (mime.includes('json')) return { command: 'smart-json', kind: 'json' };
  if (['json', 'jsonl', 'ndjson'].includes(ext)) return { command: 'smart-json', kind: 'json' };
  if (['csv', 'tsv'].includes(ext)) return { command: 'smart-csv', kind: 'csv' };
  if (ext === 'log' || /\.log$/i.test(p)) return { command: 'smart-log', kind: 'log' };

  if (p) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return { command: 'smart-tree', kind: 'tree' };
    } catch {
      /* ignore */
    }
  }

  return { command: 'smart-read', kind: 'text' };
}

/**
 * @param {{ kind?: string; sizeBytes?: number; urgency?: string }} input
 */
function recommendedPreset(input) {
  const sizeBytes = Number(input.sizeBytes) || 0;
  const kind = (input.kind || 'text').toLowerCase();
  const urgency = (input.urgency || 'normal').toLowerCase();

  if (urgency === 'high' || urgency === 'tight') {
    if (kind === 'log') return 'aggressive';
    if (kind === 'json') return 'schema';
    return 'aggressive';
  }

  if (kind === 'tree') return 'triage';
  if (kind === 'json') return sizeBytes > LARGE_TEXT_BYTES ? 'schema' : 'agent';
  if (kind === 'log') return sizeBytes > HUGE_BYTES ? 'aggressive' : 'agent';
  if (kind === 'csv') return 'agent';

  if (sizeBytes >= HUGE_BYTES) return 'aggressive';
  if (sizeBytes >= LARGE_TEXT_BYTES) return 'triage';
  return 'agent';
}

function cliQuote(fp) {
  return fp.includes(' ') ? JSON.stringify(fp) : fp;
}

/**
 * Full decision object for agents and `advise` CLI.
 * @param {{
 *   path?: string;
 *   sizeBytes?: number;
 *   extension?: string;
 *   commandHint?: string;
 *   urgency?: string;
 *   maxFileBytes?: number;
 * }} input
 */
function advise(input) {
  const p = input.path ? path.resolve(String(input.path)) : '';
  const sizeBytes = Number(input.sizeBytes) || 0;
  const extension = input.extension != null ? String(input.extension) : path.extname(p).slice(1);
  const ext = normalizeExt(p, extension);
  const basename = p ? path.basename(p) : '';
  const parentDir = p ? path.basename(path.dirname(p)) : '';
  const hint = (input.commandHint || '').toLowerCase();
  const urgency = input.urgency != null ? String(input.urgency) : 'normal';
  const threshold = Number(input.maxFileBytes) > 0 ? Number(input.maxFileBytes) : LARGE_TEXT_BYTES;

  const why = [];
  let action = 'reduce';
  let confidence = 'medium';
  let nextStepIfInsufficient =
    'Open the exact file/lines the reducer highlighted (anomalies, readNext, section map) with a targeted read.';

  if (hint === 'shell' || hint === 'exec' || hint === 'rtk' || hint === 'pipeline') {
    why.push('Intent looks like shell/command output, not a static file payload.');
    why.push('RTK rewrites exec streams; this package reduces on-disk artifacts.');
    return {
      action: 'rtk-shell',
      confidence: 'high',
      why,
      recommendedCommand: null,
      recommendedCli: null,
      reducerCommand: null,
      kind: 'shell',
      preset: null,
      shouldReduce: false,
      reduceReason: why.join(' '),
      nextStepIfInsufficient:
        'Use RTK-wrapped exec or narrow the command (paths, flags, tail/head). Re-run before sending full output to the model.',
      path: p || null,
      isDirectory: false,
      sizeBytes,
      extension: ext || null,
      basename: basename || null,
      parentDir: parentDir || null,
      repoRoot: findRepoRoot(p || process.cwd()),
      projectNote: null,
    };
  }

  let isDirectory = false;
  if (p && fs.existsSync(p)) {
    try {
      isDirectory = fs.statSync(p).isDirectory();
    } catch {
      /* ignore */
    }
  }

  const repoRoot = findRepoRoot(p || process.cwd());
  let projectNote = null;
  if (repoRoot && repoRoot !== path.dirname(p)) {
    projectNote = `nearest repo root: ${repoRoot}`;
  } else if (repoRoot && isDirectory && path.resolve(p) === repoRoot) {
    projectNote = 'path is repo root';
  }

  if (isDirectory) {
    why.push('Directories need layout + triage hints before reading files at random.');
    if (isRepoRootish(p)) why.push('Looks like a project root (markers present).');
    const rec = { command: 'smart-tree', kind: 'tree' };
    const preset = recommendedPreset({ kind: 'tree', sizeBytes: 0, urgency });
    const safe = cliQuote(p);
    const cmd = `context-optimizer ${rec.command} ${safe} --preset=${preset}`;
    return {
      action: 'reduce',
      confidence: isRepoRootish(p) ? 'high' : 'medium',
      why,
      recommendedCommand: cmd,
      recommendedCli: cmd,
      reducerCommand: rec.command,
      kind: rec.kind,
      preset,
      shouldReduce: true,
      reduceReason: why.join(' '),
      nextStepIfInsufficient:
        'Use triageHints.readNext (path + reason) or readNextPaths, plus recentlyTouched; then exact-read 3–7 highest-signal files.',
      path: p,
      isDirectory: true,
      sizeBytes: 0,
      extension: null,
      basename: basename || null,
      parentDir: parentDir || null,
      repoRoot,
      projectNote,
    };
  }

  const reduce = shouldReduce({ path: p, sizeBytes, extension: ext, commandHint: input.commandHint });
  const rec = recommendedReducer({ path: p, extension: ext, mimeHint: input.mimeHint });
  const preset = recommendedPreset({ kind: rec.kind, sizeBytes, urgency });

  if (!reduce.reduce) {
    action = 'raw-read';
    confidence = sizeBytes < SMALL_FILE_BYTES / 2 ? 'high' : 'medium';
    why.push(reduce.reason);
    if (/^(readme|contributing|agents|changelog)/i.test(basename)) why.push('Doc entrypoints are often read verbatim when small.');
    const cmd = `Exact read (native read tool) on ${cliQuote(p)} — file is small enough for verbatim context.`;
    return {
      action,
      confidence,
      why,
      recommendedCommand: cmd,
      recommendedCli: null,
      reducerCommand: null,
      kind: rec.kind,
      preset: null,
      shouldReduce: false,
      reduceReason: reduce.reason,
      nextStepIfInsufficient:
        'If the file is larger than expected or noisy, re-run `context-optimizer advise` after refresh or use smart-read.',
      path: p,
      isDirectory: false,
      sizeBytes,
      extension: ext || null,
      basename,
      parentDir,
      repoRoot,
      projectNote,
    };
  }

  action = 'reduce';
  why.push(reduce.reason);
  if (sizeBytes >= threshold) why.push(`Size is above the large-file hint threshold (~${threshold} bytes).`);
  if (/\.(env|local|secret)/i.test(basename)) why.push('Sensitive names: reducer triages shape; use raw read only for exact secrets handling.');
  confidence = sizeBytes >= HUGE_BYTES ? 'high' : 'medium';

  const safe = cliQuote(p);
  const cmd = `context-optimizer ${rec.command} ${safe} --preset=${preset}`;
  return {
    action,
    confidence,
    why,
    recommendedCommand: cmd,
    recommendedCli: cmd,
    reducerCommand: rec.command,
    kind: rec.kind,
    preset,
    shouldReduce: true,
    reduceReason: reduce.reason,
    nextStepIfInsufficient,
    path: p,
    isDirectory: false,
    sizeBytes,
    extension: ext || null,
    basename,
    parentDir,
    repoRoot,
    projectNote,
  };
}

/**
 * @param {{
 *   path?: string;
 *   sizeBytes?: number;
 *   extension?: string;
 *   commandHint?: string;
 *   urgency?: string;
 * }} input
 */
function explainPolicyDecision(input) {
  const a = advise(input);
  const lines = [
    `action: ${a.action} (confidence: ${a.confidence})`,
    ...a.why.map((w) => `  - ${w}`),
    a.recommendedCommand ? `next: ${a.recommendedCommand}` : 'next: (see rtk-shell guidance)',
    `if insufficient: ${a.nextStepIfInsufficient}`,
  ];
  return lines.join('\n');
}

module.exports = {
  SMALL_FILE_BYTES,
  LARGE_TEXT_BYTES,
  HUGE_BYTES,
  shouldReduce,
  recommendedReducer,
  recommendedPreset,
  explainPolicyDecision,
  advise,
  findRepoRoot,
  isRepoRootish,
};
