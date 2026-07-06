import { describe, it, expect } from 'vitest';
import { evaluate, parsePatterns, changedContentLines } from './allowlist';

// Mirrors the extension caller config.
const versionLine = parsePatterns('^version=[0-9]+\\.[0-9]+\\.[0-9]+(-SNAPSHOT|-beta)?$');
const gradleProps = parsePatterns('^gradle\\.properties$');

// Mirrors the azure caller config (both semver defaultValues allowed).
const azurePaths = parsePatterns(
  '^gradle\\.properties$\n^arm-quickstart-templates/hivemq-vm-cluster/azuredeploy\\.json$',
);
const azureLines = parsePatterns(
  '^version=[0-9]+\\.[0-9]+\\.[0-9]+(-SNAPSHOT|-beta)?$\n^\\s*"defaultValue": "[0-9]+\\.[0-9]+\\.[0-9]+(-beta)?",?$',
);

function bump(from: string, to: string): string {
  return `@@ -1,1 +1,1 @@\n-version=${from}\n+version=${to}`;
}

describe('changedContentLines', () => {
  it('returns only added/removed content, stripping the +/- marker', () => {
    expect(changedContentLines(bump('1.0.0', '1.0.1'))).toEqual(['version=1.0.0', 'version=1.0.1']);
  });

  it('does not treat a content line "++ foo" as a header (bug #2)', () => {
    // A genuine added line whose content is "++ foo" arrives as "+" + "++ foo".
    const patch = '@@ -1,1 +1,2 @@\n version=1.0.1\n+++ foo';
    expect(changedContentLines(patch)).toEqual(['++ foo']);
  });

  it('skips hunk headers and no-newline markers', () => {
    const patch = '@@ -1 +1 @@\n-version=1.0.0\n+version=1.0.1\n\\ No newline at end of file';
    expect(changedContentLines(patch)).toEqual(['version=1.0.0', 'version=1.0.1']);
  });
});

describe('evaluate: extension release PR', () => {
  const opts = { allowedPaths: gradleProps, allowedLines: versionLine };

  it('approves a pure version bump', () => {
    const r = evaluate([{ filename: 'gradle.properties', patch: bump('1.1.4', '1.1.5') }], opts);
    expect(r.eligible).toBe(true);
  });

  it('approves a -beta bump', () => {
    const r = evaluate([{ filename: 'gradle.properties', patch: bump('1.1.5-beta', '1.1.6-beta') }], opts);
    expect(r.eligible).toBe(true);
  });

  it('rejects a version bump with a sneaky extra added line', () => {
    const patch = '@@ -1,1 +1,2 @@\n-version=1.0.0\n+version=1.0.1\n+++ hello';
    const r = evaluate([{ filename: 'gradle.properties', patch }], opts);
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(' ')).toContain('++ hello');
  });

  it('rejects a change to a disallowed file', () => {
    const r = evaluate(
      [{ filename: 'build.gradle', patch: '@@ -1 +1 @@\n-a\n+b' }],
      opts,
    );
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(' ')).toContain('disallowed file: build.gradle');
  });

  it('rejects a non-version line change in the allowed file', () => {
    const patch = '@@ -1 +1 @@\n-org.gradle.parallel=true\n+org.gradle.parallel=false';
    const r = evaluate([{ filename: 'gradle.properties', patch }], opts);
    expect(r.eligible).toBe(false);
  });

  it('rejects an empty changeset', () => {
    expect(evaluate([], opts).eligible).toBe(false);
  });
});

describe('evaluate: azure (two semver defaultValues allowed)', () => {
  const opts = { allowedPaths: azurePaths, allowedLines: azureLines };
  const json = 'arm-quickstart-templates/hivemq-vm-cluster/azuredeploy.json';

  it('approves the extension version defaultValue bump', () => {
    const patch = '@@ -46,3 +46,3 @@\n-      "defaultValue": "1.3.5",\n+      "defaultValue": "1.3.6",';
    const r = evaluate([{ filename: json, patch }], opts);
    expect(r.eligible).toBe(true);
  });

  it('approves the hivemq version defaultValue bump', () => {
    const patch = '@@ -39,3 +39,3 @@\n-      "defaultValue": "4.52.0",\n+      "defaultValue": "4.53.0",';
    const r = evaluate([{ filename: json, patch }], opts);
    expect(r.eligible).toBe(true);
  });

  it('rejects a non-semver defaultValue change (e.g. vmSize)', () => {
    const patch = '@@ -32,3 +32,3 @@\n-      "defaultValue": "Standard_F4s_v2",\n+      "defaultValue": "Standard_F8s_v2",';
    const r = evaluate([{ filename: json, patch }], opts);
    expect(r.eligible).toBe(false);
  });
});

describe('evaluate: path-only mode (line gate disabled)', () => {
  const opts = {
    allowedPaths: parsePatterns('^generated/version-info\\.json$\n^releases/.+\\.md$'),
    allowedLines: [],
  };

  it('approves when all files match, regardless of line content', () => {
    const r = evaluate(
      [{ filename: 'generated/version-info.json', patch: '@@ -1 +1 @@\n-x\n+y' }],
      opts,
    );
    expect(r.eligible).toBe(true);
  });

  it('rejects when a file is outside the path allowlist', () => {
    const r = evaluate([{ filename: 'app/secret.ts', patch: '@@ -1 +1 @@\n-x\n+y' }], opts);
    expect(r.eligible).toBe(false);
  });
});

describe('evaluate: binary/no-patch file under an active line gate', () => {
  it('rejects a file that has no diff to verify', () => {
    const opts = { allowedPaths: gradleProps, allowedLines: versionLine };
    const r = evaluate([{ filename: 'gradle.properties', patch: undefined }], opts);
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(' ')).toContain('no diff available');
  });
});
