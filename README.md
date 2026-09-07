# HiveMQ Auto-approve Release PRs Action

Auto-approves narrow, machine-generated release pull requests so they can merge without a manual review and without disabling branch protection. A PR is approved only when **both** hold:

1. The PR author is an **active member** of a configured GitHub team.
2. Every changed **file** matches one `allowed-changes` rule by `path`, and every added/removed **line** in that file matches the same rule's `lines` pattern (when the rule has one).

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
          allowed-changes: |
            - path: '^gradle\.properties$'
              lines: '^version=[0-9]+\.[0-9]+\.[0-9]+$'
          github-token: ${{ secrets.JENKINS_GITHUB_TOKEN }}
          reviewer-login: ${{ secrets.JENKINS_GITHUB_USERNAME }}
```

A complete caller, including the `status` aggregator job used as the required branch-protection check, is in [`examples/auto-approve.yml`](examples/auto-approve.yml).

## Inputs

| Input | Required | Description |
|---|---|---|
| `allowed-team` | yes | Team slug in the repository owner org. Only active members are eligible. |
| `allowed-changes` | yes | YAML list of rules `{ path: <regex>, lines?: <regex> }`. At least one rule; `path` is mandatory, `lines` optional. Every changed file must match one rule by `path`; if that rule has `lines`, every added/removed line in the file must match it. |
| `github-token` | yes | Token whose identity approves/dismisses. Needs `pull-requests: write`. |
| `reviewer-login` | yes | Login of the `github-token` owner; used to find and dismiss its own prior approvals. |
| `dismiss-stale` | no (default `true`) | Whether an ineligible verdict dismisses this reviewer's earlier approvals. Set to `false` for every step but the last when a job chains several policies. See [Chaining several policies](#chaining-several-policies). |

### Output

| Output | Description |
|---|---|
| `eligible` | `"true"` if approved, otherwise `"false"`. |

## Configuration examples

Single-quote the `path`/`lines` values: a regex can contain YAML-special characters (`:`, `#`, `[`), and a `: ` inside an unquoted scalar is a parse error.

Single version file, line-scoped (OS extensions):

```yaml
allowed-changes: |
  - path: '^gradle\.properties$'
    lines: '^version=[0-9]+\.[0-9]+\.[0-9]+$'
```

Two files, each with its own line pattern (azure-cluster-discovery: the version in `gradle.properties` and the semver `defaultValue` in the ARM template):

```yaml
allowed-changes: |
  - path: '^gradle\.properties$'
    lines: '^version=[0-9]+\.[0-9]+\.[0-9]+$'
  - path: '^arm-quickstart-templates/hivemq-vm-cluster/azuredeploy\.json$'
    lines: '^\s*"defaultValue": "[0-9]+\.[0-9]+\.[0-9]+",?$'
```

Path-only rule, any change confined to the path (omit `lines`):

```yaml
allowed-changes: |
  - path: '^generated/version-info\.json$'
  - path: '^releases/.+\.md$'
```

## Chaining several policies

A repository can grant different teams different scopes by running the action once per policy in the same job. All steps share one `reviewer-login`, so an ineligible step would otherwise dismiss the approval another step just granted. Two rules make a chain behave:

1. Every step except the last sets `dismiss-stale: false`.
2. Gate each step on the previous one not having approved, and let the last step be the one that dismisses. That last step must not carry a condition of its own (a branch filter, for example), because a skipped step cannot dismiss and a stale approval would survive.

```yaml
steps:
  # Policy A, restricted to some branches, so it cannot be the dismissing step.
  - id: policy-a
    if: github.event.pull_request.base.ref != 'protected-branch'
    uses: hivemq/hivemq-auto-approve-action@v1
    with:
      allowed-team: team-a
      allowed-changes: |
        - path: '^docs/.+\.md$'
      dismiss-stale: false
      github-token: ${{ secrets.SERVICE_ACCOUNT_TOKEN }}
      reviewer-login: ${{ secrets.SERVICE_ACCOUNT_LOGIN }}

  # Policy B, last step, so it dismisses. Its only condition is the gate on the
  # step above, so it runs whenever that step did not approve.
  - if: steps.policy-a.outputs.eligible != 'true'
    uses: hivemq/hivemq-auto-approve-action@v1
    with:
      allowed-team: team-b
      allowed-changes: |
        - path: '^generated/version\.json$'
      github-token: ${{ secrets.SERVICE_ACCOUNT_TOKEN }}
      reviewer-login: ${{ secrets.SERVICE_ACCOUNT_LOGIN }}
```

Order the steps so that the one with a branch filter comes first. On `protected-branch` policy A is skipped, its `eligible` output is empty, the gate passes, and policy B still evaluates and still dismisses. Reverse the two and a PR on that branch that stops qualifying keeps its approval, because the only step that could have dismissed it never ran.

## Security notes

- Patterns are JavaScript `RegExp`. Use `\s`, not the POSIX `[[:space:]]`.
- Keep `lines` patterns anchored (`^`…`$`). Loosening the anchors widens what can be auto-approved.
- The `github-token` should belong to a service account with only `pull-requests: write`; it must not be the PR author.

## Development

```bash
npm ci
npm run typecheck
npm test          # adversarial fixtures (version bump ok; extra line rejected; azure cases; ...)
npm run build     # bundles src/ -> dist/index.js via @vercel/ncc
```

`dist/` is a committed bundle: GitHub runs `dist/index.js` directly at the referenced tag. It is refreshed at release time (see below), not on every PR, so `test.yml` only typechecks, tests, and builds. Between releases `dist/` on `main` may lag `src/`; that is fine because consumers use tagged releases, not `main`.

## Releasing

Releases are cut by hand. Pushing to `main` requires being a bypass actor on the branch ruleset.

1. Refresh the bundle and commit it:
   ```bash
   npm ci && npm run build
   git add dist && git commit -m "Release vX.Y.Z"
   ```
2. Tag and push:
   ```bash
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```

The tag push triggers the **Release** workflow, which rebuilds and refuses to publish if `dist/` at the tag is stale, then creates the GitHub release and moves the floating `vX` major tag.

Consumers pin `@vN` (or a commit SHA, which Renovate can bump).
