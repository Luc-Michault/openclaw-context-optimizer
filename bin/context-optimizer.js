#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  smartRead,
  smartLog,
  smartCsv,
  smartJson,
  smartTree,
  smartReadText,
  smartLogText,
  smartCsvText,
  smartJsonText,
  formatOutput,
  DEFAULT_PRESET,
} = require('../src/index');
const {
  appendMetric,
  loadRecent,
  formatDashboard,
  clearMetrics,
  estimateTokensFromText,
} = require('../src/metrics');
const { clampInt, normalizePresetName, summarizeBudget, resolveBudget } = require('../src/budget');

function usage() {
  console.log(`context-optimizer <command> [options] <path>
       context-optimizer metrics [options]

Commands:
  smart-read   Compact summary for text files
  smart-log    Log-oriented summary
  smart-csv    CSV structural summary (RFC-aware quoting)
  smart-json   JSON structure sketch
  smart-tree   Budgeted directory tree
  metrics      Terminal dashboard + cumulative token estimates (JSONL log)

Global options:
  --json              Machine-readable JSON on stdout
  --metrics           Append this run to ~/.context-optimizer/metrics.jsonl
  --tokens            Include estimatedTokens (input/output ~bytes/4) in JSON or footer text
  --preset=NAME       balanced | agent | triage | aggressive | schema
  --max-lines=N       Preview / anomaly / pattern / CSV sample row budget
  --max-depth=N       Directory tree max depth
  --json-depth=N      Max depth when walking JSON for structure + anomalies
  --budget=N          Tree entry budget + JSON node visit budget (coarse knob)
  --stdin             Read file content from stdin (requires --label for display)
  --label=NAME        Display name for target (also used with stdin)

metrics options:
  --clear             Delete the metrics log
  --limit=N           Max JSONL lines to aggregate (default 500)

Examples:
  context-optimizer smart-read README.md --preset=agent
  context-optimizer smart-tree . --preset=triage
  cat big.log | context-optimizer smart-log --stdin --label=app.log --preset=aggressive
  context-optimizer metrics`);
}

function fail(message, code = 1) {
  console.error(`error: ${message}`);
  process.exit(code);
}

function parseCli(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq >= 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('-')) {
          flags[key] = next;
          i += 1;
        } else flags[key] = true;
      }
    } else if (a.startsWith('-') && a.length > 2 && a[1] !== '-') {
      for (let j = 1; j < a.length; j += 1) flags[a[j]] = true;
    } else if (a === '-h') flags.help = true;
    else positional.push(a);
  }
  return { positional, flags };
}

function readStdinUtf8() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (e) {
    fail(`stdin read failed: ${e.message}`);
  }
}

function buildCliBudget(flags) {
  const cli = {};
  if (flags['max-lines'] != null) cli.maxLines = clampInt(flags['max-lines'], 1, 500);
  if (flags['max-depth'] != null) cli.maxDepth = clampInt(flags['max-depth'], 0, 64);
  if (flags['json-depth'] != null) cli.jsonDepth = clampInt(flags['json-depth'], 1, 256);
  if (flags.budget != null) cli.budget = clampInt(flags.budget, 10, 100_000);
  if (flags.preset != null) cli.preset = normalizePresetName(flags.preset);
  return cli;
}

function buildOpts(flags, labelFromPath) {
  const cli = buildCliBudget(flags);
  const label = flags.label != null ? String(flags.label) : labelFromPath;
  return { cli, label: label || labelFromPath, preset: cli.preset || DEFAULT_PRESET };
}

function runCommand(command, resolved, flags, inputText) {
  const opts = buildOpts(flags, resolved ? path.basename(resolved) : '(stdin)');
  switch (command) {
    case 'smart-read':
      return inputText != null ? smartReadText(inputText, opts.label || '(stdin)', opts) : smartRead(resolved, opts);
    case 'smart-log':
      return inputText != null ? smartLogText(inputText, opts.label || '(stdin)', opts) : smartLog(resolved, opts);
    case 'smart-csv':
      return inputText != null ? smartCsvText(inputText, opts.label || '(stdin)', opts) : smartCsv(resolved, opts);
    case 'smart-json':
      return inputText != null ? smartJsonText(inputText, opts.label || '(stdin)', opts) : smartJson(resolved, opts);
    case 'smart-tree':
      return smartTree(resolved, opts);
    default:
      return null;
  }
}

function detectProjectHint(resolved) {
  if (!resolved) return null;
  const dir = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
  return path.basename(dir);
}

const argv = process.argv.slice(2);
const { positional, flags } = parseCli(argv);

if (flags.help || flags.h) {
  usage();
  process.exit(0);
}
if (!positional.length) {
  usage();
  process.exit(0);
}

const command = positional[0];
if (command === 'metrics') {
  if (flags.clear) {
    clearMetrics();
    console.log('metrics log cleared.');
    process.exit(0);
  }
  const limit = flags.limit != null ? clampInt(flags.limit, 1, 50_000) : 500;
  console.log(formatDashboard(loadRecent(limit)));
  process.exit(0);
}

const useStdin = Boolean(flags.stdin);
let target = positional[1];
let resolved = null;
let inputText = null;
if (useStdin) {
  if (!flags.label) fail('with --stdin, --label is required (display name for metrics and output)');
  inputText = readStdinUtf8();
} else {
  if (!target) fail('missing path argument (or use --stdin with --label)');
  resolved = path.resolve(process.cwd(), target);
  if (!fs.existsSync(resolved)) fail(`path does not exist: ${target}`);
  if (command !== 'smart-tree' && fs.statSync(resolved).isDirectory()) fail(`expected a file for ${command}`);
  if (command === 'smart-tree' && !fs.statSync(resolved).isDirectory()) fail('smart-tree expects a directory');
}

const wantMetrics = Boolean(flags.metrics) || process.env.CONTEXT_OPTIMIZER_METRICS === '1';
const wantTokens = Boolean(flags.tokens);
const asJson = Boolean(flags.json);
const preset = normalizePresetName(flags.preset);
const startedAt = Date.now();

let result;
let success = false;
try {
  result = runCommand(command, resolved, flags, useStdin ? inputText : null);
  success = true;
} catch (e) {
  if (wantMetrics) {
    appendMetric({
      command,
      target: flags.label || target || '(stdin)',
      inputBytes: inputText != null ? Buffer.byteLength(inputText, 'utf8') : 0,
      outputChars: 0,
      inputTokensEst: inputText != null ? estimateTokensFromText(inputText) : 0,
      outputTokensEst: 0,
      ratio: null,
      stdin: useStdin,
      sourceType: useStdin ? 'stdin' : 'file',
      preset,
      budgetSummary: summarizeBudget(resolveBudget({}, { preset })),
      durationMs: Date.now() - startedAt,
      success: false,
      cwd: process.cwd(),
      projectHint: detectProjectHint(resolved),
      error: e.message || String(e),
    });
  }
  if (e instanceof SyntaxError && command === 'smart-json') fail(`invalid JSON: ${e.message}`);
  fail(e.message || String(e));
}
if (!result) fail(`unknown command: ${command}`);

let inputForEst = '';
if (inputText != null) inputForEst = inputText;
else if (command !== 'smart-tree') inputForEst = fs.readFileSync(resolved, 'utf8');

let outputStr;
if (asJson) {
  if (wantTokens) {
    if (command === 'smart-tree') {
      outputStr = `${JSON.stringify(result, null, 2)}\n`;
      const out = estimateTokensFromText(outputStr);
      result.estimatedTokens = { input: null, output: out, savedApprox: null, note: 'smart-tree has no single-file input; output estimate only' };
      outputStr = `${JSON.stringify(result, null, 2)}\n`;
    } else {
      const inn = estimateTokensFromText(inputForEst);
      result.estimatedTokens = { input: inn, output: 0, savedApprox: 0 };
      outputStr = `${JSON.stringify(result, null, 2)}\n`;
      const out = estimateTokensFromText(outputStr);
      result.estimatedTokens.output = out;
      result.estimatedTokens.savedApprox = Math.max(0, inn - out);
      outputStr = `${JSON.stringify(result, null, 2)}\n`;
    }
  } else outputStr = `${JSON.stringify(result, null, 2)}\n`;
} else {
  outputStr = `${formatOutput(result)}\n`;
  if (wantTokens) {
    if (command === 'smart-tree') {
      const out = estimateTokensFromText(outputStr);
      outputStr += `\nestimatedTokens: output≈${out}  (tree: no single-file input)\n`;
    } else {
      const inn = estimateTokensFromText(inputForEst);
      const out = estimateTokensFromText(outputStr);
      outputStr += `\nestimatedTokens: input≈${inn}  output≈${out}  saved≈${Math.max(0, inn - out)}\n`;
    }
  }
}

process.stdout.write(outputStr);

if (wantMetrics) {
  const metricInput = command === 'smart-tree' ? '' : inputForEst;
  const inputBytes = Buffer.byteLength(metricInput, 'utf8');
  const outputChars = Buffer.byteLength(outputStr, 'utf8');
  const inputTokensEst = estimateTokensFromText(metricInput);
  const outputTokensEst = estimateTokensFromText(outputStr);
  appendMetric({
    command,
    target: result.target,
    inputBytes,
    outputChars,
    inputTokensEst,
    outputTokensEst,
    ratio: inputBytes > 0 ? outputChars / inputBytes : null,
    stdin: useStdin,
    sourceType: useStdin ? 'stdin' : 'file',
    preset,
    budgetSummary: result.meta && result.meta.budgetSummary,
    durationMs: Date.now() - startedAt,
    success,
    cwd: process.cwd(),
    projectHint: detectProjectHint(resolved),
  });
}
