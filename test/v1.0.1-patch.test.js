const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { smartTree } = require('../src/index');

const CWD = path.join(__dirname, '..');

test('smart-tree omits .git and node_modules from entries', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'co-tree-skip-'));
  fs.mkdirSync(path.join(dir, '.git', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.mkdirSync(path.join(dir, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'x', 'package.json'), '{}');
  fs.writeFileSync(path.join(dir, 'README.md'), '# x\n');
  const r = smartTree(dir, { preset: 'triage' });
  const blob = r.entries.join('\n');
  assert.ok(!/\bdir \.git\b/.test(blob), 'should not list .git directory');
  assert.ok(!/\bdir node_modules\b/.test(blob), 'should not list node_modules directory');
  assert.ok(blob.includes('README.md'), 'should still list normal files');
});

test('advise CLI accepts --path like positional', () => {
  const out1 = execSync('node bin/context-optimizer.js advise package.json', { cwd: CWD, encoding: 'utf8' });
  const out2 = execSync('node bin/context-optimizer.js advise --path package.json', { cwd: CWD, encoding: 'utf8' });
  const out3 = execSync('node bin/context-optimizer.js advise --path=package.json', { cwd: CWD, encoding: 'utf8' });
  assert.ok(out1.includes('"action"'), out1.slice(0, 200));
  assert.ok(out2.includes('"action"'), out2.slice(0, 200));
  assert.ok(out3.includes('"action"'), out3.slice(0, 200));
  assert.ok(!out2.includes('requires a path'), out2);
});
