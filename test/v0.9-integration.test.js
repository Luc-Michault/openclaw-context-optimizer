const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { smartTree, smartReadText } = require('../src/index');
const { gatherRepoContext } = require('../src/repo-context');
const { advise } = require('../src/policy');
const { aggregateMetrics } = require('../src/metrics');
const {
  pathMatchesMatcher,
  formatSuggestionForAgent,
  buildLargeReadSuggestion,
} = require('../openclaw/suggest');

const FIX = path.join(__dirname, 'fixtures');

test('fixture repo-node-minimal: AGENTS before package.json in readNext', () => {
  const root = path.join(FIX, 'repo-node-minimal');
  const result = smartTree(root, { preset: 'triage' });
  const paths = result.triageHints.readNext.map((r) => r.path);
  const iA = paths.indexOf('AGENTS.md');
  const iP = paths.indexOf('package.json');
  assert.ok(iA >= 0 && iP >= 0 && iA < iP);
  assert.ok(result.triageHints.readNextContext.openFirst.includes('AGENTS.md'));
});

test('fixture repo-rust-cli: Cargo.toml ranks with primary docs', () => {
  const root = path.join(FIX, 'repo-rust-cli');
  const result = smartTree(root, { preset: 'triage' });
  const paths = result.triageHints.readNext.map((r) => r.path);
  assert.ok(paths.includes('Cargo.toml'));
  assert.ok(paths.includes('README.md'));
  const iC = paths.indexOf('Cargo.toml');
  const iR = paths.indexOf('README.md');
  assert.ok(iC >= 0 && iR >= 0 && iC < iR);
});

test('fixture repo-monorepo: gatherRepoContext sees npm workspaces', () => {
  const root = path.join(FIX, 'repo-monorepo');
  const ctx = gatherRepoContext(root);
  assert.ok(ctx.inferences.includes('monorepo:npm-workspaces'));
  const tree = smartTree(root, { preset: 'triage' });
  assert.ok(tree.triageHints.monorepoHint || tree.triageHints.repoProfile.some((p) => /mono/i.test(p)));
});

test('fixture repo-docs-only: README triages without Node manifest', () => {
  const root = path.join(FIX, 'repo-docs-only');
  const result = smartTree(root, { preset: 'triage' });
  const paths = result.triageHints.readNext.map((r) => r.path);
  assert.ok(paths.includes('README.md'));
  assert.ok(!paths.includes('package.json'));
});

test('advise on fixture directory recommends smart-tree', () => {
  const root = path.join(FIX, 'repo-node-minimal');
  const a = advise({ path: root, sizeBytes: 0 });
  assert.strictEqual(a.isDirectory, true);
  assert.strictEqual(a.reducerCommand, 'smart-tree');
});

test('smart-read: priority sections and YAML / TOML / env sketches', () => {
  const yamlPath = path.join(FIX, 'config-samples', 'app.yaml');
  const y = smartReadText(fs.readFileSync(yamlPath, 'utf8'), 'app.yaml', { preset: 'agent' });
  assert.ok(y.fileHints.some((h) => h.startsWith('yaml:top-keys=')));
  assert.ok(y.readNextHints.some((h) => h.includes('service') || h.includes('YAML top keys')));

  const tomlPath = path.join(FIX, 'config-samples', 'settings.toml');
  const t = smartReadText(fs.readFileSync(tomlPath, 'utf8'), 'settings.toml', { preset: 'agent' });
  assert.ok(t.fileHints.some((h) => h.startsWith('toml:tables=')));
  assert.ok(t.readNextHints.some((h) => h.includes('TOML sections')));

  const envPath = path.join(FIX, 'config-samples', '.env.sample');
  const e = smartReadText(fs.readFileSync(envPath, 'utf8'), '.env.sample', { preset: 'agent' });
  assert.ok(e.fileHints.some((h) => h.startsWith('env:assignments=')));
  assert.ok(e.readNextHints.some((h) => h.includes('.env')));
});

test('smart-read: actionable doc orders Installation before Usage', () => {
  const body = [
    '# Guide',
    '',
    '## Usage',
    'Run the tool.',
    '',
    '## Installation',
    'Use npm.',
    '',
  ].join('\n');
  const r = smartReadText(body, 'GUIDE.md', { preset: 'agent' });
  const pri = r.readNextHints.filter((h) => h.startsWith('priority read:'));
  assert.ok(pri.length >= 1);
  assert.ok(pri[0].includes('Installation'));
});

test('smart-read: normative-language needs two matching lines', () => {
  const one = 'Hello you must read this.\n';
  const r1 = smartReadText(one, 'note.txt', { preset: 'agent' });
  assert.ok(!r1.documentShape.includes('normative-language'));
  const two = 'You must do A.\nDo not skip B.\n';
  const r2 = smartReadText(two, 'RULES.md', { preset: 'agent' });
  assert.ok(r2.documentShape.includes('normative-language'));
});

test('smart-read: TODO marker hint ties to nearest heading', () => {
  const body = ['# Alpha', '', '## Beta', '', '// TODO fix thing', ''].join('\n');
  const r = smartReadText(body, 'code.md', { preset: 'agent' });
  assert.ok(r.readNextHints.some((h) => h.includes('TODO') && h.includes('Beta')));
});

test('metrics qualityHints: high-ratio and efficient command signals', () => {
  const entries = [];
  for (let i = 0; i < 5; i += 1) {
    entries.push({
      command: 'smart-tree',
      preset: 'agent',
      inputTokensEst: 50_000,
      outputTokensEst: 30_000,
      target: `t${i}`,
      ratio: 0.6,
    });
  }
  for (let i = 0; i < 7; i += 1) {
    entries.push({
      command: 'smart-json',
      preset: 'agent',
      inputTokensEst: 20_000,
      outputTokensEst: 1500,
      target: `j${i}`,
      ratio: 0.075,
    });
  }
  const agg = aggregateMetrics(entries);
  const q = agg.qualityHints.join('\n');
  assert.ok(/smart-tree.*ratio/i.test(q) || q.includes('0.60'));
  assert.ok(/smart-json.*efficient/i.test(q) || q.includes('efficient'));
});

test('pathMatchesMatcher supports **/*.ext', () => {
  const p = '/home/proj/logs/nested/app.log'.replace(/\\/g, '/');
  assert.strictEqual(pathMatchesMatcher(p, '**/*.log'), true);
  assert.strictEqual(pathMatchesMatcher(p, '**/nested/'), true);
  assert.strictEqual(pathMatchesMatcher(p, '**/*.txt'), false);
});

test('formatSuggestionForAgent includes action and reasons', () => {
  const pkg = path.join(__dirname, '..', 'package.json');
  const s = buildLargeReadSuggestion(pkg, 9_000_000, { maxFileBytes: 1024 });
  assert.ok(s);
  const out = formatSuggestionForAgent(s);
  assert.ok(out.includes('[context-optimizer hint]'));
  assert.ok(out.includes(s.action));
});
