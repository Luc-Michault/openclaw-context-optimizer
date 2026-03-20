const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { smartReadText, smartJsonText, smartTree, smartLogText } = require('../src/index');
const { resolveBudget } = require('../src/budget');

test('agent preset changes budget defaults', () => {
  const budget = resolveBudget({}, { preset: 'agent' });
  assert.ok(budget.maxTreeEntries > 40);
  assert.ok(budget.maxTreeDepth >= 4);
});

test('smart-read adds markdown and config hints', () => {
  const result = smartReadText('# Title\n## Next\n- item\n```js\nconst x = 1\n```\nAPI_KEY=test\n', 'README.md', { preset: 'agent' });
  assert.ok(result.fileHints.some((h) => /^headings=\d+/.test(h) && parseInt(h.split('=')[1], 10) >= 1));
  assert.ok(result.fileHints.includes('bullets=1'));
  assert.ok(result.fileHints.includes('likely-secret-assignment'));
  assert.ok(Array.isArray(result.markdownSections) && result.markdownSections.length >= 1);
  assert.ok(result.markdownSections[0].title.includes('Title'));
  assert.ok(result.markdownOutline && result.markdownOutline.totalHeadings >= 2);
  assert.ok(result.documentShape && result.documentShape.includes('likely-procedural-doc'));
  assert.ok(result.readNextHints.some((h) => h.includes('L') && h.includes('Title')));
});

test('smart-read does not flag prose that only mentions password', () => {
  const result = smartReadText('Set your password in the security panel.\n', 'notes.txt', { preset: 'agent' });
  assert.ok(!result.fileHints.includes('likely-secret-assignment'));
});

test('smart-json adds operational hints', () => {
  const json = JSON.stringify({ status: 'ok', items: Array.from({ length: 25 }, (_, id) => ({ id, error: null })) });
  const result = smartJsonText(json, 'state.json', { preset: 'schema' });
  assert.ok(result.operationalHints.some((line) => line.includes('has status field')));
  assert.ok(result.operationalHints.some((line) => line.includes('large array')));
  assert.ok(result.operationalHints.some((line) => line.includes('keyFrequency')));
});

test('smart-tree adds package.json main to readNext when file exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'co-main-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', main: 'index.js' }), 'utf8');
  fs.writeFileSync(path.join(dir, 'index.js'), '// entry\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'README.md'), '# x\n', 'utf8');
  const result = smartTree(dir, { preset: 'triage' });
  const paths = result.triageHints.readNextPaths || result.triageHints.readNext.map((r) => r.path);
  assert.ok(paths.includes('index.js'));
  const mainHint = result.triageHints.readNext.find((r) => r.path === 'index.js');
  assert.ok(mainHint && /package\.json main/i.test(mainHint.reason));
});

test('smart-tree adds project hints', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'co-tree-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.mkdirSync(path.join(dir, 'test'));
  fs.mkdirSync(path.join(dir, 'openclaw'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(dir, 'README.md'), '# hi\n', 'utf8');
  const result = smartTree(dir, { preset: 'triage' });
  assert.ok(result.projectHints.includes('node/javascript project'));
  assert.ok(result.projectHints.includes('code + tests visible'));
  assert.ok(result.projectHints.includes('openclaw integration folder present'));
  assert.ok(result.triageHints);
  const paths = result.triageHints.readNextPaths || result.triageHints.readNext.map((r) => r.path);
  assert.ok(paths.includes('package.json'));
  assert.ok(paths.includes('README.md'));
  const pkg = result.triageHints.readNext.find((r) => r.path === 'package.json');
  assert.ok(pkg && typeof pkg.reason === 'string' && pkg.reason.length > 0);
  assert.ok(Array.isArray(result.triageHints.repoProfile));
  assert.ok(result.triageHints.repoProfile.includes('node-package'));
  assert.ok(Array.isArray(result.triageHints.readNextSecondary));
  assert.ok(result.triageHints.triageGroups && Array.isArray(result.triageHints.triageGroups.startHere));
  assert.ok(result.triageHints.triageGroups.startHere.length >= 1);
});

test('smart-read exposes markdown depth summary', () => {
  const body = '# A\n## B\n### C\n';
  const result = smartReadText(body, 'GUIDE.md', { preset: 'agent' });
  assert.ok(result.markdownOutline && result.markdownOutline.depthSummary.includes('h1:'));
  assert.ok(result.readNextHints.some((h) => h.includes('heading depth')));
});

test('smart-tree splits secondary read list for extra root files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'co-sec-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(dir, 'README.md'), '# x\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'x\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'openclaw.json'), '{}\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'index.js'), '//\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'Dockerfile'), 'FROM scratch\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'docker-compose.yml'), 'services: {}\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'Makefile'), 'all:\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'CONTRIBUTING.md'), '# c\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'LICENSE'), 'MIT\n', 'utf8');
  const result = smartTree(dir, { preset: 'triage' });
  const sec = result.triageHints.readNextSecondary || [];
  const secPaths = result.triageHints.readNextSecondaryPaths || sec.map((r) => r.path);
  assert.ok(secPaths.includes('tsconfig.json') || secPaths.includes('LICENSE'));
});

test('smart-log adds anomaly summary', () => {
  const result = smartLogText('INFO ok\nWARN slow\nERROR bad\n', 'app.log', { preset: 'agent' });
  assert.deepStrictEqual(result.anomalySummary, ['first warning @ line 2', 'last error @ line 3']);
});
