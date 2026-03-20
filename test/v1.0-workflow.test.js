const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { smartTree, smartRead } = require('../src/index');
const { advise } = require('../src/policy');

const FIX = path.join(__dirname, 'fixtures');

function runWorkflow(root) {
  const dirAdvise = advise({ path: root, sizeBytes: 0 });
  assert.strictEqual(dirAdvise.isDirectory, true);
  assert.strictEqual(dirAdvise.action, 'reduce');
  assert.strictEqual(dirAdvise.reducerCommand, 'smart-tree');

  const tree = smartTree(root, { preset: 'triage' });
  const first = tree.triageHints.readNext[0];
  assert.ok(first && first.path, 'readNext[0] missing');

  const fp = path.join(root, first.path);
  const st = fs.statSync(fp);
  const fileAdvise = advise({ path: fp, sizeBytes: st.size });
  assert.ok(
    fileAdvise.action === 'raw-read' || fileAdvise.action === 'reduce',
    `advise on first file should be raw-read or reduce, got ${fileAdvise.action}`,
  );
  if (fileAdvise.action === 'raw-read') assert.strictEqual(fileAdvise.shouldReduce, false);
  if (fileAdvise.action === 'reduce') assert.strictEqual(fileAdvise.shouldReduce, true);

  const read = smartRead(fp, { preset: 'agent' });
  assert.ok(Array.isArray(read.readNextHints) && read.readNextHints.length >= 1);
  const hint0 = read.readNextHints[0];
  const text = fs.readFileSync(fp, 'utf8');
  const m = hint0.match(/@L(\d+)/);
  if (m) {
    const lineNum = Number(m[1], 10);
    assert.ok(lineNum >= 1 && lineNum <= text.split('\n').length);
  } else {
    assert.ok(
      /config:|priority read:|next read:|marker:|checklist:/i.test(hint0),
      `expected structured hint, got: ${hint0}`,
    );
  }
}

test('workflow: fixture-node-app', () => {
  runWorkflow(path.join(FIX, 'fixture-node-app'));
});

test('workflow: fixture-python-cli', () => {
  runWorkflow(path.join(FIX, 'fixture-python-cli'));
});

test('workflow: fixture-docs-heavy', () => {
  runWorkflow(path.join(FIX, 'fixture-docs-heavy'));
});
