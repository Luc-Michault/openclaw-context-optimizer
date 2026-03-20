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
  const result = smartReadText('# Title\n- item\n```js\nconst x = 1\n```\nAPI_KEY=test\n', 'README.md', { preset: 'agent' });
  assert.ok(result.fileHints.includes('headings=1'));
  assert.ok(result.fileHints.includes('bullets=1'));
  assert.ok(result.fileHints.includes('likely-secret-assignment'));
  assert.ok(Array.isArray(result.markdownSections) && result.markdownSections.length >= 1);
  assert.ok(result.markdownSections[0].title.includes('Title'));
  assert.ok(result.readNextHints.some((h) => h.includes('heading')));
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
});

test('smart-log adds anomaly summary', () => {
  const result = smartLogText('INFO ok\nWARN slow\nERROR bad\n', 'app.log', { preset: 'agent' });
  assert.deepStrictEqual(result.anomalySummary, ['first warning @ line 2', 'last error @ line 3']);
});
