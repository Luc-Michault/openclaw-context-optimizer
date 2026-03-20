#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  smartRead,
  smartLog,
  smartCsv,
  smartJson,
  smartTree,
  formatOutput,
} = require('../src/index');

function usage() {
  console.log(`context-optimizer <command> <path>

Commands:
  smart-read <file>
  smart-log <file>
  smart-csv <file>
  smart-json <file>
  smart-tree <dir>`);
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

const [, , command, target] = process.argv;

if (!command || command === '--help' || command === '-h') {
  usage();
  process.exit(0);
}

if (!target) {
  fail('missing path argument');
}

const resolved = path.resolve(process.cwd(), target);
if (!fs.existsSync(resolved)) {
  fail(`path does not exist: ${target}`);
}

let result;

switch (command) {
  case 'smart-read':
    result = smartRead(resolved);
    break;
  case 'smart-log':
    result = smartLog(resolved);
    break;
  case 'smart-csv':
    result = smartCsv(resolved);
    break;
  case 'smart-json':
    result = smartJson(resolved);
    break;
  case 'smart-tree':
    result = smartTree(resolved);
    break;
  default:
    fail(`unknown command: ${command}`);
}

console.log(formatOutput(result));
