const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { smartTree, smartReadText } = require('../src/index');
const { advise } = require('../src/policy');
const { gatherRepoContext } = require('../src/repo-context');

const FIX = path.join(__dirname, 'fixtures');

function noNoiseInReadLists(triage) {
  const bad = (p) =>
    /\/dist\/|\/build\/|\/node_modules\/|\.min\.(js|css)$|\.map$/i.test(p) ||
    /\.lock$/i.test(p) ||
    /package-lock|yarn\.lock|pnpm-lock|cargo\.lock/i.test(p);
  const all = [
    ...triage.readNext.map((x) => x.path),
    ...triage.readNextSecondary.map((x) => x.path),
  ];
  for (const p of all) assert.ok(!bad(p), `unexpected noise path in read lists: ${p}`);
}

test('v1 fixture-node-app: first readNext is agent or manifest', () => {
  const root = path.join(FIX, 'fixture-node-app');
  const r = smartTree(root, { preset: 'triage' });
  const first = r.triageHints.readNext[0].path;
  assert.ok(['AGENTS.md', 'package.json', 'README.md'].includes(first));
  noNoiseInReadLists(r.triageHints);
  assert.ok(r.triageHints.readNextContext.openFirst.length <= 5);
  const a = advise({ path: root, sizeBytes: 0 });
  assert.strictEqual(a.action, 'reduce');
  assert.strictEqual(a.reducerCommand, 'smart-tree');
});

test('v1 fixture-openclaw-ext: SKILL or plugin manifest leads', () => {
  const root = path.join(FIX, 'fixture-openclaw-ext');
  const r = smartTree(root, { preset: 'triage' });
  const paths = r.triageHints.readNext.map((x) => x.path);
  assert.ok(paths.includes('SKILL.md'));
  assert.ok(paths.includes('openclaw.plugin.json'));
  const iSkill = paths.indexOf('SKILL.md');
  const iPkg = paths.indexOf('package.json');
  assert.ok(iSkill >= 0 && (iPkg < 0 || iSkill < iPkg), 'SKILL.md should rank before generic package.json');
  assert.ok(r.triageHints.repoProfile.includes('openclaw-extension'));
  noNoiseInReadLists(r.triageHints);
});

test('v1 fixture-monorepo-npm: root package.json first, workspace inference', () => {
  const root = path.join(FIX, 'fixture-monorepo-npm');
  const ctx = gatherRepoContext(root);
  assert.ok(ctx.inferences.some((i) => i.includes('monorepo')));
  const r = smartTree(root, { preset: 'triage' });
  assert.strictEqual(r.triageHints.readNext[0].path, 'package.json');
  const pri = r.triageHints.readNext.map((x) => x.path);
  assert.ok(
    pri.includes('turbo.json') || pri.includes('nx.json') || pri.includes('pnpm-workspace.yaml'),
    'workspace config files should rank in primary readNext',
  );
  noNoiseInReadLists(r.triageHints);
});

test('v1 fixture-node-published: manifest before lib source', () => {
  const root = path.join(FIX, 'fixture-node-published');
  const r = smartTree(root, { preset: 'triage' });
  const paths = r.triageHints.readNext.map((x) => x.path);
  const iPkg = paths.indexOf('package.json');
  const iLib = paths.indexOf('lib/index.js');
  assert.ok(iPkg >= 0 && (iLib < 0 || iPkg < iLib));
  assert.ok(r.triageHints.repoProfile.includes('likely-public-npm-manifest'));
});

test('v1 fixture-docs-heavy: README or mkdocs before deep docs', () => {
  const root = path.join(FIX, 'fixture-docs-heavy');
  const r = smartTree(root, { preset: 'triage' });
  const first = r.triageHints.readNext[0].path;
  assert.ok(/^README/i.test(first) || first === 'mkdocs.yml');
  noNoiseInReadLists(r.triageHints);
});

test('v1 smart-read SKILL.md: priority section is operational', () => {
  const body = fs.readFileSync(path.join(FIX, 'fixture-openclaw-ext', 'SKILL.md'), 'utf8');
  const r = smartReadText(body, 'SKILL.md', { preset: 'agent' });
  const pri = r.readNextHints.filter((h) => h.startsWith('priority read:'));
  assert.ok(pri.length >= 1);
  assert.ok(/when to use|workflow|anti/i.test(pri.join(' ')));
});

test('v1 smart-read CHANGELOG: breaking / migration priority', () => {
  const body = fs.readFileSync(path.join(FIX, 'fixture-node-published', 'CHANGELOG.md'), 'utf8');
  const r = smartReadText(body, 'CHANGELOG.md', { preset: 'agent' });
  const pri = r.readNextHints.filter((h) => h.startsWith('priority read:'));
  assert.ok(pri.some((h) => /breaking|migration/i.test(h)));
});

test('v1 dogfood toolkit: readNext starts with package or README', () => {
  const root = path.join(__dirname, '..');
  const r = smartTree(root, { preset: 'triage' });
  const first = r.triageHints.readNext[0].path;
  assert.ok(first === 'package.json' || /^README/i.test(first) || first === 'AGENTS.md');
});
