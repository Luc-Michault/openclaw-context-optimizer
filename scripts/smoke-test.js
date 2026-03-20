const { execFileSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'bin', 'context-optimizer.js');
const cases = [
  ['smart-read', path.join(root, 'samples', 'sample.txt')],
  ['smart-log', path.join(root, 'samples', 'sample.log')],
  ['smart-csv', path.join(root, 'samples', 'sample.csv')],
  ['smart-json', path.join(root, 'samples', 'sample.json')],
  ['smart-tree', path.join(root, 'samples')],
];

for (const [command, target] of cases) {
  const output = execFileSync('node', [cli, command, target], { encoding: 'utf8' });
  if (!output.includes(`command: ${command}`)) {
    throw new Error(`missing command marker for ${command}`);
  }
  console.log(`PASS ${command}`);
}

console.log('Smoke test complete.');
