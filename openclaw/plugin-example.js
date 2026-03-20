#!/usr/bin/env node
/**
 * Library + CLI example for running reducers from OpenClaw-shaped code.
 *
 * For large-read **suggestions** (not reductions), use `openclaw/suggest.js`:
 *
 *   const { buildLargeReadSuggestion, emitLargeReadSuggestion, formatSuggestionForAgent } = require('./suggest');
 *   const cfg = { suggestOnLargeRead: true, maxFileBytes: 2e6, logSuggestions: false,
 *     onSuggestion(s, meta) { appendToTranscript(formatSuggestionForAgent(s)); } };
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const {
  smartRead,
  smartLog,
  smartCsv,
  smartJson,
  smartTree,
} = require('../src/index');

const CLI = path.join(__dirname, '..', 'bin', 'context-optimizer.js');
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * Reduce a local file or directory via the library (default) or by spawning the CLI.
 * Library path avoids execFileSync buffer limits and is preferred for OpenClaw tools.
 *
 * Example integration stub for `openclaw-context-optimizer`.
 *
 * @param {string} command smart-read | smart-log | smart-csv | smart-json | smart-tree
 * @param {string} target absolute or cwd-relative path
 * @param {string} [preset='agent']
 * @param {{ useCli?: boolean; maxBuffer?: number }} [options]
 */
function reduceForOpenClaw(command, target, preset = 'agent', options = {}) {
  const useCli = Boolean(options && options.useCli);
  const maxBuffer = (options && options.maxBuffer) || DEFAULT_MAX_BUFFER;

  if (useCli) {
    const resolved = path.resolve(process.cwd(), target);
    const output = execFileSync(
      process.execPath,
      [CLI, command, '--json', `--preset=${preset}`, resolved],
      { encoding: 'utf8', maxBuffer },
    );
    return JSON.parse(output);
  }

  const resolved = path.resolve(process.cwd(), target);
  const opts = { cli: { preset } };

  switch (command) {
    case 'smart-read':
      if (!fs.statSync(resolved).isFile()) throw new Error('smart-read expects a file');
      return smartRead(resolved, opts);
    case 'smart-log':
      if (!fs.statSync(resolved).isFile()) throw new Error('smart-log expects a file');
      return smartLog(resolved, opts);
    case 'smart-csv':
      if (!fs.statSync(resolved).isFile()) throw new Error('smart-csv expects a file');
      return smartCsv(resolved, opts);
    case 'smart-json':
      if (!fs.statSync(resolved).isFile()) throw new Error('smart-json expects a file');
      return smartJson(resolved, opts);
    case 'smart-tree':
      if (!fs.statSync(resolved).isDirectory()) throw new Error('smart-tree expects a directory');
      return smartTree(resolved, opts);
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

module.exports = {
  reduceForOpenClaw,
  DEFAULT_MAX_BUFFER,
};

if (require.main === module) {
  const [, , command, target, preset] = process.argv;
  if (!command || !target) {
    console.error('usage: node openclaw/plugin-example.js <command> <target> [preset]');
    console.error('       CONTEXT_OPTIMIZER_USE_CLI=1 to force subprocess (see maxBuffer in source)');
    process.exit(1);
  }
  const useCli = process.env.CONTEXT_OPTIMIZER_USE_CLI === '1';
  process.stdout.write(`${JSON.stringify(reduceForOpenClaw(command, target, preset || 'agent', { useCli }), null, 2)}\n`);
}
