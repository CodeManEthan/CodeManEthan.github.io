// Shared island metadata: real lines of code measured from each repo, and the
// gem palette that colors each project's island in the archipelago scene.
// GEM_COLORS is index-matched to projects sorted by `order` frontmatter.

export const LOC: Record<string, number> = {
  'finance-tracker': 67732,
  kdoitall: 26417,
  'project-hub': 19609,
  docist: 18087,
  ludicrous: 4206,
  'one-record-many-bells': 2330,
  genesis: 57208,
};

export const GEM_COLORS = [
  '#ef7f93',
  '#f5a25d',
  '#f0c75e',
  '#6cc4d9',
  '#9b8fe8',
  '#63c9a8',
  '#e98fc3',
];

export function fmtLoc(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

export function sizeLabel(n: number): string {
  if (n >= 25000) return 'large island';
  if (n >= 10000) return 'mid-size island';
  if (n >= 3000) return 'small island';
  return 'tiny island';
}
