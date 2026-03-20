const DEFAULT_PRESET = 'balanced';

const DEFAULT_BUDGET = {
  maxPreviewLines: 12,
  maxTreeDepth: 3,
  maxTreeEntries: 40,
  maxJsonItems: 8,
  maxCsvRows: 8,
  maxJsonNodes: 4000,
  maxJsonWalkDepth: 28,
};

const PRESET_BUDGETS = {
  balanced: {},
  agent: {
    maxPreviewLines: 10,
    maxTreeDepth: 4,
    maxTreeEntries: 60,
    maxJsonItems: 10,
    maxCsvRows: 6,
    maxJsonNodes: 5000,
    maxJsonWalkDepth: 24,
  },
  triage: {
    maxPreviewLines: 8,
    maxTreeDepth: 3,
    maxTreeEntries: 45,
    maxJsonItems: 8,
    maxCsvRows: 5,
    maxJsonNodes: 3200,
    maxJsonWalkDepth: 18,
  },
  aggressive: {
    maxPreviewLines: 6,
    maxTreeDepth: 2,
    maxTreeEntries: 28,
    maxJsonItems: 5,
    maxCsvRows: 4,
    maxJsonNodes: 1800,
    maxJsonWalkDepth: 12,
  },
  schema: {
    maxPreviewLines: 10,
    maxTreeDepth: 3,
    maxTreeEntries: 40,
    maxJsonItems: 14,
    maxCsvRows: 6,
    maxJsonNodes: 7000,
    maxJsonWalkDepth: 36,
  },
};

function clampInt(n, min, max) {
  const x = Number.parseInt(String(n), 10);
  if (!Number.isFinite(x)) return min;
  return Math.min(max, Math.max(min, x));
}

function normalizePresetName(name) {
  if (!name) return DEFAULT_PRESET;
  const key = String(name).trim().toLowerCase();
  return PRESET_BUDGETS[key] ? key : DEFAULT_PRESET;
}

/**
 * @param {Partial<typeof DEFAULT_BUDGET>} [overrides]
 * @param {{ maxLines?: number; maxDepth?: number; jsonDepth?: number; budget?: number; preset?: string }} [cli]
 */
function resolveBudget(overrides = {}, cli = {}) {
  const preset = normalizePresetName(cli.preset || overrides.preset);
  const b = { ...DEFAULT_BUDGET, ...(PRESET_BUDGETS[preset] || {}), ...overrides };
  if (cli.maxLines != null) {
    b.maxPreviewLines = clampInt(cli.maxLines, 1, 500);
    b.maxCsvRows = clampInt(cli.maxLines, 1, 500);
  }
  if (cli.maxDepth != null) {
    b.maxTreeDepth = clampInt(cli.maxDepth, 0, 64);
  }
  if (cli.jsonDepth != null) {
    b.maxJsonWalkDepth = clampInt(cli.jsonDepth, 1, 256);
  }
  if (cli.budget != null) {
    const B = clampInt(cli.budget, 10, 100_000);
    b.maxTreeEntries = B;
    b.maxJsonNodes = clampInt(B * 80, 100, 500_000);
    b.maxCsvRows = Math.min(b.maxCsvRows, clampInt(Math.floor(B / 4), 1, 500));
  }
  return b;
}

function summarizeBudget(budget) {
  return [
    `preview=${budget.maxPreviewLines}`,
    `tree=${budget.maxTreeDepth}/${budget.maxTreeEntries}`,
    `json=${budget.maxJsonWalkDepth}/${budget.maxJsonNodes}`,
    `csv=${budget.maxCsvRows}`,
  ].join(' ');
}

module.exports = {
  DEFAULT_PRESET,
  DEFAULT_BUDGET,
  PRESET_BUDGETS,
  resolveBudget,
  summarizeBudget,
  normalizePresetName,
  clampInt,
};
