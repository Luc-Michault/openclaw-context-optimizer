const { test } = require('node:test');
const assert = require('node:assert');
const { smartLogText } = require('../src/index');

test('smart-log anomaly line numbers match file lines when blanks present', () => {
  const text = 'INFO ok\n\nERROR boom\nINFO tail\n';
  const r = smartLogText(text, 'app.log', {});
  const err = r.anomalyFirst.find((a) => a.kind === 'error');
  assert.ok(err, 'expected error anomaly');
  assert.strictEqual(err.line, 3);
});
