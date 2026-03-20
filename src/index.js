const fs = require('fs');
const path = require('path');
const {
  resolveBudget,
  DEFAULT_BUDGET,
  PRESET_BUDGETS,
  DEFAULT_PRESET,
  normalizePresetName,
  isKnownPreset,
  summarizeBudget,
} = require('./budget');
const { parseCsvText } = require('./csv-parse');

function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
}

function deterministicSort(values) {
  return values.slice().sort((a, b) => String(a).localeCompare(String(b)));
}

function truncate(value, max = 120) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function countDuplicates(lines) {
  const counts = new Map();
  for (const line of lines) counts.set(line, (counts.get(line) || 0) + 1);
  return counts;
}

function summarizeTextLines(lines, maxPreview) {
  const counts = countDuplicates(lines.filter(Boolean));
  const duplicateGroups = [];
  for (const [line, count] of counts.entries()) {
    if (count > 1) duplicateGroups.push({ line, count });
  }
  duplicateGroups.sort((a, b) => b.count - a.count || a.line.localeCompare(b.line));

  const uniqueOrdered = [];
  const seen = new Set();
  for (const line of lines) {
    if (!seen.has(line)) {
      uniqueOrdered.push(line);
      seen.add(line);
    }
  }

  return {
    totalLines: lines.length,
    blankLines: lines.filter((line) => !line.trim()).length,
    uniqueLines: seen.size,
    duplicateGroups,
    preview: uniqueOrdered.slice(0, maxPreview).map((line) => truncate(line)),
  };
}

function detectAnomalies(lines, max) {
  const anomalies = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (anomalies.length >= max) break;
    const line = lines[index];
    const normalized = line.toLowerCase();
    if (/(error|fatal|exception|traceback|panic)/.test(normalized)) {
      anomalies.push({ line: index + 1, kind: 'error', text: truncate(line) });
    } else if (/(warn|warning|deprecated|retry|timeout)/.test(normalized)) {
      anomalies.push({ line: index + 1, kind: 'warning', text: truncate(line) });
    } else if (/\b[45]\d\d\b/.test(normalized)) {
      anomalies.push({ line: index + 1, kind: 'status', text: truncate(line) });
    }
  }
  return anomalies;
}

function groupLogLines(lines, maxPatterns) {
  const buckets = new Map();
  for (const line of lines) {
    const key = line
      .replace(/\b\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}:\d{2}(?:\.\d+)?z?\b/gi, '<timestamp>')
      .replace(/\b\d+\b/g, '<n>')
      .replace(/0x[a-f0-9]+/gi, '<hex>');
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  return Array.from(buckets.entries())
    .map(([pattern, count]) => ({ pattern: truncate(pattern), count }))
    .sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern))
    .slice(0, maxPatterns);
}

function detectMarkdownSignals(text, lines) {
  const signals = [];
  const headings = lines.filter((line) => /^#{1,6}\s+/.test(line)).length;
  const bullets = lines.filter((line) => /^\s*[-*+]\s+/.test(line)).length;
  const fences = lines.filter((line) => /^```/.test(line)).length;
  if (headings) signals.push(`headings=${headings}`);
  if (bullets) signals.push(`bullets=${bullets}`);
  if (fences) signals.push(`codeFences=${Math.floor(fences / 2) || fences}`);
  if (/\[[^\]]+\]\([^\)]+\)/.test(text)) signals.push('links=yes');
  return signals;
}

function detectMarkdownSectionMap(lines, maxSections) {
  const cap = maxSections || 20;
  const sections = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m) {
      sections.push({
        line: i + 1,
        level: m[1].length,
        title: truncate(m[2].trim(), 80),
      });
      if (sections.length >= cap) break;
    }
  }
  return sections;
}

function detectTodoMarkers(lines) {
  const keys = ['TODO', 'FIXME', 'NOTE', 'HACK'];
  const counts = { TODO: 0, FIXME: 0, NOTE: 0, HACK: 0 };
  for (const line of lines) {
    for (const k of keys) {
      if (new RegExp(`\\b${k}\\b`, 'i').test(line)) counts[k] += 1;
    }
  }
  const parts = keys.filter((k) => counts[k] > 0).map((k) => `${k}=${counts[k]}`);
  return parts.length ? parts.join(', ') : null;
}

function lineLooksLikeSecretAssignment(line) {
  const t = line.trim();
  if (!t || t.startsWith('#')) return false;
  if (/^\s*["']?(?:api[_-]?key|client_secret|access_token|refresh_token|auth_?token|private_key)["']?\s*:/i.test(line)) {
    return true;
  }
  if (
    /^\s*(?:export\s+)?[A-Z0-9_]*(?:API|SECRET|TOKEN|PASSWORD|AUTH|KEY)[A-Z0-9_]*\s*=/i.test(t) &&
    /(?:API|SECRET|TOKEN|PASSWORD|AUTH|KEY)/i.test(t)
  ) {
    return true;
  }
  return false;
}

function detectConfigSignals(text, displayTarget) {
  const name = String(displayTarget || '').toLowerCase();
  const signals = [];
  if (/package\.json$/.test(name)) signals.push('node-package-manifest');
  if (/(^|[./])dockerfile$/.test(name) || /docker-compose/.test(name)) signals.push('container-config');
  if (/\.(ya?ml)$/.test(name)) signals.push('yaml-config');
  if (/\.(env|ini|toml|conf|cfg)$/.test(name) || /(^|[./])\.env/.test(name)) signals.push('runtime-config');
  const lines = text.split('\n');
  if (lines.some((line) => lineLooksLikeSecretAssignment(line))) signals.push('likely-secret-assignment');
  return signals;
}

function normalizeOpts(opts = {}) {
  const rawFromOpts = opts.preset != null ? String(opts.preset).trim() : null;
  const rawFromCli = opts.cli && opts.cli.preset != null ? String(opts.cli.preset).trim() : null;
  const effectiveRaw = rawFromOpts != null && rawFromOpts !== '' ? rawFromOpts : rawFromCli;
  const presetApplied = normalizePresetName(effectiveRaw);
  const presetRequested = effectiveRaw != null && effectiveRaw !== '' ? effectiveRaw : presetApplied;
  const presetCoerced = effectiveRaw != null && effectiveRaw !== '' && !isKnownPreset(effectiveRaw);
  const budget = resolveBudget(opts.budget || {}, { ...(opts.cli || {}), preset: presetApplied });
  return { budget, displayTarget: opts.label, presetApplied, presetRequested, presetCoerced };
}

function withMeta(result, budget, presetMeta) {
  const { presetApplied, presetRequested, presetCoerced } = presetMeta;
  return {
    ...result,
    meta: {
      preset: presetApplied,
      presetRequested,
      presetCoerced,
      budgetSummary: summarizeBudget(budget),
    },
  };
}

function smartReadFromText(text, displayTarget, budget, presetMeta) {
  const lines = text.split('\n');
  const summary = summarizeTextLines(lines, budget.maxPreviewLines);
  const markdownSignals = detectMarkdownSignals(text, lines);
  const configSignals = detectConfigSignals(text, displayTarget);
  const markdownSections = detectMarkdownSectionMap(lines, budget.maxPreviewLines);
  const todoSummary = detectTodoMarkers(lines);
  const readNextHints = [];
  if (markdownSections.length) {
    const first = markdownSections[0];
    readNextHints.push(`start near heading L${first.line} (h${first.level}): ${first.title}`);
  }
  if (todoSummary) readNextHints.push(`scan lines with: ${todoSummary}`);
  if (configSignals.some((s) => s.includes('yaml') || s.includes('runtime-config'))) {
    readNextHints.push('config/env: use raw read for exact keys after this triage');
  }
  return withMeta({
    command: 'smart-read',
    target: displayTarget,
    stats: {
      bytes: Buffer.byteLength(text, 'utf8'),
      totalLines: summary.totalLines,
      uniqueLines: summary.uniqueLines,
      blankLines: summary.blankLines,
      duplicateLineGroups: summary.duplicateGroups.length,
    },
    anomalyFirst: detectAnomalies(lines, budget.maxPreviewLines),
    fileHints: [...markdownSignals, ...configSignals],
    markdownSections,
    todoSummary,
    readNextHints,
    duplicateHighlights: summary.duplicateGroups.slice(0, 5).map((item) => `${item.count}× ${truncate(item.line)}`),
    preview: summary.preview,
  }, budget, presetMeta);
}

function smartRead(file, opts = {}) {
  const { budget, displayTarget, presetApplied, presetRequested, presetCoerced } = normalizeOpts(opts);
  const text = readText(file);
  const label = displayTarget || path.basename(file);
  const presetMeta = { presetApplied, presetRequested, presetCoerced };
  return smartReadFromText(text, label, budget, presetMeta);
}

function smartReadText(text, displayTarget, opts = {}) {
  const { budget, presetApplied, presetRequested, presetCoerced } = normalizeOpts(opts);
  const presetMeta = { presetApplied, presetRequested, presetCoerced };
  return smartReadFromText(text, displayTarget || '(stdin)', budget, presetMeta);
}

function smartLogFromText(text, displayTarget, budget, presetMeta) {
  const allLines = text.split('\n');
  const contentLines = allLines.filter((l) => l.trim().length > 0);
  const levels = { error: 0, warning: 0, info: 0, debug: 0 };
  contentLines.forEach((line) => {
    const lower = line.toLowerCase();
    if (/(error|fatal|exception|panic)/.test(lower)) levels.error += 1;
    else if (/(warn|warning|deprecated|timeout|retry)/.test(lower)) levels.warning += 1;
    else if (/(debug|trace)/.test(lower)) levels.debug += 1;
    else levels.info += 1;
  });

  const patterns = groupLogLines(contentLines, budget.maxPreviewLines);
  const anomalies = detectAnomalies(allLines, budget.maxPreviewLines);
  const firstAnomaly = anomalies[0] ? `first ${anomalies[0].kind} @ line ${anomalies[0].line}` : null;
  const lastAnomaly = anomalies.length ? `last ${anomalies[anomalies.length - 1].kind} @ line ${anomalies[anomalies.length - 1].line}` : null;

  return withMeta({
    command: 'smart-log',
    target: displayTarget,
    stats: {
      lines: contentLines.length,
      levels,
      distinctPatterns: patterns.length,
    },
    anomalyFirst: anomalies,
    anomalySummary: [firstAnomaly, lastAnomaly].filter(Boolean),
    groupedPatterns: patterns,
    tailPreview: allLines
      .slice(-budget.maxPreviewLines)
      .map((line) => (line.trim() === '' ? '(blank line)' : truncate(line))),
  }, budget, presetMeta);
}

function smartLog(file, opts = {}) {
  const { budget, displayTarget, presetApplied, presetRequested, presetCoerced } = normalizeOpts(opts);
  const text = readText(file);
  const label = displayTarget || path.basename(file);
  const presetMeta = { presetApplied, presetRequested, presetCoerced };
  return smartLogFromText(text, label, budget, presetMeta);
}

function smartLogText(text, displayTarget, opts = {}) {
  const { budget, presetApplied, presetRequested, presetCoerced } = normalizeOpts(opts);
  const presetMeta = { presetApplied, presetRequested, presetCoerced };
  return smartLogFromText(text, displayTarget || '(stdin)', budget, presetMeta);
}

function smartCsvFromText(text, displayTarget, budget, presetMeta) {
  const rows = parseCsvText(text);
  const header = rows[0] || [];
  const body = rows.slice(1);
  const maxRows = budget.maxCsvRows;
  const columnStats = header.map((name, index) => {
    const values = body.map((row) => row[index] || '');
    const unique = new Set(values.filter(Boolean));
    const empties = values.filter((value) => !value).length;
    const numeric = values.filter((value) => /^-?\d+(\.\d+)?$/.test(value)).map(Number);
    const summary = [`unique=${unique.size}`, `empty=${empties}`];
    if (numeric.length) {
      const min = Math.min(...numeric);
      const max = Math.max(...numeric);
      summary.push(`range=${min}..${max}`);
    }
    return `${name || `column_${index + 1}`}: ${summary.join(', ')}`;
  });

  const anomalies = [];
  body.forEach((row, index) => {
    if (row.length !== header.length) {
      anomalies.push(`row ${index + 2}: expected ${header.length} cells, got ${row.length}`);
    }
  });

  return withMeta({
    command: 'smart-csv',
    target: displayTarget,
    stats: {
      rows: body.length,
      columns: header.length,
    },
    anomalyFirst: anomalies.slice(0, budget.maxPreviewLines),
    columnSummary: columnStats,
    sampleRows: body.slice(0, maxRows).map((row, index) => `row ${index + 2}: ${truncate(row.join(' | '))}`),
  }, budget, presetMeta);
}

function smartCsv(file, opts = {}) {
  const { budget, displayTarget, presetApplied, presetRequested, presetCoerced } = normalizeOpts(opts);
  const text = readText(file);
  const label = displayTarget || path.basename(file);
  const presetMeta = { presetApplied, presetRequested, presetCoerced };
  return smartCsvFromText(text, label, budget, presetMeta);
}

function smartCsvText(text, displayTarget, opts = {}) {
  const { budget, presetApplied, presetRequested, presetCoerced } = normalizeOpts(opts);
  const presetMeta = { presetApplied, presetRequested, presetCoerced };
  return smartCsvFromText(text, displayTarget || '(stdin)', budget, presetMeta);
}

function summarizeJsonValue(value, depth, budget, state) {
  state = state || { nodes: 0 };
  if (state.nodes >= budget.maxJsonNodes) return '…';
  if (depth > budget.maxJsonWalkDepth) return '…';
  state.nodes += 1;

  if (value === null) return 'null';
  if (Array.isArray(value)) {
    const cap = Math.max(0, budget.maxJsonItems - depth);
    const sample = [];
    for (let i = 0; i < value.length && sample.length < cap; i += 1) {
      if (state.nodes >= budget.maxJsonNodes) break;
      sample.push(summarizeJsonValue(value[i], depth + 1, budget, state));
    }
    const more = value.length > sample.length ? ', …' : '';
    return `array(len=${value.length}) [${sample.join(', ')}${more}]`;
  }
  if (typeof value === 'object') {
    const keys = deterministicSort(Object.keys(value));
    const cap = Math.max(0, budget.maxJsonItems - depth);
    const sample = [];
    for (let i = 0; i < keys.length && sample.length < cap; i += 1) {
      if (state.nodes >= budget.maxJsonNodes) break;
      const key = keys[i];
      sample.push(`${key}: ${summarizeJsonValue(value[key], depth + 1, budget, state)}`);
    }
    const more = keys.length > sample.length ? ', …' : '';
    return `object(keys=${keys.length}) {${sample.join(', ')}${more}}`;
  }
  return JSON.stringify(value);
}

const MAX_JSON_ARRAY_INDEX_VISITS = 48;
const MAX_JSON_OBJECT_ARRAY_DEEP_SAMPLES = 4;

/**
 * Single pass for anomalies + operational hints after structure sketch.
 * Shares `state.nodes` with summarizeJsonValue so total work stays within maxJsonNodes.
 */
function collectJsonIssues(value, currentPath, budget, state, depth, anomalies, hints, seenHints) {
  seenHints = seenHints || new Set();
  depth = depth || 0;
  if (state.nodes >= budget.maxJsonNodes) return;
  if (depth > budget.maxJsonWalkDepth) {
    if (anomalies.length < budget.maxPreviewLines) anomalies.push(`${currentPath}: max JSON walk depth reached`);
    return;
  }

  state.nodes += 1;

  if (value === null) return;

  if (Array.isArray(value)) {
    if (value.length === 0 && anomalies.length < budget.maxPreviewLines) anomalies.push(`${currentPath}: empty array`);

    const isObjectArray =
      value.length > 0 && value.every((item) => item && typeof item === 'object' && !Array.isArray(item));
    if (isObjectArray && hints.length < budget.maxPreviewLines) {
      const sample = value.slice(0, Math.min(24, value.length));
      const keyUnion = new Set();
      sample.forEach((item) => Object.keys(item).forEach((k) => keyUnion.add(k)));
      const hintStr = `${currentPath}: array of objects (len=${value.length}), unionKeys(sample)=${deterministicSort(Array.from(keyUnion)).slice(0, 12).join(',')}`;
      if (!seenHints.has(hintStr)) {
        seenHints.add(hintStr);
        hints.push(hintStr);
      }
      const freq = new Map();
      sample.forEach((item) => {
        Object.keys(item).forEach((k) => freq.set(k, (freq.get(k) || 0) + 1));
      });
      const topFreq = Array.from(freq.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8)
        .map(([k, c]) => `${k}×${c}`)
        .join(',');
      const kf = `${currentPath}: keyFrequency(sample)=${topFreq}`;
      if (!seenHints.has(kf)) {
        seenHints.add(kf);
        hints.push(kf);
      }
    }

    const limit = Math.min(value.length, MAX_JSON_ARRAY_INDEX_VISITS);
    for (let index = 0; index < limit; index += 1) {
      if (anomalies.length >= budget.maxPreviewLines || state.nodes >= budget.maxJsonNodes) break;
      if (isObjectArray && index >= MAX_JSON_OBJECT_ARRAY_DEEP_SAMPLES) break;
      collectJsonIssues(value[index], `${currentPath}[${index}]`, budget, state, depth + 1, anomalies, hints, seenHints);
    }
    return;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0 && anomalies.length < budget.maxPreviewLines) anomalies.push(`${currentPath}: empty object`);

    const sorted = deterministicSort(keys);
    const lowerKeys = sorted.map((k) => k.toLowerCase());

    function pushHintOnce(s) {
      if (hints.length >= budget.maxPreviewLines || seenHints.has(s)) return;
      seenHints.add(s);
      hints.push(s);
    }

    if (lowerKeys.includes('status')) pushHintOnce(`${currentPath}: has status field`);
    if (lowerKeys.includes('error') || lowerKeys.includes('errors')) pushHintOnce(`${currentPath}: has error field`);
    if (lowerKeys.includes('id')) pushHintOnce(`${currentPath}: has id field`);
    if (lowerKeys.some((k) => /^(timestamp|createdat|updatedat|deletedat)$/i.test(k))) {
      pushHintOnce(`${currentPath}: has time-like fields`);
    }
    if (lowerKeys.some((k) => /^(version|apiversion|schemaversion)$/i.test(k))) {
      pushHintOnce(`${currentPath}: has version-like fields`);
    }

    for (const key of sorted) {
      if (anomalies.length >= budget.maxPreviewLines && hints.length >= budget.maxPreviewLines) break;
      if (state.nodes >= budget.maxJsonNodes) break;
      const child = value[key];
      const p = `${currentPath}.${key}`;
      if (child === null && anomalies.length < budget.maxPreviewLines) anomalies.push(`${p}: null`);
      else if (typeof child === 'string' && child.length > 120 && anomalies.length < budget.maxPreviewLines) {
        anomalies.push(`${p}: long string (${child.length})`);
      }
      if (Array.isArray(child) && child.length > 20) {
        pushHintOnce(`${p}: large array (${child.length})`);
      }
      if (child !== null && typeof child === 'object') {
        collectJsonIssues(child, p, budget, state, depth + 1, anomalies, hints, seenHints);
      }
    }
  }
}

function smartJsonFromText(text, displayTarget, budget, presetMeta) {
  const json = JSON.parse(text);
  const rootType = Array.isArray(json) ? 'array' : typeof json;
  const topKeys = rootType === 'object' ? deterministicSort(Object.keys(json)) : [];
  const structState = { nodes: 0 };
  const structure = summarizeJsonValue(json, 0, budget, structState);
  const anomalies = [];
  const hints = [];
  const issueState = { nodes: 0 };
  collectJsonIssues(json, '$', budget, issueState, 0, anomalies, hints, new Set());
  const operationalHints = hints.slice(0, budget.maxPreviewLines);

  return withMeta({
    command: 'smart-json',
    target: displayTarget,
    stats: {
      rootType,
      bytes: Buffer.byteLength(text, 'utf8'),
      topLevelKeys: topKeys.length,
      structureNodesVisited: structState.nodes,
      issueNodesVisited: issueState.nodes,
    },
    anomalyFirst: anomalies.slice(0, budget.maxPreviewLines),
    operationalHints,
    structure,
    topKeys: topKeys.slice(0, budget.maxJsonItems),
  }, budget, presetMeta);
}

function smartJson(file, opts = {}) {
  const { budget, displayTarget, presetApplied, presetRequested, presetCoerced } = normalizeOpts(opts);
  const text = readText(file);
  const label = displayTarget || path.basename(file);
  const presetMeta = { presetApplied, presetRequested, presetCoerced };
  return smartJsonFromText(text, label, budget, presetMeta);
}

function smartJsonText(text, displayTarget, opts = {}) {
  const { budget, presetApplied, presetRequested, presetCoerced } = normalizeOpts(opts);
  const presetMeta = { presetApplied, presetRequested, presetCoerced };
  return smartJsonFromText(text, displayTarget || '(stdin)', budget, presetMeta);
}

function detectProjectHints(names) {
  const lower = new Set(names.map((name) => String(name).toLowerCase()));
  const hints = [];
  if (lower.has('package.json')) hints.push('node/javascript project');
  if (lower.has('dockerfile') || lower.has('docker-compose.yml') || lower.has('docker-compose.yaml')) {
    hints.push('containerized app');
  }
  if (lower.has('.github')) hints.push('github automation present');
  if (lower.has('openclaw')) hints.push('openclaw integration folder present');
  if (lower.has('openclaw.json')) hints.push('openclaw config at repo root');
  if (lower.has('src') && (lower.has('test') || lower.has('tests'))) hints.push('code + tests visible');
  if (lower.has('packages') || lower.has('apps')) hints.push('possible monorepo layout');
  if (lower.has('cargo.toml')) hints.push('rust project');
  if (lower.has('go.mod')) hints.push('go module');
  if (lower.has('pyproject.toml') || lower.has('setup.py')) hints.push('python project');
  return hints;
}

const TREE_TRIAGE_SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  'coverage',
  '__pycache__',
  'vendor',
]);

function mtimeDayUtc(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Bounded depth-0/1 file scan for agent triage (deterministic ordering). */
function collectTreeTriage(rootDir, budget) {
  const root = path.resolve(rootDir);
  const maxStats = Math.min(200, Math.max(48, budget.maxTreeEntries * 5));
  const acc = [];
  let statsUsed = 0;

  function touch(relPath, fullPath) {
    if (statsUsed >= maxStats) return;
    try {
      const st = fs.statSync(fullPath);
      statsUsed += 1;
      if (st.isFile()) {
        acc.push({
          path: relPath.replace(/\\/g, '/'),
          mtimeMs: st.mtimeMs,
          sizeBytes: st.size,
        });
      }
    } catch {
      /* ignore */
    }
  }

  let rootNames = [];
  try {
    rootNames = deterministicSort(fs.readdirSync(root));
  } catch {
    return {
      readNext: [],
      readNextPaths: [],
      recentlyTouched: [],
      likelyBuildDeploy: [],
      likelyTestSignals: [],
      likelyDocs: [],
      stackSignals: [],
      monorepoHint: null,
      whyThisMatters: [],
    };
  }

  const lower = new Set(rootNames.map((n) => n.toLowerCase()));

  function actualName(wantedLower) {
    return rootNames.find((n) => n.toLowerCase() === wantedLower);
  }

  const readNextSeen = new Set();
  const readNext = [];
  const ORDERED_READ_RULES = [
    { names: ['README.md', 'README.rst', 'README.txt'], reason: 'project overview / how to run' },
    { names: ['AGENTS.md'], reason: 'agent-specific instructions' },
    { names: ['CONTRIBUTING.md'], reason: 'contribution / dev workflow' },
    { names: ['package.json'], reason: 'npm scripts, dependencies, metadata' },
    { names: ['Cargo.toml'], reason: 'Rust manifest' },
    { names: ['go.mod'], reason: 'Go module' },
    { names: ['pyproject.toml'], reason: 'Python project (PEP 621)' },
    { names: ['setup.py', 'requirements.txt'], reason: 'Python legacy / deps list' },
    { names: ['composer.json'], reason: 'PHP dependencies' },
    { names: ['Makefile'], reason: 'build targets' },
    { names: ['Dockerfile'], reason: 'container image build' },
    { names: ['docker-compose.yml', 'docker-compose.yaml'], reason: 'multi-service stack' },
    { names: ['openclaw.json'], reason: 'OpenClaw configuration' },
  ];
  for (const rule of ORDERED_READ_RULES) {
    for (const nm of rule.names) {
      const got = actualName(nm.toLowerCase());
      if (got && !readNextSeen.has(got.toLowerCase())) {
        readNext.push({ path: got, reason: rule.reason });
        readNextSeen.add(got.toLowerCase());
      }
    }
  }

  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const raw = fs.readFileSync(pkgPath, 'utf8').slice(0, 65536);
      const pkg = JSON.parse(raw);
      const main = typeof pkg.main === 'string' ? pkg.main.replace(/^\.\//, '') : null;
      if (main) {
        const tries = [main, path.join('src', main), path.join('lib', main), path.join('src', path.basename(main))];
        const seenTry = new Set();
        for (const t of tries) {
          const normKey = t.replace(/\\/g, '/').toLowerCase();
          if (seenTry.has(normKey)) continue;
          seenTry.add(normKey);
          const full = path.join(root, t);
          if (fs.existsSync(full) && fs.statSync(full).isFile()) {
            const norm = t.replace(/\\/g, '/');
            const key = norm.toLowerCase();
            if (!readNextSeen.has(key)) {
              readNext.push({ path: norm, reason: 'runtime entry from package.json main' });
              readNextSeen.add(key);
            }
            break;
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  const likelyDocs = readNext.filter((r) => /^readme/i.test(r.path) || r.path === 'AGENTS.md').map((r) => r.path);

  let monorepoHint = null;
  if (rootNames.includes('packages') || rootNames.includes('apps')) {
    monorepoHint = 'Monorepo-style top-level packages/ or apps/ — drill into leaf packages after root scan.';
  }

  const stackSignals = [];
  if (lower.has('package.json')) stackSignals.push('stack: Node/npm');
  if (lower.has('cargo.toml')) stackSignals.push('stack: Rust');
  if (lower.has('go.mod')) stackSignals.push('stack: Go');
  if (lower.has('pyproject.toml') || lower.has('requirements.txt')) stackSignals.push('stack: Python');
  if (lower.has('gemfile')) stackSignals.push('stack: Ruby');
  if (likelyDocs.length >= 2 && !lower.has('package.json') && !lower.has('cargo.toml')) {
    stackSignals.push('profile: docs-heavy');
  }

  for (const name of rootNames) {
    if (statsUsed >= maxStats) break;
    if (TREE_TRIAGE_SKIP.has(name)) continue;
    touch(name, path.join(root, name));
  }

  for (const name of rootNames) {
    if (statsUsed >= maxStats) break;
    if (TREE_TRIAGE_SKIP.has(name)) continue;
    const full = path.join(root, name);
    let isDir = false;
    try {
      isDir = fs.statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    let sub = [];
    try {
      sub = deterministicSort(fs.readdirSync(full));
    } catch {
      continue;
    }
    for (const sn of sub) {
      if (statsUsed >= maxStats) break;
      if (TREE_TRIAGE_SKIP.has(sn)) continue;
      touch(`${name}/${sn}`, path.join(full, sn));
    }
  }

  acc.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
  const recentlyTouched = acc.slice(0, 12).map((f) => ({
    path: f.path,
    sizeBytes: f.sizeBytes,
    modified: mtimeDayUtc(f.mtimeMs),
  }));

  const likelyTestSignals = [];
  if (rootNames.some((n) => /^tests?$/i.test(n))) likelyTestSignals.push('tests/ or test/ at repo root');
  if (rootNames.includes('__tests__')) likelyTestSignals.push('__tests__/ at repo root');
  if (rootNames.some((n) => /^spec$/i.test(n))) likelyTestSignals.push('spec/ at repo root');

  const likelyBuildDeploy = [];
  for (const n of rootNames) {
    const low = n.toLowerCase();
    if (low === 'dockerfile' || low.startsWith('docker-compose')) likelyBuildDeploy.push(n);
    if (/^vite\.config\.|^webpack\.|^rollup\.config\.|^esbuild\.config\./i.test(n)) likelyBuildDeploy.push(n);
    if (low === 'tsconfig.json' || low === 'makefile' || /\.gradle$/i.test(n)) likelyBuildDeploy.push(n);
  }
  if (likelyBuildDeploy.length >= 4) stackSignals.push('profile: infra/build-heavy');
  if (lower.has('openclaw') || lower.has('openclaw.json')) stackSignals.push('profile: OpenClaw-adjacent');

  const whyThisMatters = [];
  if (readNext.length) {
    whyThisMatters.push(`Prioritized ${Math.min(readNext.length, 7)} root-level files to inspect before random reads.`);
  }
  if (acc.length) whyThisMatters.push('Shallow recently-touched files hint where work is active.');
  if (monorepoHint) whyThisMatters.push(monorepoHint);

  const readNextCapped = readNext.slice(0, 14);
  const readNextPaths = readNextCapped.map((r) => r.path);

  return {
    readNext: readNextCapped,
    readNextPaths,
    recentlyTouched,
    likelyBuildDeploy: deterministicSort([...new Set(likelyBuildDeploy)]).slice(0, 10),
    likelyTestSignals,
    likelyDocs: deterministicSort(likelyDocs),
    stackSignals: deterministicSort(stackSignals),
    monorepoHint,
    whyThisMatters,
  };
}

function walkTree(dir, depth, state, budget) {
  if (depth > budget.maxTreeDepth || state.entries.length >= budget.maxTreeEntries) return state;
  const names = deterministicSort(fs.readdirSync(dir));
  if (depth === 0) state.projectHints = detectProjectHints(names);
  for (const name of names) {
    if (state.entries.length >= budget.maxTreeEntries) break;
    const fullPath = path.join(dir, name);
    const stat = fs.statSync(fullPath);
    const relDepth = '  '.repeat(depth);
    state.entries.push(`${relDepth}${stat.isDirectory() ? 'dir ' : 'file'} ${name}`);
    if (stat.isDirectory()) walkTree(fullPath, depth + 1, state, budget);
  }
  return state;
}

function smartTree(dir, opts = {}) {
  const { budget, displayTarget, presetApplied, presetRequested, presetCoerced } = normalizeOpts(opts);
  const state = walkTree(dir, 0, { entries: [], projectHints: [] }, budget);
  const triageHints = collectTreeTriage(dir, budget);
  const totalDirs = state.entries.filter((line) => line.trim().startsWith('dir ')).length;
  const totalFiles = state.entries.filter((line) => line.trim().startsWith('file ')).length;
  const presetMeta = { presetApplied, presetRequested, presetCoerced };
  return withMeta({
    command: 'smart-tree',
    target: displayTarget || path.basename(dir),
    stats: {
      listedEntries: state.entries.length,
      directories: totalDirs,
      files: totalFiles,
      maxDepth: budget.maxTreeDepth,
    },
    anomalyFirst: state.entries.length >= budget.maxTreeEntries ? ['tree truncated to deterministic entry budget'] : [],
    projectHints: state.projectHints,
    triageHints,
    entries: state.entries,
  }, budget, presetMeta);
}

function formatValue(value, indent = 0) {
  const prefix = '  '.repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return `${prefix}[]`;
    return value.map((item) => {
      if (typeof item === 'string') return `${prefix}- ${item}`;
      if (item && typeof item === 'object' && !Array.isArray(item) && item.line != null && item.kind != null) {
        return `${prefix}- line ${item.line} (${item.kind}): ${item.text}`;
      }
      if (item && typeof item === 'object' && !Array.isArray(item) && item.path != null && item.reason != null) {
        return `${prefix}- ${item.path} — ${item.reason}`;
      }
      return `${prefix}-\n${formatValue(item, indent + 1)}`;
    }).join('\n');
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([key, item]) => {
      if (Array.isArray(item)) return `${prefix}${key}:\n${formatValue(item, indent + 1)}`;
      if (item && typeof item === 'object') return `${prefix}${key}:\n${formatValue(item, indent + 1)}`;
      return `${prefix}${key}: ${item}`;
    }).join('\n');
  }
  return `${prefix}${String(value)}`;
}

function formatOutput(result) {
  return formatValue(result);
}

module.exports = {
  DEFAULT_BUDGET,
  DEFAULT_PRESET,
  PRESET_BUDGETS,
  resolveBudget,
  isKnownPreset,
  normalizePresetName,
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
  ...require('./policy'),
};
