const fs = require('fs');
const path = require('path');
const {
  resolveBudget,
  DEFAULT_BUDGET,
  PRESET_BUDGETS,
  DEFAULT_PRESET,
  normalizePresetName,
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

function detectConfigSignals(text, displayTarget) {
  const name = String(displayTarget || '').toLowerCase();
  const signals = [];
  if (/package\.json$/.test(name)) signals.push('node-package-manifest');
  if (/(^|[./])dockerfile$/.test(name) || /docker-compose/.test(name)) signals.push('container-config');
  if (/\.(ya?ml)$/.test(name)) signals.push('yaml-config');
  if (/\.(env|ini|toml|conf|cfg)$/.test(name) || /(^|[./])\.env/.test(name)) signals.push('runtime-config');
  if (/\b(api[_-]?key|secret|token|password)\b/i.test(text)) signals.push('contains-sensitive-keywords');
  return signals;
}

function normalizeOpts(opts = {}) {
  const preset = normalizePresetName(opts.preset || (opts.cli || {}).preset);
  const budget = resolveBudget(opts.budget || {}, { ...(opts.cli || {}), preset });
  return { budget, displayTarget: opts.label, preset };
}

function withMeta(result, budget, preset) {
  return {
    ...result,
    meta: {
      preset,
      budgetSummary: summarizeBudget(budget),
    },
  };
}

function smartReadFromText(text, displayTarget, budget, preset) {
  const lines = text.split('\n');
  const summary = summarizeTextLines(lines, budget.maxPreviewLines);
  const markdownSignals = detectMarkdownSignals(text, lines);
  const configSignals = detectConfigSignals(text, displayTarget);
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
    duplicateHighlights: summary.duplicateGroups.slice(0, 5).map((item) => `${item.count}× ${truncate(item.line)}`),
    preview: summary.preview,
  }, budget, preset);
}

function smartRead(file, opts = {}) {
  const { budget, displayTarget, preset } = normalizeOpts(opts);
  const text = readText(file);
  const label = displayTarget || path.basename(file);
  return smartReadFromText(text, label, budget, preset);
}

function smartReadText(text, displayTarget, opts = {}) {
  const { budget, preset } = normalizeOpts(opts);
  return smartReadFromText(text, displayTarget || '(stdin)', budget, preset);
}

function smartLogFromText(text, displayTarget, budget, preset) {
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
  }, budget, preset);
}

function smartLog(file, opts = {}) {
  const { budget, displayTarget, preset } = normalizeOpts(opts);
  const text = readText(file);
  const label = displayTarget || path.basename(file);
  return smartLogFromText(text, label, budget, preset);
}

function smartLogText(text, displayTarget, opts = {}) {
  const { budget, preset } = normalizeOpts(opts);
  return smartLogFromText(text, displayTarget || '(stdin)', budget, preset);
}

function smartCsvFromText(text, displayTarget, budget, preset) {
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
  }, budget, preset);
}

function smartCsv(file, opts = {}) {
  const { budget, displayTarget, preset } = normalizeOpts(opts);
  const text = readText(file);
  const label = displayTarget || path.basename(file);
  return smartCsvFromText(text, label, budget, preset);
}

function smartCsvText(text, displayTarget, opts = {}) {
  const { budget, preset } = normalizeOpts(opts);
  return smartCsvFromText(text, displayTarget || '(stdin)', budget, preset);
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

function collectJsonAnomalies(value, currentPath, output, budget, state, depth) {
  state = state || { nodes: 0 };
  depth = depth || 0;
  if (output.length >= budget.maxPreviewLines || state.nodes >= budget.maxJsonNodes) return output;
  if (depth > budget.maxJsonWalkDepth) {
    output.push(`${currentPath}: max JSON walk depth reached`);
    return output;
  }
  state.nodes += 1;

  if (value === null) return output;
  if (Array.isArray(value)) {
    if (value.length === 0 && output.length < budget.maxPreviewLines) output.push(`${currentPath}: empty array`);
    for (let index = 0; index < value.length; index += 1) {
      if (output.length >= budget.maxPreviewLines || state.nodes >= budget.maxJsonNodes) break;
      collectJsonAnomalies(value[index], `${currentPath}[${index}]`, output, budget, state, depth + 1);
    }
    return output;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0 && output.length < budget.maxPreviewLines) output.push(`${currentPath}: empty object`);
    for (const key of deterministicSort(keys)) {
      if (output.length >= budget.maxPreviewLines || state.nodes >= budget.maxJsonNodes) break;
      const child = value[key];
      const p = `${currentPath}.${key}`;
      if (child === null && output.length < budget.maxPreviewLines) output.push(`${p}: null`);
      else if (typeof child === 'string' && child.length > 120 && output.length < budget.maxPreviewLines) output.push(`${p}: long string (${child.length})`);
      if (child !== null && typeof child === 'object') collectJsonAnomalies(child, p, output, budget, state, depth + 1);
    }
  }
  return output;
}

function collectJsonOperationalHints(value, currentPath, hints, budget, state, depth) {
  state = state || { nodes: 0 };
  depth = depth || 0;
  if (hints.length >= budget.maxPreviewLines || state.nodes >= budget.maxJsonNodes || depth > budget.maxJsonWalkDepth) {
    return hints;
  }
  state.nodes += 1;

  if (Array.isArray(value)) {
    if (value.length && value.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
      const keyUnion = new Set();
      value.forEach((item) => Object.keys(item).forEach((key) => keyUnion.add(key)));
      hints.push(`${currentPath}: array of objects, unionKeys=${deterministicSort(Array.from(keyUnion)).slice(0, 8).join(',')}`);
    }
    for (let index = 0; index < value.length; index += 1) {
      if (hints.length >= budget.maxPreviewLines) break;
      collectJsonOperationalHints(value[index], `${currentPath}[${index}]`, hints, budget, state, depth + 1);
    }
    return hints;
  }

  if (value && typeof value === 'object') {
    const keys = deterministicSort(Object.keys(value));
    const lowerKeys = keys.map((key) => key.toLowerCase());
    if (lowerKeys.includes('status')) hints.push(`${currentPath}: has status field`);
    if (lowerKeys.includes('error') || lowerKeys.includes('errors')) hints.push(`${currentPath}: has error field`);
    if (lowerKeys.includes('id')) hints.push(`${currentPath}: has id field`);
    for (const key of keys) {
      if (hints.length >= budget.maxPreviewLines) break;
      const child = value[key];
      if (Array.isArray(child) && child.length > 20) hints.push(`${currentPath}.${key}: large array (${child.length})`);
      collectJsonOperationalHints(child, `${currentPath}.${key}`, hints, budget, state, depth + 1);
    }
  }
  return hints;
}

function smartJsonFromText(text, displayTarget, budget, preset) {
  const json = JSON.parse(text);
  const rootType = Array.isArray(json) ? 'array' : typeof json;
  const topKeys = rootType === 'object' ? deterministicSort(Object.keys(json)) : [];
  const structState = { nodes: 0 };
  const structure = summarizeJsonValue(json, 0, budget, structState);
  const anomalies = collectJsonAnomalies(json, '$', [], budget, { nodes: 0 }, 0);
  const operationalHints = collectJsonOperationalHints(json, '$', [], budget, { nodes: 0 }, 0)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .slice(0, budget.maxPreviewLines);

  return withMeta({
    command: 'smart-json',
    target: displayTarget,
    stats: {
      rootType,
      bytes: Buffer.byteLength(text, 'utf8'),
      topLevelKeys: topKeys.length,
      structureNodesVisited: structState.nodes,
    },
    anomalyFirst: anomalies,
    operationalHints,
    structure,
    topKeys: topKeys.slice(0, budget.maxJsonItems),
  }, budget, preset);
}

function smartJson(file, opts = {}) {
  const { budget, displayTarget, preset } = normalizeOpts(opts);
  const text = readText(file);
  const label = displayTarget || path.basename(file);
  return smartJsonFromText(text, label, budget, preset);
}

function smartJsonText(text, displayTarget, opts = {}) {
  const { budget, preset } = normalizeOpts(opts);
  return smartJsonFromText(text, displayTarget || '(stdin)', budget, preset);
}

function detectProjectHints(names) {
  const lower = new Set(names.map((name) => String(name).toLowerCase()));
  const hints = [];
  if (lower.has('package.json')) hints.push('node/javascript project');
  if (lower.has('dockerfile') || lower.has('docker-compose.yml')) hints.push('containerized app');
  if (lower.has('.github')) hints.push('github automation present');
  if (lower.has('openclaw')) hints.push('openclaw integration folder present');
  if (lower.has('src') && lower.has('test')) hints.push('code + tests visible');
  return hints;
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
  const { budget, displayTarget, preset } = normalizeOpts(opts);
  const state = walkTree(dir, 0, { entries: [], projectHints: [] }, budget);
  const totalDirs = state.entries.filter((line) => line.trim().startsWith('dir ')).length;
  const totalFiles = state.entries.filter((line) => line.trim().startsWith('file ')).length;
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
    entries: state.entries,
  }, budget, preset);
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
};
