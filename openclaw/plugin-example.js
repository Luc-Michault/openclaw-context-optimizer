#!/usr/bin/env node

const { execFileSync } = require('child_process');
const path = require('path');

const cli = path.join(__dirname, '..', 'bin', 'context-optimizer.js');

function reduceForOpenClaw(command, target, preset = 'agent') {
  const output = execFileSync(process.execPath, [cli, command, '--json', `--preset=${preset}`, target], {
    encoding: 'utf8',
  });
  return JSON.parse(output);
}

module.exports = {
  reduceForOpenClaw,
};

if (require.main === module) {
  const [, , command, target, preset] = process.argv;
  if (!command || !target) {
    console.error('usage: node openclaw/plugin-example.js <command> <target> [preset]');
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(reduceForOpenClaw(command, target, preset || 'agent'), null, 2)}\n`);
}
