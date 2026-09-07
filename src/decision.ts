// Pure decision logic for what to do with this reviewer's own review on a PR.
// Kept out of main.ts so it can be unit-tested without mocking the GitHub API,
// and so the chain invariant (see decision.test.ts) is expressible as a test.

export type ReviewAction =
  | 'approve' // create an approving review
  | 'dismiss' // dismiss this reviewer's existing approvals
  | 'none'; // leave the PR as it is

export interface DecisionInput {
  // Author is in the team and every changed file passed the allowlist.
  eligible: boolean;
  // False while another step later in the same job owns the dismissal.
  dismissStale: boolean;
  // This reviewer already has an active APPROVED review on the PR.
  hasOwnApproval: boolean;
}

export function decideReviewAction({
  eligible,
  dismissStale,
  hasOwnApproval,
}: DecisionInput): ReviewAction {
  if (eligible) {
    return hasOwnApproval ? 'none' : 'approve';
  }
  if (!dismissStale) {
    return 'none';
  }
  return hasOwnApproval ? 'dismiss' : 'none';
}
