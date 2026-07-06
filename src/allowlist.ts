// Pure, side-effect-free eligibility logic. Kept separate from the GitHub glue
// in main.ts so it can be unit-tested over adversarial diff fixtures.

export interface ChangedFile {
  filename: string;
  // Unified-diff hunks as returned by the GitHub API `pulls.listFiles[].patch`.
  // This contains only hunk headers (`@@`), context lines (` `), and changed
  // lines (`+`/`-`). It does NOT contain file headers (`+++`/`--- a/`), so no
  // header-skipping heuristics are needed and a content line such as `++ foo`
  // (which appears as `+++ foo` in a raw diff) is here `+` + `++ foo` and is
  // correctly treated as a changed line, not a header.
  patch?: string;
}

export interface AllowlistOptions {
  allowedPaths: RegExp[]; // empty => path gate disabled
  allowedLines: RegExp[]; // empty => line gate disabled
}

export interface Evaluation {
  eligible: boolean;
  reasons: string[]; // human-readable reasons the PR is NOT eligible; empty when eligible
}

// Parse a newline-separated multiline input into anchored RegExp objects.
// Blank lines are ignored. Patterns are used verbatim (author supplies anchors).
export function parsePatterns(input: string): RegExp[] {
  return input
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((p) => new RegExp(p));
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

export function evaluate(files: ChangedFile[], opts: AllowlistOptions): Evaluation {
  const reasons: string[] = [];
  const { allowedPaths, allowedLines } = opts;

  if (files.length === 0) {
    reasons.push('no files changed');
  }

  // Gate 1: every changed file must match an allowed-path pattern.
  if (allowedPaths.length > 0) {
    for (const f of files) {
      if (!allowedPaths.some((re) => re.test(f.filename))) {
        reasons.push(`disallowed file: ${f.filename}`);
      }
    }
  }

  // Gate 2: every added/removed line must match an allowed-line pattern.
  if (allowedLines.length > 0) {
    let hadChange = false;
    for (const f of files) {
      if (f.patch === undefined) {
        // Binary or otherwise diff-less file while the line gate is active:
        // we cannot verify its contents, so it is not eligible.
        reasons.push(`no diff available to verify file: ${f.filename}`);
        continue;
      }
      for (const content of changedContentLines(f.patch)) {
        hadChange = true;
        if (!allowedLines.some((re) => re.test(content))) {
          reasons.push(`disallowed changed line: ${content}`);
        }
      }
    }
    if (!hadChange) {
      reasons.push('no changed lines to verify');
    }
  }

  return { eligible: reasons.length === 0, reasons };
}
