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

function gatherRepoContext(repoRoot) {
  const empty = { markers: [], stacks: [], openclawAdjacent: false, inferences: [] };
  if (!repoRoot) return empty;
  try {
    if (!fs.existsSync(repoRoot) || !fs.statSync(repoRoot).isDirectory()) return empty;
  } catch {
    return empty;
  }
  const names = [
    '.git',
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'npm-shrinkwrap.json',
    'Cargo.toml',
    'Cargo.lock',
    'go.mod',
    'go.sum',
    'pyproject.toml',
    'setup.py',
    'poetry.lock',
    'README.md',
    'AGENTS.md',
    'openclaw.json',
    'openclaw.plugin.json',
  ];
  const markers = names.filter((n) => {
    try {
      return fs.existsSync(path.join(repoRoot, n));
    } catch {
      return false;
    }
  });
  const stacks = [];
  if (markers.some((m) => m === 'package.json')) stacks.push('node');
  if (markers.some((m) => m === 'Cargo.toml')) stacks.push('rust');
  if (markers.some((m) => m === 'go.mod')) stacks.push('go');
  if (markers.some((m) => m === 'pyproject.toml' || m === 'setup.py')) stacks.push('python');
  const openclawAdjacent = markers.some((m) => /openclaw/i.test(m));
  const inferences = [];
  if (markers.includes('pnpm-workspace.yaml') || markers.includes('lerna.json') || markers.includes('nx.json')) {
    inferences.push('layout:workspace-tooling');
  }
  if (openclawAdjacent) inferences.push('openclaw:extension-or-config');
  if (markers.includes('Cargo.toml') && !markers.includes('package.json')) inferences.push('project:rust-primary');
  if (markers.includes('go.mod') && !markers.includes('package.json')) inferences.push('project:go-primary');

  const pkgPath = path.join(repoRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8').slice(0, 65536));
      if (pkg && typeof pkg === 'object') {
        if (pkg.bin) inferences.push('node:declares-bin');
        if (pkg.private === true) inferences.push('npm:private');
        if (pkg.private !== true && typeof pkg.name === 'string' && pkg.name) inferences.push('npm:publishable-package');
        if (!pkg.bin && (pkg.main || pkg.module || pkg.exports)) inferences.push('node:has-entry-fields');
      }
    } catch {
      /* ignore */
    }
  }

  return {
    markers: markers.slice().sort((a, b) => a.localeCompare(b)),
    stacks: stacks.slice().sort((a, b) => a.localeCompare(b)),
    openclawAdjacent,
    inferences: inferences.slice().sort((a, b) => a.localeCompare(b)),
  };
}

function relFromRepo(filePath, repoRoot) {
  if (!repoRoot || !filePath) return '';
  const abs = path.resolve(filePath);
  const root = path.resolve(repoRoot);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || rel === '') return path.basename(abs);
  return rel.replace(/\\/g, '/');
}

function classifyPathRoles(absPath, repoRoot) {
  const roles = [];
  if (!absPath) return roles;
  const base = path.basename(absPath);
  const parent = path.basename(path.dirname(absPath));
  const rel = relFromRepo(absPath, repoRoot);
  const relLower = rel.toLowerCase();
  const baseLower = base.toLowerCase();

  if (/^readme/i.test(base)) roles.push('doc:readme');
  if (/changelog/i.test(base)) roles.push('doc:changelog');
  if (baseLower === 'agents.md') roles.push('doc:agents');
  if (/skill\.md$/i.test(base)) roles.push('doc:skill');
  if (baseLower === 'package.json') roles.push('manifest:node');
  if (/package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|cargo\.lock|poetry\.lock/i.test(base)) {
    roles.push('lock:generated');
  }
  if (/^\.env/i.test(base)) roles.push('config:secrets');
  if (/dockerfile/i.test(base) || baseLower === '.dockerignore') roles.push('deploy:container');

  if (/(^|\/)(test|tests|__tests__|spec)(\/|$)/i.test(relLower) || /\.(test|spec)\.(tsx?|jsx?|mjs|cjs)$/i.test(baseLower)) {
    roles.push('test-adjacent');
  }
  for (const seg of ['src/', 'lib/', 'app/', 'docs/', 'config/', 'scripts/']) {
    if (relLower.startsWith(seg) || relLower === seg.replace(/\/$/, '')) roles.push(`tree:${seg.replace(/\/$/, '')}`);
  }
  if (/(^|\/)dist\/|(^|\/)build\/|(^|\/)\.next\/|(^|\/)out\/|(^|\/)target\/|(^|\/)__pycache__\//i.test(relLower)) {
    roles.push('path:generated-output');
  }
  if (/\.(generated|lock)\.|^\.cache\//i.test(relLower)) roles.push('path:likely-generated');

  try {
    if (fs.existsSync(absPath) && fs.statSync(absPath).isDirectory() && isRepoRootish(absPath)) {
      roles.push('path:repo-root');
    }
  } catch {
    /* ignore */
  }

  return [...new Set(roles)].sort((a, b) => a.localeCompare(b));
}

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

  if (/^package-lock\.json$/i.test(base) || /^npm-shrinkwrap\.json$/i.test(base)) {
    if (sizeBytes > SMALL_FILE_BYTES) {
      return {
        reduce: true,
        reason: 'npm lockfile is generated dependency graph JSON; smart-json sketches it without dumping every resolved entry',
      };
    }
    return { reduce: false, reason: 'small npm lock excerpt; verbatim read can be fine' };
  }

  if (/^package\.json$/i.test(base)) {
    if (sizeBytes > SMALL_FILE_BYTES * 2) {
      return {
        reduce: true,
        reason: 'unusually large package.json; smart-json highlights scripts/deps fields first',
      };
    }
    return { reduce: false, reason: 'package manifest: moderate size → verbatim read is typical' };
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

/** Numeric 0–100; higher = more certain the primary action fits. */
function scoreToConfidenceLabel(score) {
  const s = Math.max(0, Math.min(100, score));
  if (s >= 90) return 'very-high';
  if (s >= 75) return 'high';
  if (s >= 55) return 'medium';
  return 'low';
}

function scoreFileReduceDecision({ sizeBytes, threshold, roles, kind, ext }) {
  let score = 62;
  if (sizeBytes >= HUGE_BYTES) score += 28;
  else if (sizeBytes >= LARGE_TEXT_BYTES) score += 18;
  else if (sizeBytes > SMALL_FILE_BYTES) score += 10;
  if (sizeBytes >= threshold) score += 6;
  if (roles.includes('lock:generated')) score += 8;
  if (roles.includes('doc:readme') && (ext === 'md' || ext === '')) score += 5;
  if (kind === 'log') score += 5;
  return Math.min(98, score);
}

function scoreRawReadDecision({ sizeBytes, roles }) {
  let score = 68;
  if (sizeBytes < SMALL_FILE_BYTES / 2) score += 22;
  else if (sizeBytes < SMALL_FILE_BYTES) score += 12;
  if (roles.includes('manifest:node') || roles.includes('doc:agents')) score += 8;
  if (roles.includes('lock:generated')) score += 5;
  return Math.min(96, score);
}

/**
 * Phase 1–2: resolve path, repo, roles (no action yet).
 */
function buildAdviseContext(input) {
  const p = input.path ? path.resolve(String(input.path)) : '';
  const sizeBytes = Number(input.sizeBytes) || 0;
  const extension = input.extension != null ? String(input.extension) : path.extname(p).slice(1);
  const ext = normalizeExt(p, extension);
  const basename = p ? path.basename(p) : '';
  const parentDir = p ? path.basename(path.dirname(p)) : '';
  const hint = (input.commandHint || '').toLowerCase();
  const urgency = input.urgency != null ? String(input.urgency) : 'normal';
  const threshold = Number(input.maxFileBytes) > 0 ? Number(input.maxFileBytes) : LARGE_TEXT_BYTES;
  const repoRoot = findRepoRoot(p || process.cwd());
  let isDirectory = false;
  if (p && fs.existsSync(p)) {
    try {
      isDirectory = fs.statSync(p).isDirectory();
    } catch {
      /* ignore */
    }
  }
  let projectNote = null;
  if (repoRoot && p) {
    if (isDirectory && path.resolve(p) === repoRoot) {
      projectNote = 'path is repo root';
    } else if (!isDirectory && repoRoot !== path.dirname(p)) {
      projectNote = `nearest repo root: ${repoRoot}`;
    }
  }
  return {
    p,
    sizeBytes,
    extension: ext,
    basename,
    parentDir,
    hint,
    urgency,
    threshold,
    repoRoot,
    isDirectory,
    projectNote,
    pathRoles: p ? classifyPathRoles(p, repoRoot) : [],
    repoContext: gatherRepoContext(repoRoot),
  };
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
  const ctx = buildAdviseContext(input);
  const {
    p,
    sizeBytes,
    extension: ext,
    basename,
    parentDir,
    hint,
    urgency,
    threshold,
    repoRoot,
    isDirectory,
    projectNote,
    pathRoles: rolesPre,
    repoContext: ctxRepoPre,
  } = ctx;

  const why = [];
  const nextStepIfInsufficientDefault =
    'Open the exact file/lines the reducer highlighted (anomalies, readNext, section map) with a targeted read.';

  /* Phase: shell / exec → RTK (not file reducers) */
  if (hint === 'shell' || hint === 'exec' || hint === 'rtk' || hint === 'pipeline') {
    why.push('Intent looks like shell/command output, not a static file payload.');
    why.push('RTK rewrites exec streams; this package reduces on-disk artifacts.');
    const score = 91;
    return {
      action: 'rtk-shell',
      confidence: scoreToConfidenceLabel(score),
      confidenceScore: score,
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
      repoRoot,
      projectNote: null,
      repoContext: ctxRepoPre,
      pathRoles: p ? rolesPre : [],
      alternatives: [
        { action: 'rtk-shell', note: 'Primary: shape exec stream (RTK) before model sees it' },
        { action: 'raw-read', note: 'Only if output was saved to a small file and you need exact bytes' },
        { action: 'reduce', note: 'If you must triage a saved dump, advise that file path (not the live pipe)' },
      ],
      worthReadingExactly: null,
    };
  }

  /* Phase: directory → tree triage */
  if (isDirectory) {
    const rootish = isRepoRootish(p);
    why.push('Directories need layout + triage hints before reading files at random.');
    if (rootish) {
      why.push('Project root markers present — smart-tree is the default OpenClaw first pass here.');
    }
    const rec = { command: 'smart-tree', kind: 'tree' };
    const preset = recommendedPreset({ kind: 'tree', sizeBytes: 0, urgency });
    const safe = cliQuote(p);
    const cmd = `context-optimizer ${rec.command} ${safe} --preset=${preset}`;
    const ctxGathered = gatherRepoContext(repoRoot);
    if (ctxGathered.stacks.length) why.push(`Repo stack hints: ${ctxGathered.stacks.join(', ')}.`);
    if (ctxGathered.inferences && ctxGathered.inferences.length) {
      why.push(`Repo inferences: ${ctxGathered.inferences.slice(0, 6).join(', ')}.`);
    }
    const dirScore = rootish ? 96 : 80;
    return {
      action: 'reduce',
      confidence: scoreToConfidenceLabel(dirScore),
      confidenceScore: dirScore,
      why,
      recommendedCommand: cmd,
      recommendedCli: cmd,
      reducerCommand: rec.command,
      kind: rec.kind,
      preset,
      shouldReduce: true,
      reduceReason: why.join(' '),
      nextStepIfInsufficient:
        'Use triageHints.readNext, triageGroups, readNextSecondary, and recentlyTouched; exact-read 3–7 paths.',
      path: p,
      isDirectory: true,
      sizeBytes: 0,
      extension: null,
      basename: basename || null,
      parentDir: parentDir || null,
      repoRoot,
      projectNote,
      repoContext: ctxGathered,
      pathRoles: classifyPathRoles(p, repoRoot),
      alternatives: [
        { action: 'reduce', recommendedCli: cmd, note: 'Primary: bounded tree + ranked read lists' },
        { action: 'raw-read', note: 'Never substitute a whole directory blob for this — pick files from triage output' },
        { action: 'rtk-shell', note: 'If you only need `ls`/`find` style discovery, RTK-shaped exec can complement tree' },
      ],
      worthReadingExactly:
        'After smart-tree, exact-read only paths in readNext / triageGroups — not the entire tree listing.',
    };
  }

  /* Phase: file → reduce vs raw */
  const reduce = shouldReduce({ path: p, sizeBytes, extension: ext, commandHint: input.commandHint });
  const rec = recommendedReducer({ path: p, extension: ext, mimeHint: input.mimeHint });
  const preset = recommendedPreset({ kind: rec.kind, sizeBytes, urgency });
  const roles = classifyPathRoles(p, repoRoot);
  const ctxRepo = gatherRepoContext(repoRoot);

  if (!reduce.reduce) {
    why.push(reduce.reason);
    if (/^(readme|contributing|agents|changelog)/i.test(basename)) why.push('Doc entrypoints are often read verbatim when small.');
    if (roles.includes('lock:generated')) why.push('Lockfile: exact pins matter for audits—verbatim read is normal when small.');
    if (roles.includes('manifest:node') && sizeBytes < SMALL_FILE_BYTES * 2) {
      why.push('Small package.json: scripts and deps are usually read exactly before edits.');
    }
    const cmd = `Exact read (native read tool) on ${cliQuote(p)} — file is small enough for verbatim context.`;
    if (ctxRepo.openclawAdjacent) why.push('OpenClaw config or extension files nearby — check AGENTS.md / openclaw.json after manifests.');
    const altCmd = `context-optimizer ${rec.command} ${cliQuote(p)} --preset=agent`;
    const rs = scoreRawReadDecision({ sizeBytes, roles });
    return {
      action: 'raw-read',
      confidence: scoreToConfidenceLabel(rs),
      confidenceScore: rs,
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
      repoContext: ctxRepo,
      pathRoles: roles,
      alternatives: [
        { action: 'raw-read', recommendedCommand: cmd, note: 'Primary: verbatim read fits context' },
        { action: 'reduce', recommendedCli: altCmd, note: 'If structure/triage would speed understanding' },
        { action: 'rtk-shell', note: 'If this path is actually shell output mis-saved, reshape at exec with RTK' },
      ],
      worthReadingExactly:
        roles.includes('manifest:node') && sizeBytes < SMALL_FILE_BYTES * 2
          ? 'Read package.json verbatim for scripts, dependencies, and package metadata before changing npm/yarn/pnpm behavior.'
          : sizeBytes < SMALL_FILE_BYTES / 2
            ? 'Whole file is small—safe to load verbatim in one read.'
            : 'Prefer verbatim read; use smart-read when headings/checklists make scoped reads faster.',
    };
  }

  why.push(reduce.reason);
  if (sizeBytes >= threshold) why.push(`Size is above the large-file hint threshold (~${threshold} bytes).`);
  if (/\.(env|local|secret)/i.test(basename)) why.push('Sensitive names: reducer triages shape; use raw read only for exact secrets handling.');
  if (roles.includes('doc:readme') && (ext === 'md' || ext === '')) {
    why.push('Large README: use section map from smart-read to pick the next exact read range.');
  }
  const reduceScore = scoreFileReduceDecision({
    sizeBytes,
    threshold,
    roles,
    kind: rec.kind,
    ext,
  });

  const safe = cliQuote(p);
  const cmd = `context-optimizer ${rec.command} ${safe} --preset=${preset}`;
  return {
    action: 'reduce',
    confidence: scoreToConfidenceLabel(reduceScore),
    confidenceScore: reduceScore,
    why,
    recommendedCommand: cmd,
    recommendedCli: cmd,
    reducerCommand: rec.command,
    kind: rec.kind,
    preset,
    shouldReduce: true,
    reduceReason: reduce.reason,
    nextStepIfInsufficient: nextStepIfInsufficientDefault,
    path: p,
    isDirectory: false,
    sizeBytes,
    extension: ext || null,
    basename,
    parentDir,
    repoRoot,
    projectNote,
    repoContext: ctxRepo,
    pathRoles: roles,
    alternatives: [
      { action: 'reduce', recommendedCli: cmd, note: 'Primary: bounded reducer for this artifact type' },
      { action: 'raw-read', note: 'If you need every line for a patch, narrow to line range after reducer cues' },
      { action: 'rtk-shell', note: 'If content is from exec, fix upstream with RTK instead of smart-log on a stale file' },
    ],
    worthReadingExactly:
      rec.kind === 'json'
        ? 'After smart-json, exact-read only the object keys or array slices you will edit.'
        : rec.kind === 'log'
          ? 'After smart-log, exact-read around anomaly line numbers from the summary.'
          : 'After smart-read, exact-read headings or line ranges the section map highlights.',
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
    `action: ${a.action} (confidence: ${a.confidence}${a.confidenceScore != null ? `, score=${a.confidenceScore}` : ''})`,
    ...a.why.map((w) => `  - ${w}`),
  ];
  if (a.pathRoles && a.pathRoles.length) lines.push(`path roles: ${a.pathRoles.join(', ')}`);
  if (a.repoContext && a.repoContext.markers && a.repoContext.markers.length) {
    lines.push(`repo markers: ${a.repoContext.markers.join(', ')}`);
  }
  if (a.repoContext && a.repoContext.inferences && a.repoContext.inferences.length) {
    lines.push(`repo inferences: ${a.repoContext.inferences.join(', ')}`);
  }
  if (a.alternatives && a.alternatives.length) {
    lines.push('alternatives:');
    for (const alt of a.alternatives) {
      const tail = [alt.recommendedCli, alt.recommendedCommand].filter(Boolean).join(' ');
      lines.push(`  - ${alt.action}${tail ? `: ${tail}` : ''} — ${alt.note || ''}`);
    }
  }
  if (a.worthReadingExactly) lines.push(`worth reading exactly: ${a.worthReadingExactly}`);
  lines.push(a.recommendedCommand ? `next: ${a.recommendedCommand}` : 'next: (see rtk-shell guidance)');
  lines.push(`if insufficient: ${a.nextStepIfInsufficient}`);
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
  gatherRepoContext,
  classifyPathRoles,
  buildAdviseContext,
  scoreToConfidenceLabel,
};
