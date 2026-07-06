import yaml from 'js-yaml';

// Pure, side-effect-free eligibility logic. Kept separate from the GitHub glue
// in main.ts so it can be unit-tested over adversarial diff fixtures.

export interface ChangedFile {
  filename: string;
  // Unified-diff hunks as returned by the GitHub API `pulls.listFiles[].patch`:
  // hunk headers (`@@`), context lines (` `), and changed lines (`+`/`-`) only,
  // no file headers (`+++`/`--- a/`).
  patch?: string;
}

// One allowlist rule: a file path pattern, and optionally a line pattern that
// every changed line in a matching file must satisfy. path is mandatory; lines
// is optional (omit to allow any change confined to that path).
export interface AllowedChange {
  path: RegExp;
  lines?: RegExp;
}

export interface Evaluation {
  eligible: boolean;
  reasons: string[]; // why the PR is NOT eligible; empty when eligible
}

// Parse the `allowed-changes` input (a YAML list of { path, lines? }) into rules.
// Throws on an empty list or a missing/invalid path.
export function parseAllowedChanges(input: string): AllowedChange[] {
  const parsed = yaml.load(input);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('allowed-changes must be a non-empty YAML list of { path, lines? }');
  }
  return parsed.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`allowed-changes[${i}] must be a mapping with a 'path'`);
    }
    const { path, lines } = entry as Record<string, unknown>;
    if (typeof path !== 'string' || path.length === 0) {
      throw new Error(`allowed-changes[${i}].path is required and must be a string`);
    }
    if (lines !== undefined && typeof lines !== 'string') {
      throw new Error(`allowed-changes[${i}].lines must be a string when present`);
    }
    return { path: new RegExp(path), lines: lines === undefined ? undefined : new RegExp(lines) };
  });
}

// Extract the content of every added/removed line from a GitHub file patch.
// Only `@@` hunk headers and `\ No newline at end of file` markers are skipped.
export function changedContentLines(patch: string): string[] {
  const out: string[] = [];
  for (const line of patch.split('\n')) {
    if (line.length === 0) continue;
    if (line.startsWith('@@')) continue; // hunk header
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    if (line.startsWith('+') || line.startsWith('-')) {
      out.push(line.slice(1));
    }
  }
  return out;
}

export function evaluate(files: ChangedFile[], rules: AllowedChange[]): Evaluation {
  const reasons: string[] = [];

  if (files.length === 0) {
    reasons.push('no files changed');
  }

  for (const f of files) {
    // First rule whose path matches owns this file (and its line constraint).
    const rule = rules.find((r) => r.path.test(f.filename));
    if (!rule) {
      reasons.push(`disallowed file: ${f.filename}`);
      continue;
    }
    if (rule.lines === undefined) {
      continue; // path-only rule: any change confined to this path is allowed
    }
    if (f.patch === undefined) {
      // Binary or diff-less file while a line rule applies: cannot verify.
      reasons.push(`no diff available to verify file: ${f.filename}`);
      continue;
    }
    const changed = changedContentLines(f.patch);
    if (changed.length === 0) {
      reasons.push(`no changed lines to verify in ${f.filename}`);
      continue;
    }
    for (const content of changed) {
      if (!rule.lines.test(content)) {
        reasons.push(`disallowed changed line in ${f.filename}: ${content}`);
      }
    }
  }

  return { eligible: reasons.length === 0, reasons };
}
