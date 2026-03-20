const fs = require('fs');
const path = require('path');
const os = require('os');

function metricsDir() {
  return process.env.CONTEXT_OPTIMIZER_METRICS_DIR || path.join(os.homedir(), '.context-optimizer');
}

function metricsFile() {
  return path.join(metricsDir(), 'metrics.jsonl');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function estimateTokensFromText(text) {
  const b = Buffer.byteLength(text || '', 'utf8');
  if (b === 0) return 0;
  return Math.max(1, Math.ceil(b / 4));
}

function appendMetric(entry) {
  const dir = metricsDir();
  ensureDir(dir);
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  fs.appendFileSync(metricsFile(), `${line}\n`, 'utf8');
}

function readAllLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
}

function loadRecent(limit = 500) {
  const lines = readAllLines(metricsFile());
  const slice = lines.slice(-limit);
  return slice.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function formatDashboard(entries) {
  if (!entries.length) {
    return [
      'context-optimizer metrics',
      '─────────────────────',
      'No entries yet. Run with --metrics or CONTEXT_OPTIMIZER_METRICS=1',
      '',
    ].join('\n');
  }

  let inTok = 0;
  let outTok = 0;
  let okRuns = 0;
  let stdinRuns = 0;
  let fileRuns = 0;
  const commands = new Map();
  const presets = new Map();
  const projects = new Map();

  for (const e of entries) {
    inTok += e.inputTokensEst || 0;
    outTok += e.outputTokensEst || 0;
    if (e.success !== false) okRuns += 1;
    if (e.sourceType === 'stdin' || e.stdin) stdinRuns += 1;
    else fileRuns += 1;
    commands.set(e.command || '?', (commands.get(e.command || '?') || 0) + 1);
    presets.set(e.preset || 'balanced', (presets.get(e.preset || 'balanced') || 0) + 1);
    if (e.projectHint) projects.set(e.projectHint, (projects.get(e.projectHint) || 0) + 1);
  }

  const saved = Math.max(0, inTok - outTok);
  const ratios = entries.map((e) => e.ratio).filter((r) => r != null && Number.isFinite(r));
  const avgRatio = ratios.length ? ratios.reduce((a, r) => a + r, 0) / ratios.length : 0;
  const avgMs = entries.length
    ? Math.round(entries.reduce((sum, e) => sum + (e.durationMs || 0), 0) / entries.length)
    : 0;

  const last = entries.slice(-12);
  const lines = [
    'context-optimizer — metrics dashboard',
    '──────────────────────────────────────',
    `runs: ${entries.length}  ok: ${okRuns}  failed: ${entries.length - okRuns}  avgMs: ${avgMs}`,
    `tokens: in ${inTok}  out ${outTok}  saved ~${saved}  avg ratio ${avgRatio.toFixed(3)}`,
    `sources: file ${fileRuns}  stdin ${stdinRuns}`,
    `commands: ${topMap(commands)}`,
    `presets: ${topMap(presets)}`,
    projects.size ? `projects: ${topMap(projects, 3)}` : 'projects: none',
    '',
    'recent runs (newest last):',
    '──────────────────────────────────────',
  ];

  for (const e of last) {
    const t = (e.ts || '').slice(11, 19);
    const cmd = (e.command || '?').padEnd(11);
    const preset = String(e.preset || 'balanced').padEnd(10);
    const tgt = truncateMiddle(String(e.target || ''), 22);
    const r = e.ratio != null && Number.isFinite(e.ratio) ? e.ratio.toFixed(2) : 'n/a';
    const src = e.sourceType || (e.stdin ? 'stdin' : 'file');
    const ok = e.success === false ? 'ERR' : 'OK ';
    lines.push(`${t}  ${ok}  ${cmd}  ${preset}  ${src.padEnd(5)}  ${tgt}  ratio=${r}  ms=${e.durationMs || 0}`);
  }
  lines.push('');
  return lines.join('\n');
}

function topMap(map, limit = 4) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit)
    .map(([key, value]) => `${key}:${value}`)
    .join('  ');
}

function truncateMiddle(s, max) {
  if (s.length <= max) return s;
  const half = Math.floor((max - 1) / 2);
  return `${s.slice(0, half)}…${s.slice(s.length - half)}`;
}

function clearMetrics() {
  const f = metricsFile();
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

module.exports = {
  metricsDir,
  metricsFile,
  appendMetric,
  loadRecent,
  formatDashboard,
  clearMetrics,
  estimateTokensFromText,
};
