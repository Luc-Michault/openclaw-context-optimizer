#!/usr/bin/env node
/**
 * One-shot generator for v1.0 realistic test fixtures (deterministic, committed).
 * Run: node scripts/generate-v1-fixtures.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'test', 'fixtures');

function write(rel, content) {
  const fp = path.join(root, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, 'utf8');
}

/* 1) Node app ~20 files */
const nodeApp = 'fixture-node-app';
write(`${nodeApp}/package.json`, JSON.stringify({
  name: 'fixture-node-app',
  version: '1.0.0',
  private: true,
  main: 'src/server.js',
  scripts: { start: 'node src/server.js', test: 'node --test' },
  dependencies: { express: '^4.0.0' },
}, null, 2) + '\n');
write(`${nodeApp}/README.md`, '# Node app fixture\n\n## Installation\n\n`npm install`\n\n## Usage\n\n`npm start`\n\n## Configuration\n\nSee `.env.example`.\n');
write(`${nodeApp}/AGENTS.md`, '# Agents\n\nYou must run tests before deploy.\nDo not commit secrets.\n');
write(`${nodeApp}/.env.example`, 'PORT=3000\nDATABASE_URL=\nAPI_KEY=\n');
write(`${nodeApp}/Dockerfile`, 'FROM node:20-alpine\nWORKDIR /app\nCOPY package.json .\n');
write(`${nodeApp}/jest.config.js`, "module.exports = { testEnvironment: 'node' };\n");
write(`${nodeApp}/eslint.config.js`, 'export default [];\n');
write(`${nodeApp}/tsconfig.json`, JSON.stringify({ compilerOptions: { target: 'ES2022' } }, null, 2) + '\n');
write(`${nodeApp}/src/server.js`, "const express = require('express');\nconst app = express();\napp.listen(3000);\n");
write(`${nodeApp}/src/routes/health.js`, "exports.get = () => ({ ok: true });\n");
write(`${nodeApp}/src/middleware/auth.js`, 'exports.requireAuth = () => {};\n');
write(`${nodeApp}/test/server.test.js`, "const { test } = require('node:test');\ntest('ok', () => {});\n");
write(`${nodeApp}/docs/api.md`, '# API\n\n## Endpoints\n\nGET /health\n');
write(`${nodeApp}/config/default.json`, JSON.stringify({ logLevel: 'info' }, null, 2) + '\n');
write(`${nodeApp}/scripts/migrate.sh`, '#!/bin/sh\necho migrate\n');
write(`${nodeApp}/public/static.txt`, 'static\n');
write(`${nodeApp}/dist/app.bundle.min.js`, '/* generated: do not edit */\nconsole.log(1);\n');
write(`${nodeApp}/dist/app.bundle.js.map`, '{"version":3,"sources":[]}\n');
write(`${nodeApp}/.github/workflows/ci.yml`, 'name: ci\non: [push]\njobs: { build: { runs-on: ubuntu-latest } }\n');
write(`${nodeApp}/CONTRIBUTING.md`, '# Contributing\n\nRun tests.\n');
write(`${nodeApp}/.gitignore`, 'node_modules\ndist\n.env\n');

/* 2) Published npm package */
const pub = 'fixture-node-published';
write(`${pub}/package.json`, JSON.stringify({
  name: 'fixture-published-pkg',
  version: '2.0.0',
  main: 'lib/index.js',
  module: 'lib/index.mjs',
  files: ['lib'],
}, null, 2) + '\n');
write(`${pub}/README.md`, '# Published package\n\n## Installation\n\n`npm i fixture-published-pkg`\n\n## Usage\n\n```js\nimport x from "fixture-published-pkg"\n```\n');
write(`${pub}/lib/index.js`, 'exports.version = "2.0.0";\n');
write(`${pub}/lib/index.mjs`, 'export const version = "2.0.0";\n');
write(`${pub}/lib/internal.js`, 'exports.secret = 1;\n');
write(`${pub}/test/index.test.js`, "require('node:test');\n");
write(`${pub}/CHANGELOG.md`, '# Changelog\n\n## 2.0.0\n\n### Breaking changes\n\nDropped Node 12.\n\n### Migration\n\nUpgrade to Node 18.\n');

/* 3) Python CLI */
const py = 'fixture-python-cli';
write(`${py}/pyproject.toml`, '[project]\nname = "fixture-python-cli"\nversion = "0.1.0"\nreadme = "README.md"\n[project.scripts]\nfixture-cli = "fixture_pkg.cli:main"\n');
write(`${py}/README.md`, '# Python CLI fixture\n\n## Installation\n\n`pip install -e .`\n\n## Usage\n\n`fixture-cli --help`\n');
write(`${py}/AGENTS.md`, '# Agents\n\nWhen to use this tool: local dev only.\n');
write(`${py}/src/fixture_pkg/__init__.py`, '__version__ = "0.1.0"\n');
write(`${py}/src/fixture_pkg/cli.py`, 'def main():\n    print("ok")\n');
write(`${py}/tests/test_cli.py`, 'def test_ok():\n    assert True\n');

/* 4) Rust CLI extended */
const rs = 'fixture-rust-cli-v1';
write(`${rs}/Cargo.toml`, '[package]\nname = "fixture-rust-cli-v1"\nversion = "0.1.0"\nedition = "2021"\n\n[[bin]]\nname = "fixture-rust"\npath = "src/main.rs"\n');
write(`${rs}/README.md`, '# Rust CLI\n\n## Installation\n\n`cargo build --release`\n\n## Usage\n\n`cargo run`\n');
write(`${rs}/src/main.rs`, 'fn main() { println!("ok"); }\n');
write(`${rs}/src/lib.rs`, 'pub fn helper() -> i32 { 1 }\n');
write(`${rs}/scripts/release.sh`, '#!/bin/sh\ncargo build --release\n');
write(`${rs}/tests/integration.rs`, '#[test]\nfn t() { assert_eq!(2, 2); }\n');
write(`${rs}/build/.keep`, '');

/* 5) Monorepo npm */
const mono = 'fixture-monorepo-npm';
write(`${mono}/package.json`, JSON.stringify({
  name: 'fixture-mono-root',
  private: true,
  workspaces: ['apps/*', 'packages/*'],
}, null, 2) + '\n');
write(`${mono}/turbo.json`, JSON.stringify({ pipeline: { build: { dependsOn: ['^build'] } } }, null, 2) + '\n');
write(`${mono}/nx.json`, JSON.stringify({ projects: {} }, null, 2) + '\n');
write(`${mono}/README.md`, '# Monorepo\n\n## Getting started\n\n`npm install` at root.\n');
write(`${mono}/apps/web/package.json`, JSON.stringify({ name: '@fixture/web', private: true }, null, 2) + '\n');
write(`${mono}/apps/web/index.js`, 'console.log("web");\n');
write(`${mono}/packages/ui/package.json`, JSON.stringify({ name: '@fixture/ui', private: true }, null, 2) + '\n');
write(`${mono}/packages/ui/src/index.js`, 'export const Button = 1;\n');
write(`${mono}/pnpm-workspace.yaml`, "packages:\n  - 'apps/*'\n  - 'packages/*'\n");

/* 6) OpenClaw extension */
const oc = 'fixture-openclaw-ext';
write(`${oc}/openclaw.plugin.json`, JSON.stringify({
  id: 'fixture-ext',
  name: 'Fixture extension',
  version: '1.0.0',
}, null, 2) + '\n');
write(`${oc}/README.md`, '# Extension\n\nOpenClaw plugin fixture.\n');
write(`${oc}/SKILL.md`, '# Skill: fixture\n\n## When to use\n\nUse for testing.\n\n## Workflow\n\n1. Install\n2. Run\n\n## Anti-patterns\n\nDo not skip tests.\n');
write(`${oc}/openclaw/index.js`, 'module.exports = function () {};\n');
write(`${oc}/src/handler.ts`, 'export function onEvent() {}\n');
write(`${oc}/package.json`, JSON.stringify({ name: 'fixture-openclaw-ext', private: true }, null, 2) + '\n');

/* 7) Docs-heavy */
const docs = 'fixture-docs-heavy';
write(`${docs}/README.md`, '# Docs site\n\nSee docs/ for guides.\n');
write(`${docs}/mkdocs.yml`, "site_name: Fixture Docs\nnav:\n  - Home: index.md\n  - Guide: guide.md\n");
write(`${docs}/docs/index.md`, '# Home\n\nWelcome.\n');
write(`${docs}/docs/guide.md`, '# Guide\n\n## Getting started\n\nRead this first.\n\n## Configuration\n\nEdit mkdocs.yml.\n');
write(`${docs}/docs/reference.md`, '# Reference\n\nAPI details.\n');

console.log('Wrote v1.0 fixtures under', root);
