import * as core from '@actions/core';
import * as github from '@actions/github';
import { evaluate, parseAllowedChanges, type ChangedFile } from './allowlist';

async function run(): Promise<void> {
  const allowedTeam = core.getInput('allowed-team', { required: true });
  const token = core.getInput('github-token', { required: true });
  const reviewerLogin = core.getInput('reviewer-login', { required: true });
  const rules = parseAllowedChanges(core.getInput('allowed-changes', { required: true }));

  const pr = github.context.payload.pull_request;
  if (!pr) {
    core.setFailed('This action must run on a pull_request event.');
    return;
  }

  const { owner, repo } = github.context.repo;
  const prNumber = pr.number;
  const author = pr.user.login as string;
  const octokit = github.getOctokit(token);

  // Skip fork PRs (their token would be empty).
  const headRepo = pr.head?.repo?.full_name as string | undefined;
  if (headRepo && headRepo !== `${owner}/${repo}`) {
    core.info(`Fork PR (${headRepo}); skipping.`);
    core.setOutput('eligible', 'false');
    return;
  }

  // Team membership check.
  let isMember = false;
  try {
    const { data } = await octokit.rest.teams.getMembershipForUserInOrg({
      org: owner,
      team_slug: allowedTeam,
      username: author,
    });
    isMember = data.state === 'active';
  } catch {
    isMember = false;
  }

  let eligible = false;
  if (!isMember) {
    core.info(`${author} is not an active member of ${owner}/${allowedTeam}.`);
  } else {
    // Changed files (paginated).
    const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    });
    const changed: ChangedFile[] = files.map((f) => ({ filename: f.filename, patch: f.patch }));
    const result = evaluate(changed, rules);
    eligible = result.eligible;
    if (!eligible) {
      core.info('PR is not eligible for auto-approval:');
      for (const r of result.reasons) core.info(`  - ${r}`);
    } else {
      core.info('PR met team + allowlist criteria.');
    }
  }

  // This reviewer's existing APPROVED reviews (paginated).
  const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });
  const ownApprovals = reviews.filter(
    (r) => r.user?.login === reviewerLogin && r.state === 'APPROVED',
  );

  if (eligible) {
    if (ownApprovals.length > 0) {
      core.info(`${reviewerLogin} already has an active approval; nothing to do.`);
    } else {
      await octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        event: 'APPROVE',
        body: `Auto-approved: author is an active member of ${owner}/${allowedTeam} and only allowlisted files and lines were changed.`,
      });
      core.info('Approved.');
    }
  } else {
    // Dismiss any stale auto-approvals so a previously-eligible PR that changed
    // does not keep a satisfying approval.
    for (const r of ownApprovals) {
      await octokit.rest.pulls.dismissReview({
        owner,
        repo,
        pull_number: prNumber,
        review_id: r.id,
        message: 'Auto-approval dismissed: PR no longer meets the auto-approve criteria.',
      });
      core.info(`Dismissed stale approval ${r.id}.`);
    }
  }

  core.setOutput('eligible', String(eligible));
}

run().catch((err) => core.setFailed(err instanceof Error ? err.message : String(err)));
