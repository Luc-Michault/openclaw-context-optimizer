const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'bin', 'context-optimizer.js');
const tempFile = path.join(os.tmpdir(), 'context-optimizer-demo.log');

const raw = [
  ...Array.from({ length: 40 }, (_, i) => `2026-03-20T11:00:${String(i).padStart(2, '0')}Z INFO worker started id=${100 + i}`),
  ...Array.from({ length: 12 }, (_, i) => `2026-03-20T11:01:${String(i).padStart(2, '0')}Z WARN retrying request id=${200 + i}`),
  ...Array.from({ length: 4 }, (_, i) => `2026-03-20T11:02:${String(i).padStart(2, '0')}Z ERROR request failed status=500 id=${300 + i}`),
].join('\n') + '\n';

fs.writeFileSync(tempFile, raw, 'utf8');
const compact = execFileSync('node', [cli, 'smart-log', tempFile], { encoding: 'utf8' });

console.log('=== RAW (first 12 lines) ===');
console.log(raw.split('\n').slice(0, 12).join('\n'));
console.log('\n=== COMPACT ===');
console.log(compact.trim());
console.log(`\nRaw chars: ${raw.length}`);
console.log(`Compact chars: ${compact.length}`);
console.log(`Compression ratio: ${(compact.length / raw.length).toFixed(2)}`);
