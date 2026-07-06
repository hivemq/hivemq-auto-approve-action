import { describe, it, expect } from 'vitest';
import { evaluate, parseAllowedChanges, changedContentLines, type AllowedChange } from './allowlist';

// Standard OS extension rule: plain-semver version line in gradle.properties.
const extRules: AllowedChange[] = [
  { path: /^gradle\.properties$/, lines: /^version=[0-9]+\.[0-9]+\.[0-9]+$/ },
];

// sparkplug-influxdb rule: version line that also permits a -beta suffix.
const sparkplugRules: AllowedChange[] = [
  { path: /^gradle\.properties$/, lines: /^version=[0-9]+\.[0-9]+\.[0-9]+(-beta)?$/ },
];

// Azure rules: version line in gradle.properties, semver defaultValue in the ARM template.
const azureRules: AllowedChange[] = [
  { path: /^gradle\.properties$/, lines: /^version=[0-9]+\.[0-9]+\.[0-9]+$/ },
  {
    path: /^arm-quickstart-templates\/hivemq-vm-cluster\/azuredeploy\.json$/,
    lines: /^\s*"defaultValue": "[0-9]+\.[0-9]+\.[0-9]+",?$/,
  },
];

function bump(from: string, to: string): string {
  return `@@ -1,1 +1,1 @@\n-version=${from}\n+version=${to}`;
}
function defaultValueBump(from: string, to: string): string {
  return `@@ -46,3 +46,3 @@\n-      "defaultValue": "${from}",\n+      "defaultValue": "${to}",`;
}
const AZURE_JSON = 'arm-quickstart-templates/hivemq-vm-cluster/azuredeploy.json';

describe('parseAllowedChanges', () => {
  it('parses a list of path+lines rules', () => {
    const rules = parseAllowedChanges("- path: '^gradle\\.properties$'\n  lines: '^version=.*$'");
    expect(rules).toHaveLength(1);
    expect(rules[0].path.source).toBe('^gradle\\.properties$');
    expect(rules[0].lines?.source).toBe('^version=.*$');
  });

  it('allows a path-only rule (lines omitted)', () => {
    const rules = parseAllowedChanges("- path: '^docs/.*$'");
    expect(rules[0].lines).toBeUndefined();
  });

  it('throws on an empty list', () => {
    expect(() => parseAllowedChanges('[]')).toThrow(/non-empty/);
  });

  it('throws when path is missing', () => {
    expect(() => parseAllowedChanges("- lines: '^x$'")).toThrow(/path is required/);
  });

  it('parses a quoted lines pattern containing a colon', () => {
    const rules = parseAllowedChanges("- path: '^a\\.json$'\n  lines: '^\\s*\"defaultValue\": \"[0-9.]+\",?$'");
    expect(rules[0].lines?.test('      "defaultValue": "1.2.3",')).toBe(true);
  });
});

describe('changedContentLines', () => {
  it('returns only added/removed content, stripping the +/- marker', () => {
    expect(changedContentLines(bump('1.0.0', '1.0.1'))).toEqual(['version=1.0.0', 'version=1.0.1']);
  });

  it('does not treat a content line "++ foo" as a header', () => {
    expect(changedContentLines('@@ -1,1 +1,2 @@\n version=1.0.1\n+++ foo')).toEqual(['++ foo']);
  });

  it('skips hunk headers and no-newline markers', () => {
    expect(changedContentLines('@@ -1 +1 @@\n-version=1.0.0\n+version=1.0.1\n\\ No newline at end of file'))
      .toEqual(['version=1.0.0', 'version=1.0.1']);
  });
});

describe('evaluate: extension release PR', () => {
  it('approves a pure version bump', () => {
    expect(evaluate([{ filename: 'gradle.properties', patch: bump('1.1.4', '1.1.5') }], extRules).eligible).toBe(true);
  });

  it('rejects a -beta bump under the standard rule', () => {
    expect(evaluate([{ filename: 'gradle.properties', patch: bump('1.1.5-beta', '1.1.6-beta') }], extRules).eligible).toBe(false);
  });

  it('approves a -beta bump under the sparkplug rule', () => {
    expect(evaluate([{ filename: 'gradle.properties', patch: bump('1.1.5-beta', '1.1.6-beta') }], sparkplugRules).eligible).toBe(true);
  });

  it('rejects a version bump with a sneaky extra added line', () => {
    const patch = '@@ -1,1 +1,2 @@\n-version=1.0.0\n+version=1.0.1\n+++ hello';
    const r = evaluate([{ filename: 'gradle.properties', patch }], extRules);
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(' ')).toContain('++ hello');
  });

  it('rejects a change to a disallowed file', () => {
    const r = evaluate([{ filename: 'build.gradle', patch: '@@ -1 +1 @@\n-a\n+b' }], extRules);
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(' ')).toContain('disallowed file: build.gradle');
  });

  it('rejects a non-version line change in the allowed file', () => {
    const patch = '@@ -1 +1 @@\n-org.gradle.parallel=true\n+org.gradle.parallel=false';
    expect(evaluate([{ filename: 'gradle.properties', patch }], extRules).eligible).toBe(false);
  });

  it('rejects an empty changeset', () => {
    expect(evaluate([], extRules).eligible).toBe(false);
  });
});

describe('evaluate: azure paired rules', () => {
  it('approves a version bump in gradle.properties', () => {
    expect(evaluate([{ filename: 'gradle.properties', patch: bump('1.3.5', '1.3.6') }], azureRules).eligible).toBe(true);
  });

  it('approves a defaultValue bump in the ARM template', () => {
    expect(evaluate([{ filename: AZURE_JSON, patch: defaultValueBump('1.3.5', '1.3.6') }], azureRules).eligible).toBe(true);
  });

  it('approves both files changed together', () => {
    const files = [
      { filename: 'gradle.properties', patch: bump('1.3.5', '1.3.6') },
      { filename: AZURE_JSON, patch: defaultValueBump('1.3.5', '1.3.6') },
    ];
    expect(evaluate(files, azureRules).eligible).toBe(true);
  });

  it('rejects a version= line inside the ARM template (cross-change)', () => {
    const patch = '@@ -1 +1 @@\n-version=1.3.5\n+version=1.3.6';
    const r = evaluate([{ filename: AZURE_JSON, patch }], azureRules);
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(' ')).toContain('disallowed changed line');
  });

  it('rejects a defaultValue line inside gradle.properties (cross-change)', () => {
    const patch = '@@ -1 +1 @@\n-      "defaultValue": "1.3.5",\n+      "defaultValue": "1.3.6",';
    const r = evaluate([{ filename: 'gradle.properties', patch }], azureRules);
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(' ')).toContain('disallowed changed line');
  });

  it('rejects a non-semver defaultValue change', () => {
    const patch = defaultValueBump('Standard_F4s_v2', 'Standard_F8s_v2');
    expect(evaluate([{ filename: AZURE_JSON, patch }], azureRules).eligible).toBe(false);
  });
});

describe('evaluate: path-only rule (no lines)', () => {
  const rules: AllowedChange[] = [{ path: /^generated\/version-info\.json$/ }];

  it('approves any change confined to the path', () => {
    expect(evaluate([{ filename: 'generated/version-info.json', patch: '@@ -1 +1 @@\n-x\n+y' }], rules).eligible).toBe(true);
  });

  it('rejects a file outside the path', () => {
    expect(evaluate([{ filename: 'app/secret.ts', patch: '@@ -1 +1 @@\n-x\n+y' }], rules).eligible).toBe(false);
  });
});

describe('evaluate: binary/no-patch file under a line rule', () => {
  it('rejects a file with no diff to verify', () => {
    const r = evaluate([{ filename: 'gradle.properties', patch: undefined }], extRules);
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(' ')).toContain('no diff available');
  });
});
