const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');
const cli = path.join(root, 'bin', 'context-optimizer.js');

test('CLI exits with error on invalid JSON', () => {
  const tmp = path.join(os.tmpdir(), `co-bad-${Date.now()}.json`);
  fs.writeFileSync(tmp, '{not json', 'utf8');
  try {
    execFileSync(process.execPath, [cli, 'smart-json', tmp], { encoding: 'utf8' });
    assert.fail('expected non-zero exit');
  } catch (e) {
    assert.ok(e.status > 0 || e.code, 'expected exec error');
    assert.match(String(e.stderr || e.stdout || ''), /invalid JSON/i);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
});
