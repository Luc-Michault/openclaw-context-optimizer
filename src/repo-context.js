/**
 * Repo-level context for policy + smart-tree (v0.9).
 * Split into small phases — avoid one growing blob.
 */

const fs = require('fs');
const path = require('path');

const ROOT_MARKER_NAMES = [
  '.git',
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'npm-shrinkwrap.json',
  'Cargo.toml',
  'Cargo.lock',
  'go.mod',
  'go.sum',
  'pyproject.toml',
  'setup.py',
  'poetry.lock',
  'README.md',
  'AGENTS.md',
  'openclaw.json',
  'openclaw.plugin.json',
  'pnpm-workspace.yaml',
  'lerna.json',
  'nx.json',
  'turbo.json',
];

/** Phase A — filesystem markers at repo root */
function collectRootMarkers(repoRoot) {
  return ROOT_MARKER_NAMES.filter((n) => {
    try {
      return fs.existsSync(path.join(repoRoot, n));
    } catch {
      return false;
    }
  }).sort((a, b) => a.localeCompare(b));
}

/** Phase B — coarse stack from markers */
function inferStacks(markers) {
  const stacks = [];
  if (markers.includes('package.json')) stacks.push('node');
  if (markers.includes('Cargo.toml')) stacks.push('rust');
  if (markers.includes('go.mod')) stacks.push('go');
  if (markers.includes('pyproject.toml') || markers.includes('setup.py')) stacks.push('python');
  return stacks.sort((a, b) => a.localeCompare(b));
}

/** Phase C — npm package.json shape (single read) */
function inferFromPackageJson(pkg) {
  const inferences = [];
  if (!pkg || typeof pkg !== 'object') return inferences;
  if (pkg.bin) inferences.push('node:declares-bin');
  if (pkg.private === true) inferences.push('npm:private-package');
  else if (typeof pkg.name === 'string' && pkg.name.trim()) {
    inferences.push('npm:non-private-manifest');
  }
  if (!pkg.bin && (pkg.main || pkg.module || pkg.exports)) inferences.push('node:has-entry-fields');
  return inferences;
}

/** Phase D — monorepo / workspace signals */
function inferMonorepo(repoRoot, markers, pkg) {
  const inferences = [];
  if (markers.includes('pnpm-workspace.yaml') || markers.includes('lerna.json') || markers.includes('nx.json')) {
    inferences.push('monorepo:workspace-root-files');
  }
  if (markers.includes('turbo.json')) inferences.push('monorepo:turborepo');
  if (pkg && typeof pkg === 'object') {
    if (pkg.workspaces) inferences.push('monorepo:npm-workspaces');
  }
  const cargoPath = path.join(repoRoot, 'Cargo.toml');
  if (fs.existsSync(cargoPath)) {
    try {
      const raw = fs.readFileSync(cargoPath, 'utf8').slice(0, 32_768);
      if (/^\[workspace\]/m.test(raw) || /\bmembers\s*=\s*\[/m.test(raw)) {
        inferences.push('monorepo:cargo-workspace');
      }
    } catch {
      /* ignore */
    }
  }
  if (pkg && pkg.repository && typeof pkg.repository === 'object' && pkg.repository.directory) {
    inferences.push('monorepo:npm-repo-subdir');
  }
  const pyPath = path.join(repoRoot, 'pyproject.toml');
  if (fs.existsSync(pyPath)) {
    try {
      const raw = fs.readFileSync(pyPath, 'utf8').slice(0, 48_000);
      if (
        /\[tool\.uv\.workspace\]/m.test(raw) ||
        /\[tool\.poetry\.packages\]/m.test(raw) ||
        /\[tool\.hatch\]/m.test(raw) ||
        /^packages\s*=\s*\[/m.test(raw)
      ) {
        inferences.push('monorepo:pyproject-workspace-hint');
      }
    } catch {
      /* ignore */
    }
  }
  return inferences;
}

/** Phase E — OpenClaw-adjacent */
function inferOpenClaw(markers) {
  const inferences = [];
  if (markers.some((m) => /openclaw/i.test(m))) inferences.push('openclaw:extension-or-config');
  return inferences;
}

/** Phase F — primary language / layout hints from markers only */
function inferLayoutFromMarkers(markers) {
  const inferences = [];
  if (markers.includes('Cargo.toml') && !markers.includes('package.json')) inferences.push('project:rust-primary');
  if (markers.includes('go.mod') && !markers.includes('package.json')) inferences.push('project:go-primary');
  return inferences;
}

function readPackageJson(repoRoot) {
  const pkgPath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8').slice(0, 65536));
  } catch {
    return null;
  }
}

/**
 * @returns {{ markers: string[], stacks: string[], openclawAdjacent: boolean, inferences: string[] }}
 */
function gatherRepoContext(repoRoot) {
  const empty = { markers: [], stacks: [], openclawAdjacent: false, inferences: [] };
  if (!repoRoot) return empty;
  try {
    if (!fs.existsSync(repoRoot) || !fs.statSync(repoRoot).isDirectory()) return empty;
  } catch {
    return empty;
  }

  const markers = collectRootMarkers(repoRoot);
  const stacks = inferStacks(markers);
  const openclawAdjacent = markers.some((m) => /openclaw/i.test(m));
  const pkg = readPackageJson(repoRoot);

  const inferences = [
    ...inferLayoutFromMarkers(markers),
    ...inferFromPackageJson(pkg),
    ...inferMonorepo(repoRoot, markers, pkg),
    ...inferOpenClaw(markers),
  ];

  return {
    markers,
    stacks,
    openclawAdjacent,
    inferences: [...new Set(inferences)].sort((a, b) => a.localeCompare(b)),
  };
}

module.exports = {
  gatherRepoContext,
  collectRootMarkers,
  inferStacks,
  readPackageJson,
};
