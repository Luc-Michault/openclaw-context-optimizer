const { test } = require('node:test');
const assert = require('node:assert');
const { parseCsvText } = require('../src/csv-parse');

test('parseCsvText handles quoted commas and doubled quotes', () => {
  const rows = parseCsvText('a,b\n"hello, world","say ""hi"""\n');
  assert.deepStrictEqual(rows, [
    ['a', 'b'],
    ['hello, world', 'say "hi"'],
  ]);
});

test('parseCsvText handles newline inside quoted field', () => {
  const rows = parseCsvText('col1,col2\n"line one\nline two",x\n');
  assert.deepStrictEqual(rows, [['col1', 'col2'], ['line one\nline two', 'x']]);
});
