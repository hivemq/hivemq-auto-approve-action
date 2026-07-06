# HiveMQ Auto-approve Release PRs Action

Auto-approves narrow, machine-generated release pull requests so they can merge without a manual review and without disabling branch protection. A PR is approved only when **both** hold:

1. The PR author is an **active member** of a configured GitHub team.
2. Every changed **file** matches an `allowed-paths` pattern (optional) **and** every added/removed **line** matches an `allowed-lines` pattern (optional).

If a previously-eligible PR stops meeting the criteria (e.g. a new push adds an out-of-scope change), the action **dismisses** its own stale approval.

The approval is performed by the identity of the supplied `github-token` (a service account), which is distinct from the PR author, so it satisfies a "require 1 approving review" branch-protection rule without self-approval.

## Usage

```yaml
name: Auto-approve Release PRs
on:
  pull_request:
    types: ['opened', 'reopened', 'edited', 'synchronize']
    branches: [master]
permissions: {}
jobs:
  auto-approve:
    runs-on: ubuntu-latest
    if: github.event.pull_request.head.repo.full_name == github.repository
    steps:
      - uses: hivemq/hivemq-auto-approve-action@v1
        with:
          allowed-team: hivemq-team-pd
          allowed-paths: |
            ^gradle\.properties$
          allowed-lines: |
            ^version=[0-9]+\.[0-9]+\.[0-9]+(-SNAPSHOT|-beta)?$
          github-token: ${{ secrets.JENKINS_GITHUB_TOKEN }}
          reviewer-login: ${{ secrets.JENKINS_GITHUB_USERNAME }}
```

A complete caller, including the `status` aggregator job used as the required branch-protection check, is in [`examples/auto-approve.yml`](examples/auto-approve.yml).

## Inputs

| Input | Required | Description |
|---|---|---|
| `allowed-team` | yes | Team slug in the repository owner org. Only active members are eligible. |
| `allowed-paths` | no | Newline-separated anchored **JS** regexes. Every changed file must match one. Empty disables the path gate. |
| `allowed-lines` | no | Newline-separated anchored **JS** regexes. Every added/removed line must match one. Empty disables the line gate. |
| `github-token` | yes | Token whose identity approves/dismisses. Needs `pull-requests: write`. |
| `reviewer-login` | yes | Login of the `github-token` owner; used to find and dismiss its own prior approvals. |

### Output

| Output | Description |
|---|---|
| `eligible` | `"true"` if approved, otherwise `"false"`. |

> **Regex dialect:** patterns are JavaScript `RegExp`. Use `\s`, not the POSIX `[[:space:]]`.

## Configuration examples

Single version file, line-scoped (OS extensions):

```yaml
allowed-paths: |
  ^gradle\.properties$
allowed-lines: |
  ^version=[0-9]+\.[0-9]+\.[0-9]+(-SNAPSHOT|-beta)?$
```

Two files, two version lines (azure-cluster-discovery: `gradle.properties` + the ARM template's semver `defaultValue`s):

```yaml
allowed-paths: |
  ^gradle\.properties$
  ^arm-quickstart-templates/hivemq-vm-cluster/azuredeploy\.json$
allowed-lines: |
  ^version=[0-9]+\.[0-9]+\.[0-9]+(-SNAPSHOT|-beta)?$
  ^\s*"defaultValue": "[0-9]+\.[0-9]+\.[0-9]+(-beta)?",?$
```

Path-only, no line gate (approve any change confined to generated release files):

```yaml
allowed-paths: |
  ^generated/version-info\.json$
  ^releases/.+\.md$
# allowed-lines omitted -> line gate disabled
```

## Security notes

- The action reads the diff via the GitHub API `pulls.listFiles[].patch`, which contains only hunk headers and changed lines (no file headers), so diff structure is never string-matched. There is no shell interpolation of PR-controlled data.
- Keep `allowed-lines` anchored (`^`…`$`). Loosening the anchors widens what can be auto-approved.
- The `github-token` should belong to a service account with only `pull-requests: write`; it must not be the PR author.

## Development

```bash
npm ci
npm run typecheck
npm test          # adversarial fixtures (version bump ok; extra line rejected; azure cases; ...)
npm run build     # bundles src/ -> dist/index.js via @vercel/ncc
```

`dist/` is a committed bundle: GitHub runs `dist/index.js` directly at the referenced tag. CI fails if `dist/` is out of sync with `src/`. Renovate rebuilds `dist/` inside dependency-bump PRs via `postUpgradeTasks`.

## Releasing

Push a `vX.Y.Z` tag. The `Release` workflow creates the GitHub release and moves the floating `vX` major tag to it. Consumers pin `@vN` (or a commit SHA, which Renovate can bump).
