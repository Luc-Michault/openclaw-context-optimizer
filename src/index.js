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
const { gatherRepoContext } = require('./repo-context');

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
  if (/\.toml$/i.test(name)) signals.push('toml-config');
  if (/\.(ini|cfg)$/i.test(name)) signals.push('ini-style-config');
  if (/compose\.ya?ml$|docker-compose/.test(name)) signals.push('compose-services');
  if (/\.(env|ini|toml|conf|cfg)$/.test(name) || /(^|[./])\.env/.test(name)) signals.push('runtime-config');
  const lines = text.split('\n');
  if (lines.some((line) => lineLooksLikeSecretAssignment(line))) signals.push('likely-secret-assignment');
  if (/^\s*services\s*:\s*$/m.test(text) && /\.ya?ml$/i.test(name)) signals.push('compose-top-level-services');
  if (/^\s*\[.*\]\s*$/m.test(text) && /\.toml$/i.test(name)) signals.push('toml-table-structure');
  return signals;
}

/** Bounded .env sketch — counts assignments, empties, shell-style placeholders. */
function sketchEnvStructure(text) {
  const lines = text.split('\n');
  let entries = 0;
  let emptyValues = 0;
  let placeholderValues = 0;
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    entries += 1;
    const val = t.slice(eq + 1).trim();
    if (!val) emptyValues += 1;
    else if (/\$\{[^}]+\}/.test(val) || /^<.*>$/.test(val)) placeholderValues += 1;
  }
  return { entries, emptyValues, placeholderValues };
}

/** Top-level YAML keys (no leading indent), bounded — not a full parser. */
function sketchYamlTopKeys(text, max = 14) {
  const keys = [];
  const seen = new Set();
  for (const line of text.split('\n')) {
    if (keys.length >= max) break;
    if (/^\s+/.test(line)) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_.-]*)\s*:/);
    if (m && !seen.has(m[1])) {
      seen.add(m[1]);
      keys.push(m[1]);
    }
  }
  return keys;
}

/** TOML table headers `[section]` only, bounded. */
function sketchTomlTableNames(text, max = 14) {
  const names = [];
  for (const line of text.split('\n')) {
    if (names.length >= max) break;
    const m = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (m) names.push(m[1].trim());
  }
  return names;
}

/**
 * Extra file hints + read-next lines for config-like bodies (no new deps).
 * @returns {{ extraFileHints: string[], configReadHints: string[] }}
 */
function gatherConfigStructureHints(text, displayTarget) {
  const name = String(displayTarget || '').toLowerCase();
  const extraFileHints = [];
  const configReadHints = [];
  const isEnv = /(^|[./])\.env/.test(name) || /\.env\.[^/]+$/i.test(name);
  const isYaml = /\.ya?ml$/i.test(name);
  const isToml = /\.toml$/i.test(name);

  if (isEnv) {
    const sk = sketchEnvStructure(text);
    if (sk.entries) extraFileHints.push(`env:assignments=${sk.entries}`);
    if (sk.emptyValues) extraFileHints.push(`env:empty-values=${sk.emptyValues}`);
    if (sk.placeholderValues) extraFileHints.push(`env:placeholder-values=${sk.placeholderValues}`);
    if (sk.entries) {
      configReadHints.push(
        `config: .env has ${sk.entries} assignments — exact-read lines with secrets or empty values you will set`,
      );
    }
  }
  if (isYaml) {
    const keys = sketchYamlTopKeys(text);
    if (keys.length) {
      extraFileHints.push(`yaml:top-keys=${keys.slice(0, 8).join(',')}${keys.length > 8 ? ',…' : ''}`);
      configReadHints.push(
        `config: YAML top keys: ${keys.slice(0, 6).join(', ')} — next exact read the stanza matching your task`,
      );
    }
  }
  if (isToml) {
    const tabs = sketchTomlTableNames(text);
    if (tabs.length) {
      extraFileHints.push(`toml:tables=${tabs.slice(0, 8).join(',')}${tabs.length > 8 ? ',…' : ''}`);
      configReadHints.push(
        `config: TOML sections: ${tabs.slice(0, 6).join(', ')} — read the table you will edit verbatim`,
      );
    }
  }
  return { extraFileHints, configReadHints };
}

/** Lower = more urgent for "what to open next" in procedural docs. */
function sectionActionPriority(title) {
  const t = String(title || '').toLowerCase();
  if (/install|installation|prerequisites|requirements|getting\s+started|quick\s*start/.test(t)) return 0;
  if (/usage|how\s+to\s+run|configuration|configure|options|environment|secrets?/.test(t)) return 1;
  if (/api|reference|troubleshoot|security|deploy|building|contributing/.test(t)) return 2;
  return 10;
}

function firstUncheckedChecklistLine1Based(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*[-*]\s*\[\s*\]\s+\S/.test(lines[i])) return i + 1;
  }
  return null;
}

function nearestHeadingBeforeLine1Based(lines, line1) {
  for (let i = line1 - 2; i >= 0; i -= 1) {
    const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m) {
      return { line: i + 1, level: m[1].length, title: truncate(m[2].trim(), 72) };
    }
  }
  return null;
}

function firstTodoMarkerWithContext(lines) {
  const keys = ['FIXME', 'TODO', 'HACK'];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const k of keys) {
      if (new RegExp(`\\b${k}\\b`).test(line)) {
        return { line: i + 1, marker: k, heading: nearestHeadingBeforeLine1Based(lines, i + 1) };
      }
    }
  }
  return null;
}

function countNormativeLines(lines) {
  const re =
    /\b(you must not|you must |do not |shall not |must not |never do |always use |required steps?\b|required to\b)\b/i;
  let n = 0;
  for (const line of lines) {
    if (re.test(line)) n += 1;
  }
  return n;
}

function markdownOutlineFromLines(lines, maxSections) {
  const cap = maxSections || 24;
  const countsByLevel = [0, 0, 0, 0, 0, 0];
  const topSections = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m) {
      const lv = m[1].length;
      countsByLevel[lv - 1] += 1;
      if (topSections.length < cap) {
        topSections.push({
          line: i + 1,
          level: lv,
          title: truncate(m[2].trim(), 72),
        });
      }
    }
  }
  const totalHeadings = countsByLevel.reduce((a, b) => a + b, 0);
  const depthSummary = countsByLevel
    .map((c, i) => (c ? `h${i + 1}:${c}` : null))
    .filter(Boolean)
    .join(' ');
  return { countsByLevel, totalHeadings, topSections, depthSummary };
}

function inferDocumentShape(text, lines, displayTarget) {
  const roles = [];
  const name = String(displayTarget || '').toLowerCase();
  if (/readme|contributing|changelog|agents\.md|skill\.md|architecture|integrations|rtk_compat/i.test(name)) {
    roles.push('likely-procedural-doc');
  }
  if (/\.(ya?ml|toml)$|dockerfile|(^|\/)\.env|\.ini$|\.cfg$/i.test(name)) {
    roles.push('likely-config-or-spec');
  }
  const checklistLines = lines.filter((l) => /^\s*[-*]\s*\[[ xX]\]\s+\S/.test(l)).length;
  if (checklistLines >= 4) roles.push('checklist-heavy');
  const numbered = lines.filter((l) => /^\s*\d+[.)]\s+\S/.test(l)).length;
  if (numbered >= 5) roles.push('numbered-procedure');
  const fences = lines.filter((l) => /^```/.test(l)).length;
  if (fences >= 4) roles.push('code-examples-present');
  if (/\b(VERSION|Changelog|Breaking|Deprecation|Migration)\b/i.test(text)) roles.push('release-notes-signals');
  if (/^(#{1,3})\s+(install|setup|usage|prerequisites|getting started)\b/im.test(text)) {
    roles.push('instruction-sections');
  }
  /* Require multiple lines to avoid tagging casual prose as "normative". */
  if (countNormativeLines(lines) >= 2) roles.push('normative-language');
  return roles.sort((a, b) => a.localeCompare(b));
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
  const { extraFileHints, configReadHints } = gatherConfigStructureHints(text, displayTarget);
  const markdownSections = detectMarkdownSectionMap(lines, budget.maxPreviewLines);
  const markdownOutline = markdownOutlineFromLines(lines, budget.maxPreviewLines);
  const documentShape = inferDocumentShape(text, lines, displayTarget);
  const todoSummary = detectTodoMarkers(lines);
  const readNextHints = [];
  const hintSeen = new Set();
  function pushHint(h) {
    if (!h || hintSeen.has(h)) return;
    hintSeen.add(h);
    readNextHints.push(h);
  }

  const todoCtx = firstTodoMarkerWithContext(lines);
  if (todoCtx && todoCtx.heading) {
    pushHint(
      `marker: ${todoCtx.marker} @L${todoCtx.line} — under § h${todoCtx.heading.level} @L${todoCtx.heading.line} (${todoCtx.heading.title})`,
    );
  } else if (todoCtx) {
    pushHint(`marker: ${todoCtx.marker} @L${todoCtx.line} — read surrounding lines for context`);
  }

  const uncheckedLine = firstUncheckedChecklistLine1Based(lines);
  if (uncheckedLine != null) {
    pushHint(`checklist: first unchecked item @L${uncheckedLine} — read that block next`);
  }

  if (markdownOutline.topSections.length) {
    const sorted = markdownOutline.topSections.slice().sort((a, b) => {
      const pa = sectionActionPriority(a.title);
      const pb = sectionActionPriority(b.title);
      if (pa !== pb) return pa - pb;
      return a.line - b.line;
    });
    for (const s of sorted.slice(0, 6)) {
      const pri = sectionActionPriority(s.title);
      const label = pri < 10 ? 'priority read' : 'next read';
      pushHint(`${label}: § h${s.level} @L${s.line} — ${s.title}`);
    }
  } else if (markdownSections.length) {
    const first = markdownSections[0];
    pushHint(`start near heading L${first.line} (h${first.level}): ${first.title}`);
  }

  if (todoSummary) pushHint(`scan lines with: ${todoSummary}`);
  for (const h of configReadHints) pushHint(h);
  if (configSignals.some((s) => s.includes('yaml') || s.includes('runtime-config'))) {
    pushHint('config: prefer exact read for values after this structural triage');
  }
  if (documentShape.includes('checklist-heavy')) {
    pushHint('many checkboxes: use the checklist line above or search for `[ ]` items');
  }
  if (markdownOutline.depthSummary) {
    pushHint(`heading depth: ${markdownOutline.depthSummary} — prefer h2/h3 sections for next exact read`);
  }
  if (documentShape.includes('instruction-sections')) {
    pushHint('instruction-style headings detected — read those sections verbatim before implementation');
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
    fileHints: [...markdownSignals, ...configSignals, ...extraFileHints, ...documentShape.map((r) => `shape:${r}`)],
    markdownSections,
    markdownOutline,
    documentShape,
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

function emptyTriageGroups() {
  return {
    startHere: [],
    buildDeploy: [],
    runtimeSource: [],
    configTooling: [],
    tests: [],
    docs: [],
    generated: [],
    other: [],
  };
}

function triageGroupKey(pathStr, reason) {
  const pl = pathStr.toLowerCase();
  const t = `${pathStr} ${reason}`.toLowerCase();
  if (
    /(^|\/)dist\/|(^|\/)build\/|(^|\/)\.next\/|(^|\/)out\/|(^|\/)target\/|(^|\/)coverage\/|(^|\/)__pycache__\//.test(pl) ||
    /\.min\.(js|css)$|\.bundle\.(js|mjs|cjs)$|\.map$|\.lock$/i.test(pl) ||
    /(^|\/)(pnpm-lock|package-lock|yarn\.lock|cargo\.lock|poetry\.lock|npm-shrinkwrap)/i.test(pl)
  ) {
    return 'generated';
  }
  if (/agents|readme|skill|contributing|changelog/.test(t)) return 'startHere';
  if (/jest|vitest|playwright|\btest\b|spec|__tests__/.test(t)) return 'tests';
  if (/eslint|tsconfig|nvmrc|license|copying|prettier|\.env/.test(t)) return 'configTooling';
  if (/docker|compose|makefile|webpack|vite|rollup|esbuild|gradle/.test(t)) return 'buildDeploy';
  if (/^docs\//.test(pathStr) || /\bdocs?\b/.test(t)) return 'docs';
  if (/^src\/|^lib\/|^app\/|^cmd\/|^pkg\//.test(pl)) return 'runtimeSource';
  return 'other';
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
      readNextContext: { openFirst: [], thenReview: [] },
      readNextSecondary: [],
      readNextSecondaryPaths: [],
      recentlyTouched: [],
      likelyBuildDeploy: [],
      likelyTestSignals: [],
      likelyDocs: [],
      stackSignals: [],
      monorepoHint: null,
      whyThisMatters: [],
      repoProfile: [],
      triageGroups: emptyTriageGroups(),
    };
  }

  const lower = new Set(rootNames.map((n) => n.toLowerCase()));

  function actualName(wantedLower) {
    return rootNames.find((n) => n.toLowerCase() === wantedLower);
  }

  const readNextSeen = new Set();
  const candidates = [];

  function pushCandidate(relPath, reason, priority) {
    const norm = relPath.replace(/\\/g, '/');
    const key = norm.toLowerCase();
    if (readNextSeen.has(key)) return;
    readNextSeen.add(key);
    candidates.push({ path: norm, reason, priority });
  }

  const pkgPathEarly = path.join(root, 'package.json');
  let pkgFields = null;
  if (fs.existsSync(pkgPathEarly)) {
    try {
      pkgFields = JSON.parse(fs.readFileSync(pkgPathEarly, 'utf8').slice(0, 65536));
    } catch {
      pkgFields = null;
    }
  }
  if (pkgFields && typeof pkgFields === 'object') {
    if (pkgFields.bin) {
      if (typeof pkgFields.bin === 'string') {
        const rel = pkgFields.bin.replace(/^\.\//, '');
        const full = path.join(root, rel);
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          pushCandidate(rel.replace(/\\/g, '/'), 'package.json bin (CLI / published command)', 11);
        }
      } else if (typeof pkgFields.bin === 'object') {
        for (const v of Object.values(pkgFields.bin)) {
          const rel = String(v).replace(/^\.\//, '');
          const full = path.join(root, rel);
          if (fs.existsSync(full) && fs.statSync(full).isFile()) {
            pushCandidate(rel.replace(/\\/g, '/'), 'package.json bin entry', 11);
          }
        }
      }
    }
    if (typeof pkgFields.module === 'string') {
      const rel = pkgFields.module.replace(/^\.\//, '');
      const full = path.join(root, rel);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        pushCandidate(rel.replace(/\\/g, '/'), 'package.json module (ESM public entry)', 12);
      }
    }
    const main = typeof pkgFields.main === 'string' ? pkgFields.main.replace(/^\.\//, '') : null;
    if (main) {
      const tries = [main, path.join('src', main), path.join('lib', main), path.join('src', path.basename(main))];
      const seenTry = new Set();
      for (const t of tries) {
        const normKey = t.replace(/\\/g, '/').toLowerCase();
        if (seenTry.has(normKey)) continue;
        seenTry.add(normKey);
        const full = path.join(root, t);
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          pushCandidate(t.replace(/\\/g, '/'), 'runtime entry from package.json main', 13);
          break;
        }
      }
    }
  }

  const PRIMARY_RULES = [
    { names: ['AGENTS.md'], reason: 'agent instructions — constraints before other reads', priority: 5 },
    { names: ['package.json'], reason: 'npm scripts, dependencies, metadata', priority: 6 },
    { names: ['Cargo.toml'], reason: 'Rust manifest', priority: 6 },
    { names: ['go.mod'], reason: 'Go module path and deps', priority: 6 },
    { names: ['pyproject.toml'], reason: 'Python project (PEP 621)', priority: 6 },
    { names: ['README.md', 'README.rst', 'README.txt'], reason: 'project overview / how to run', priority: 7 },
    { names: ['SKILL.md', 'skill.md'], reason: 'declared workflow / skill doc', priority: 8 },
    { names: ['openclaw.json'], reason: 'OpenClaw configuration', priority: 9 },
    { names: ['openclaw.plugin.json'], reason: 'OpenClaw extension manifest', priority: 10 },
    { names: ['setup.py', 'requirements.txt'], reason: 'Python packaging / deps list', priority: 11 },
    { names: ['composer.json'], reason: 'PHP dependencies', priority: 12 },
    { names: ['index.ts', 'index.js', 'index.mjs'], reason: 'likely runtime entry at repo root', priority: 18 },
    { names: ['main.py'], reason: 'likely Python entry', priority: 19 },
    { names: ['Dockerfile'], reason: 'container image build', priority: 22 },
    { names: ['docker-compose.yml', 'docker-compose.yaml'], reason: 'multi-service local stack', priority: 23 },
    { names: ['Makefile'], reason: 'build targets', priority: 24 },
    { names: ['CONTRIBUTING.md'], reason: 'contribution / dev workflow', priority: 25 },
  ];
  for (const rule of PRIMARY_RULES) {
    for (const nm of rule.names) {
      const got = actualName(nm.toLowerCase());
      if (got) pushCandidate(got, rule.reason, rule.priority);
    }
  }

  const ENTRY_REL = [
    { rel: 'src/index.ts', reason: 'TypeScript source entry', priority: 20 },
    { rel: 'src/index.js', reason: 'JavaScript source entry', priority: 20 },
    { rel: 'src/main.ts', reason: 'alternate TS entry', priority: 21 },
    { rel: 'cmd/root.go', reason: 'Go CLI entry (common layout)', priority: 22 },
  ];
  for (const { rel, reason, priority } of ENTRY_REL) {
    const full = path.join(root, rel);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) pushCandidate(rel, reason, priority);
  }

  const SECONDARY_RULES = [
    { names: ['tsconfig.json'], reason: 'TypeScript compiler options', priority: 35 },
    { names: ['pnpm-workspace.yaml', 'lerna.json', 'nx.json'], reason: 'workspace / monorepo orchestration', priority: 38 },
    { names: ['turbo.json'], reason: 'task pipeline config', priority: 39 },
    { names: ['LICENSE', 'LICENSE.md', 'COPYING'], reason: 'license terms', priority: 40 },
    { names: ['.nvmrc', '.node-version'], reason: 'Node version pin', priority: 41 },
    {
      names: [
        'vitest.config.ts',
        'vitest.config.js',
        'jest.config.js',
        'jest.config.cjs',
        'jest.config.mjs',
        'playwright.config.ts',
      ],
      reason: 'test runner configuration',
      priority: 42,
    },
    { names: ['eslint.config.js', '.eslintrc.cjs', '.eslintrc.json'], reason: 'lint rules', priority: 43 },
  ];
  for (const rule of SECONDARY_RULES) {
    for (const nm of rule.names) {
      const got = actualName(nm.toLowerCase());
      if (got) pushCandidate(got, rule.reason, rule.priority);
    }
  }

  candidates.sort((a, b) => a.priority - b.priority || a.path.localeCompare(b.path));
  const readNextPrimary = candidates.slice(0, 8);
  const readNextSecondary = candidates.slice(8, 14);
  const readNextMerged = [...readNextPrimary, ...readNextSecondary];

  const likelyDocs = readNextMerged.filter((r) => /^readme/i.test(r.path) || r.path === 'AGENTS.md').map((r) => r.path);

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

  const repoProfile = [];
  if (lower.has('package.json')) repoProfile.push('node-package');
  if (lower.has('cargo.toml')) repoProfile.push('rust-crate');
  if (lower.has('go.mod')) repoProfile.push('go-module');
  if (lower.has('pyproject.toml') || lower.has('setup.py')) repoProfile.push('python-project');
  if (rootNames.includes('packages') || rootNames.includes('apps')) repoProfile.push('monorepo-layout');
  if (lower.has('openclaw') || lower.has('openclaw.json')) repoProfile.push('openclaw-adjacent');
  if (likelyBuildDeploy.length >= 4) repoProfile.push('infra-build-heavy');
  if (likelyDocs.length >= 2 && !lower.has('package.json') && !lower.has('cargo.toml')) {
    repoProfile.push('docs-heavy');
  }
  repoProfile.sort((a, b) => a.localeCompare(b));

  const whyThisMatters = [];
  if (readNextPrimary.length) {
    const top = readNextPrimary
      .slice(0, 3)
      .map((r) => r.path)
      .join(', ');
    whyThisMatters.push(
      `Start here: open ${top} in order — they are ranked for “how do I run / what are the rules / what is this repo”.`,
    );
  }
  if (readNextSecondary.length) {
    whyThisMatters.push(
      'Then: readNextSecondary — tooling and test config after you understand the manifest and top-level docs.',
    );
  }
  whyThisMatters.push(
    'triageGroups: scan startHere → runtimeSource/other → buildDeploy → configTooling → tests → docs; use generated only to know what to ignore.',
  );
  if (acc.length) {
    whyThisMatters.push(
      'recentlyTouched: use as a tie-breaker after readNext — hot files are not always the right first read.',
    );
  }
  if (monorepoHint) whyThisMatters.push(monorepoHint);

  const readNextPaths = readNextPrimary.map((r) => r.path);
  const readNextSecondaryPaths = readNextSecondary.map((r) => r.path);
  const readNextContext = {
    openFirst: readNextPaths.slice(0, 4),
    thenReview: readNextPaths.slice(4).concat(readNextSecondaryPaths),
  };

  const triageGroups = emptyTriageGroups();
  for (const item of readNextMerged) {
    const g = triageGroupKey(item.path, item.reason);
    if (triageGroups[g].length < 6) triageGroups[g].push({ path: item.path, reason: item.reason });
  }

  const rootRepoCtx = gatherRepoContext(root);
  const profileSet = new Set(repoProfile);
  for (const inf of rootRepoCtx.inferences || []) profileSet.add(inf);
  if (pkgFields && pkgFields.bin) profileSet.add('likely-cli-or-bin-package');
  if (pkgFields && pkgFields.private === true) profileSet.add('likely-private-workspace');
  if (pkgFields && pkgFields.private !== true && typeof pkgFields.name === 'string' && pkgFields.name) {
    profileSet.add('likely-public-npm-manifest');
  }
  if ((rootRepoCtx.inferences || []).includes('npm:non-private-manifest')) {
    profileSet.add('likely-public-npm-manifest');
  }
  const repoProfileMerged = deterministicSort([...profileSet]);

  return {
    readNext: readNextPrimary,
    readNextPaths,
    readNextContext,
    readNextSecondary,
    readNextSecondaryPaths,
    triageGroups,
    recentlyTouched,
    likelyBuildDeploy: deterministicSort([...new Set(likelyBuildDeploy)]).slice(0, 10),
    likelyTestSignals,
    likelyDocs: deterministicSort(likelyDocs),
    stackSignals: deterministicSort(stackSignals),
    monorepoHint,
    whyThisMatters,
    repoProfile: repoProfileMerged,
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
