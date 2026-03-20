const fs = require('fs');
const path = require('path');

const MAX_PREVIEW_LINES = 12;
const MAX_TREE_DEPTH = 3;
const MAX_TREE_ENTRIES = 40;
const MAX_JSON_ITEMS = 8;
const MAX_CSV_ROWS = 8;

function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
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

function summarizeTextLines(lines) {
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
    preview: uniqueOrdered.slice(0, MAX_PREVIEW_LINES).map((line) => truncate(line)),
  };
}

function detectAnomalies(lines) {
  const anomalies = [];
  lines.forEach((line, index) => {
    const normalized = line.toLowerCase();
    if (/(error|fatal|exception|traceback|panic)/.test(normalized)) {
      anomalies.push({ line: index + 1, kind: 'error', text: truncate(line) });
    } else if (/(warn|warning|deprecated|retry|timeout)/.test(normalized)) {
      anomalies.push({ line: index + 1, kind: 'warning', text: truncate(line) });
    } else if (/\b[45]\d\d\b/.test(normalized)) {
      anomalies.push({ line: index + 1, kind: 'status', text: truncate(line) });
    }
  });
  return anomalies.slice(0, MAX_PREVIEW_LINES);
}

function groupLogLines(lines) {
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
    .slice(0, MAX_PREVIEW_LINES);
}

function smartRead(file) {
  const text = readText(file);
  const lines = text.split('\n');
  const summary = summarizeTextLines(lines);
  return {
    command: 'smart-read',
    target: path.basename(file),
    stats: {
      bytes: Buffer.byteLength(text, 'utf8'),
      totalLines: summary.totalLines,
      uniqueLines: summary.uniqueLines,
      blankLines: summary.blankLines,
      duplicateLineGroups: summary.duplicateGroups.length,
    },
    anomalyFirst: detectAnomalies(lines),
    duplicateHighlights: summary.duplicateGroups.slice(0, 5).map((item) => `${item.count}× ${truncate(item.line)}`),
    preview: summary.preview,
  };
}

function smartLog(file) {
  const text = readText(file);
  const lines = text.split('\n').filter(Boolean);
  const levels = { error: 0, warning: 0, info: 0, debug: 0 };
  lines.forEach((line) => {
    const lower = line.toLowerCase();
    if (/(error|fatal|exception|panic)/.test(lower)) levels.error += 1;
    else if (/(warn|warning|deprecated|timeout|retry)/.test(lower)) levels.warning += 1;
    else if (/(debug|trace)/.test(lower)) levels.debug += 1;
    else levels.info += 1;
  });

  return {
    command: 'smart-log',
    target: path.basename(file),
    stats: {
      lines: lines.length,
      levels,
      distinctPatterns: groupLogLines(lines).length,
    },
    anomalyFirst: detectAnomalies(lines),
    groupedPatterns: groupLogLines(lines),
    tailPreview: lines.slice(-MAX_PREVIEW_LINES).map((line) => truncate(line)),
  };
}

function parseCsv(text) {
  const lines = text.split('\n').filter(Boolean);
  return lines.map((line) => line.split(',').map((cell) => cell.trim()));
}

function smartCsv(file) {
  const text = readText(file);
  const rows = parseCsv(text);
  const header = rows[0] || [];
  const body = rows.slice(1);
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

  return {
    command: 'smart-csv',
    target: path.basename(file),
    stats: {
      rows: body.length,
      columns: header.length,
    },
    anomalyFirst: anomalies.slice(0, MAX_PREVIEW_LINES),
    columnSummary: columnStats,
    sampleRows: body.slice(0, MAX_CSV_ROWS).map((row, index) => `row ${index + 2}: ${truncate(row.join(' | '))}`),
  };
}

function summarizeJsonValue(value, depth = 0) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    const sample = value.slice(0, Math.max(0, MAX_JSON_ITEMS - depth)).map((item) => summarizeJsonValue(item, depth + 1));
    return `array(len=${value.length}) [${sample.join(', ')}${value.length > sample.length ? ', …' : ''}]`;
  }
  if (typeof value === 'object') {
    const keys = deterministicSort(Object.keys(value));
    const sample = keys.slice(0, Math.max(0, MAX_JSON_ITEMS - depth)).map((key) => `${key}: ${summarizeJsonValue(value[key], depth + 1)}`);
    return `object(keys=${keys.length}) {${sample.join(', ')}${keys.length > sample.length ? ', …' : ''}}`;
  }
  return JSON.stringify(value);
}

function collectJsonAnomalies(value, currentPath = '$', output = []) {
  if (value === null || output.length >= MAX_PREVIEW_LINES) return output;
  if (Array.isArray(value)) {
    if (value.length === 0) output.push(`${currentPath}: empty array`);
    value.forEach((item, index) => collectJsonAnomalies(item, `${currentPath}[${index}]`, output));
    return output;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) output.push(`${currentPath}: empty object`);
    deterministicSort(keys).forEach((key) => {
      const child = value[key];
      if (child === null) output.push(`${currentPath}.${key}: null`);
      else if (typeof child === 'string' && child.length > 120) output.push(`${currentPath}.${key}: long string (${child.length})`);
      collectJsonAnomalies(child, `${currentPath}.${key}`, output);
    });
  }
  return output;
}

function smartJson(file) {
  const text = readText(file);
  const json = JSON.parse(text);
  const rootType = Array.isArray(json) ? 'array' : typeof json;
  const topKeys = rootType === 'object' ? deterministicSort(Object.keys(json)) : [];
  return {
    command: 'smart-json',
    target: path.basename(file),
    stats: {
      rootType,
      bytes: Buffer.byteLength(text, 'utf8'),
      topLevelKeys: topKeys.length,
    },
    anomalyFirst: collectJsonAnomalies(json),
    structure: summarizeJsonValue(json),
    topKeys: topKeys.slice(0, MAX_JSON_ITEMS),
  };
}

function walkTree(dir, depth = 0, state = { entries: [] }) {
  if (depth > MAX_TREE_DEPTH || state.entries.length >= MAX_TREE_ENTRIES) return state;
  const names = deterministicSort(fs.readdirSync(dir));
  for (const name of names) {
    if (state.entries.length >= MAX_TREE_ENTRIES) break;
    const fullPath = path.join(dir, name);
    const stat = fs.statSync(fullPath);
    const relDepth = '  '.repeat(depth);
    state.entries.push(`${relDepth}${stat.isDirectory() ? 'dir ' : 'file'} ${name}`);
    if (stat.isDirectory()) walkTree(fullPath, depth + 1, state);
  }
  return state;
}

function smartTree(dir) {
  const state = walkTree(dir);
  const totalDirs = state.entries.filter((line) => line.trim().startsWith('dir ')).length;
  const totalFiles = state.entries.filter((line) => line.trim().startsWith('file ')).length;
  return {
    command: 'smart-tree',
    target: path.basename(dir),
    stats: {
      listedEntries: state.entries.length,
      directories: totalDirs,
      files: totalFiles,
      maxDepth: MAX_TREE_DEPTH,
    },
    anomalyFirst: state.entries.length >= MAX_TREE_ENTRIES ? ['tree truncated to deterministic entry budget'] : [],
    entries: state.entries,
  };
}

function formatValue(value, indent = 0) {
  const prefix = '  '.repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return `${prefix}[]`;
    return value.map((item) => {
      if (typeof item === 'string') return `${prefix}- ${item}`;
      return `${prefix}-\n${formatValue(item, indent + 1)}`;
    }).join('\n');
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([key, item]) => {
      if (Array.isArray(item)) {
        return `${prefix}${key}:\n${formatValue(item, indent + 1)}`;
      }
      if (item && typeof item === 'object') {
        return `${prefix}${key}:\n${formatValue(item, indent + 1)}`;
      }
      return `${prefix}${key}: ${item}`;
    }).join('\n');
  }
  return `${prefix}${String(value)}`;
}

function formatOutput(result) {
  return formatValue(result);
}

module.exports = {
  smartRead,
  smartLog,
  smartCsv,
  smartJson,
  smartTree,
  formatOutput,
};
