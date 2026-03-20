const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const cli = path.join(root, 'bin', 'context-optimizer.js');
const sample = path.join(root, 'README.md');

test('CLI --strict-preset rejects unknown preset', () => {
  try {
    execFileSync(process.execPath, [cli, 'smart-read', sample, '--strict-preset', '--preset=not-a-real-preset'], {
      encoding: 'utf8',
    });
    assert.fail('expected non-zero exit');
  } catch (e) {
    assert.ok(e.status > 0 || e.code);
    assert.match(String(e.stderr || ''), /unknown preset/i);
  }
});
