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

function isMetricsSafeMode() {
  return process.env.CONTEXT_OPTIMIZER_METRICS_SAFE === '1';
}

function truncateMetricError(msg, max = 160) {
  const s = String(msg || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function appendMetric(entry) {
  const dir = metricsDir();
  ensureDir(dir);
  const payload = { ts: new Date().toISOString(), ...entry };
  if (isMetricsSafeMode()) {
    delete payload.cwd;
    if (payload.error != null) payload.error = truncateMetricError(payload.error);
  }
  const line = JSON.stringify(payload);
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
    const repo = e.repoKey || e.projectHint;
    if (repo) projects.set(repo, (projects.get(repo) || 0) + 1);
  }

  const saved = Math.max(0, inTok - outTok);
  const ratios = entries.map((e) => e.ratio).filter((r) => r != null && Number.isFinite(r));
  const avgRatio = ratios.length ? ratios.reduce((a, r) => a + r, 0) / ratios.length : 0;
  const avgMs = entries.length
    ? Math.round(entries.reduce((sum, e) => sum + (e.durationMs || 0), 0) / entries.length)
    : 0;

  const agg = aggregateMetrics(entries);
  const cmdRatioLine = topAvgRatios(agg.avgRatioByCommand, 4);
  const presetRatioLine = topAvgRatios(agg.avgRatioByPreset, 4);
  const wfLine = Object.entries(agg.workflowTagGroups || {})
    .sort((a, b) => b[1].runs - a[1].runs || String(a[0]).localeCompare(String(b[0])))
    .slice(0, 3)
    .map(([t, g]) => `${t}:${g.runs}${g.avgRatio != null ? `@${g.avgRatio.toFixed(2)}` : ''}`)
    .join('  ');

  const last = entries.slice(-12);
  const lines = [
    'context-optimizer — metrics dashboard',
    '──────────────────────────────────────',
    `runs: ${entries.length}  ok: ${okRuns}  failed: ${entries.length - okRuns}  avgMs: ${avgMs}`,
    `tokens: in ${inTok}  out ${outTok}  saved ~${saved}  avg ratio ${avgRatio.toFixed(3)}`,
    cmdRatioLine ? `avg ratio / command: ${cmdRatioLine}` : 'avg ratio / command: n/a',
    presetRatioLine ? `avg ratio / preset: ${presetRatioLine}` : 'avg ratio / preset: n/a',
    wfLine ? `workflowTag: ${wfLine}` : 'workflowTag: none',
    `sources: file ${fileRuns}  stdin ${stdinRuns}`,
    `commands: ${topMap(commands)}`,
    `presets: ${topMap(presets)}`,
    projects.size ? `repos: ${topMap(projects, 3)}` : 'repos: none',
    '',
    ...(agg.tuningHints && agg.tuningHints.hints.length
      ? ['tuning (ratio = output/input, lower ≈ more compression):', ...agg.tuningHints.hints.map((h) => `  • ${h}`), '']
      : []),
    ...(agg.qualityHints && agg.qualityHints.length
      ? ['quality heuristics (human review):', ...agg.qualityHints.map((h) => `  • ${h}`), '']
      : []),
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

function accumulateRatio(map, key, ratio) {
  if (ratio == null || !Number.isFinite(ratio)) return;
  if (!map[key]) map[key] = { sum: 0, n: 0 };
  map[key].sum += ratio;
  map[key].n += 1;
}

function finalizeAvg(map) {
  const out = {};
  for (const [k, v] of Object.entries(map)) {
    out[k] = v.n ? v.sum / v.n : null;
  }
  return out;
}

function topAvgRatios(avgMap, limit = 5) {
  return Object.entries(avgMap)
    .filter(([, v]) => v != null && Number.isFinite(v))
    .sort((a, b) => a[1] - b[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit)
    .map(([k, v]) => `${k}:${Number(v).toFixed(3)}`)
    .join('  ');
}

/** Heuristic hints for tuning presets/workflows (lower ratio ≈ smaller output vs input). */
function buildTuningHints(avgRatioByPreset, avgRatioByCommand, workflowTagGroups) {
  const presetList = Object.entries(avgRatioByPreset).filter(([, v]) => v != null && Number.isFinite(v));
  presetList.sort((a, b) => a[1] - b[1] || String(a[0]).localeCompare(String(b[0])));
  const cmdList = Object.entries(avgRatioByCommand).filter(([, v]) => v != null && Number.isFinite(v));
  cmdList.sort((a, b) => a[1] - b[1] || String(a[0]).localeCompare(String(b[0])));
  const wfList = Object.entries(workflowTagGroups || {}).map(([tag, g]) => ({
    tag,
    avgRatio: g.avgRatio,
    runs: g.runs,
  }));
  wfList.sort((a, b) => (b.avgRatio || 0) - (a.avgRatio || 0) || String(a.tag).localeCompare(String(b.tag)));

  const hints = [];
  if (presetList[0]) {
    hints.push(`lowest avg ratio preset: ${presetList[0][0]} (${presetList[0][1].toFixed(3)})`);
  }
  if (cmdList[0]) {
    hints.push(`lowest avg ratio command: ${cmdList[0][0]} (${cmdList[0][1].toFixed(3)})`);
  }
  if (wfList[0] && wfList[0].avgRatio != null && Number.isFinite(wfList[0].avgRatio)) {
    hints.push(`highest avg ratio workflowTag: ${wfList[0].tag} (${wfList[0].avgRatio.toFixed(3)})`);
  }

  return {
    hints,
    bestPresetByAvgRatio: presetList[0] || null,
    tightestCommandByAvgRatio: cmdList[0] || null,
    hottestWorkflowTagByAvgRatio: wfList[0] && wfList[0].avgRatio != null ? wfList[0] : null,
  };
}

/** Heuristic quality / misuse signals (not ground truth). */
function buildQualityHints(avgRatioByPreset, avgRatioByCommand, entries) {
  const hints = [];
  const ag = avgRatioByPreset.aggressive;
  const agent = avgRatioByPreset.agent;
  const tri = avgRatioByPreset.triage;
  if (ag != null && agent != null && ag > agent + 0.07 && ag > 0.32) {
    hints.push('aggressive preset avg ratio runs higher than agent — try triage for first-pass repo/doc scans');
  }
  if (tri != null && agent != null && tri > agent + 0.1 && tri > 0.4) {
    hints.push('triage outputs are large vs agent — consider lowering tree/json budgets if summaries feel verbose');
  }
  const st = avgRatioByCommand['smart-tree'];
  const sr = avgRatioByCommand['smart-read'];
  if (st != null && sr != null && st > sr + 0.12) {
    hints.push('smart-tree compression weaker than smart-read — very wide repos may need shallower depth or smaller budget');
  }
  if (entries.length >= 10) {
    const failed = entries.filter((e) => e.success === false).length;
    if (failed / entries.length > 0.2) {
      hints.push('many failed runs — check invalid paths/JSON; poor ratios on failures skew averages');
    }
  }
  return hints;
}

function aggregateMetrics(entries) {
  const byCommand = {};
  const byPreset = {};
  const byRepo = {};
  const ratioSumsByCommand = {};
  const ratioSumsByPreset = {};
  const workflowBuckets = {};
  let inTok = 0;
  let outTok = 0;
  let ok = 0;
  const savings = [];
  const inputs = [];
  for (const e of entries) {
    inTok += e.inputTokensEst || 0;
    outTok += e.outputTokensEst || 0;
    if (e.success !== false) ok += 1;
    const cmd = e.command || '?';
    byCommand[cmd] = (byCommand[cmd] || 0) + 1;
    const pr = e.preset || 'balanced';
    byPreset[pr] = (byPreset[pr] || 0) + 1;
    const repo = e.repoKey || e.projectHint || null;
    if (repo) byRepo[repo] = (byRepo[repo] || 0) + 1;
    const r = e.ratio;
    accumulateRatio(ratioSumsByCommand, cmd, r);
    accumulateRatio(ratioSumsByPreset, pr, r);
    const wft = e.workflowTag != null && String(e.workflowTag).trim() !== '' ? String(e.workflowTag).trim() : '(no tag)';
    if (!workflowBuckets[wft]) workflowBuckets[wft] = { runs: 0, ratioSum: 0, ratioN: 0 };
    workflowBuckets[wft].runs += 1;
    if (r != null && Number.isFinite(r)) {
      workflowBuckets[wft].ratioSum += r;
      workflowBuckets[wft].ratioN += 1;
    }
    const saved = (e.inputTokensEst || 0) - (e.outputTokensEst || 0);
    savings.push({ target: e.target, savedApprox: saved, command: cmd });
    inputs.push({ target: e.target, inputTokensEst: e.inputTokensEst || 0, command: cmd });
  }
  savings.sort((a, b) => b.savedApprox - a.savedApprox || String(a.target).localeCompare(String(b.target)));
  inputs.sort((a, b) => b.inputTokensEst - a.inputTokensEst || String(a.target).localeCompare(String(b.target)));

  const avgRatioByCommand = finalizeAvg(ratioSumsByCommand);
  const avgRatioByPreset = finalizeAvg(ratioSumsByPreset);
  const workflowTagGroups = {};
  for (const [tag, b] of Object.entries(workflowBuckets)) {
    workflowTagGroups[tag] = {
      runs: b.runs,
      avgRatio: b.ratioN ? b.ratioSum / b.ratioN : null,
    };
  }

  const tuningHints = buildTuningHints(avgRatioByPreset, avgRatioByCommand, workflowTagGroups);
  const qualityHints = buildQualityHints(avgRatioByPreset, avgRatioByCommand, entries);

  return {
    windowRuns: entries.length,
    okRuns: ok,
    failedRuns: entries.length - ok,
    tokensIn: inTok,
    tokensOut: outTok,
    savedApprox: Math.max(0, inTok - outTok),
    byCommand,
    byPreset,
    byRepoKey: byRepo,
    avgRatioByCommand,
    avgRatioByPreset,
    workflowTagGroups,
    tuningHints,
    qualityHints,
    topSavingsApprox: savings.slice(0, 15),
    topInputsApprox: inputs.slice(0, 15),
  };
}

module.exports = {
  metricsDir,
  metricsFile,
  appendMetric,
  loadRecent,
  formatDashboard,
  aggregateMetrics,
  clearMetrics,
  estimateTokensFromText,
  buildTuningHints,
  buildQualityHints,
};
