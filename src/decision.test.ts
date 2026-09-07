import { describe, it, expect } from 'vitest';
import { decideReviewAction, type ReviewAction } from './decision';

describe('decideReviewAction', () => {
  // Exhaustive over the three booleans.
  const cases: Array<[boolean, boolean, boolean, ReviewAction]> = [
    // eligible, dismissStale, hasOwnApproval, expected
    [true, true, false, 'approve'],
    [true, true, true, 'none'], // already approved, no duplicate review
    [true, false, false, 'approve'],
    [true, false, true, 'none'],
    [false, true, true, 'dismiss'],
    [false, true, false, 'none'], // nothing to dismiss
    [false, false, true, 'none'], // suppressed: a later step owns the dismissal
    [false, false, false, 'none'],
  ];

  for (const [eligible, dismissStale, hasOwnApproval, expected] of cases) {
    it(`eligible=${eligible} dismissStale=${dismissStale} hasOwnApproval=${hasOwnApproval} -> ${expected}`, () => {
      expect(decideReviewAction({ eligible, dismissStale, hasOwnApproval })).toBe(expected);
    });
  }

  it('never dismisses while dismiss-stale is false', () => {
    for (const eligible of [true, false]) {
      for (const hasOwnApproval of [true, false]) {
        expect(decideReviewAction({ eligible, dismissStale: false, hasOwnApproval })).not.toBe(
          'dismiss',
        );
      }
    }
  });
});

// A job may run the action once per policy, all steps sharing one reviewer
// identity. The caller gates each step on the previous one not having approved,
// and only the last step keeps dismiss-stale true. These tests pin the
// invariant that arrangement has to hold.

interface Step {
  // undefined models a step skipped by a condition of its own, e.g. a branch
  // filter. A skipped step neither approves nor dismisses.
  eligible?: boolean;
  dismissStale: boolean;
}

// Returns whether an approval by this reviewer exists after the job.
function runChain(steps: Step[], startsApproved: boolean): boolean {
  let hasOwnApproval = startsApproved;
  let approvedHere = false;
  for (const step of steps) {
    if (approvedHere) continue; // gate: a later step runs only if none approved
    if (step.eligible === undefined) continue; // skipped by its own condition
    const action = decideReviewAction({
      eligible: step.eligible,
      dismissStale: step.dismissStale,
      hasOwnApproval,
    });
    if (action === 'approve') {
      hasOwnApproval = true;
      approvedHere = true;
    } else if (action === 'dismiss') {
      hasOwnApproval = false;
    } else if (step.eligible) {
      // eligible with an approval already in place counts as approved here, so
      // no later step gets to dismiss it.
      approvedHere = true;
    }
  }
  return hasOwnApproval;
}

describe('policy chain', () => {
  // Correct arrangement: the step that can be skipped runs first with the
  // dismissal suppressed, the unconditional step runs last and dismisses.
  const first = (eligible?: boolean): Step => ({ eligible, dismissStale: false });
  const last = (eligible: boolean): Step => ({ eligible, dismissStale: true });

  it('approves when only the first policy qualifies', () => {
    expect(runChain([first(true), last(false)], false)).toBe(true);
  });

  it('approves when only the last policy qualifies', () => {
    expect(runChain([first(false), last(true)], false)).toBe(true);
  });

  it('approves when both policies qualify', () => {
    expect(runChain([first(true), last(true)], false)).toBe(true);
  });

  it('dismisses a prior approval when neither policy qualifies', () => {
    expect(runChain([first(false), last(false)], true)).toBe(false);
  });

  it('keeps the first policy approval instead of letting the last step dismiss it', () => {
    expect(runChain([first(true), last(false)], true)).toBe(true);
  });

  it('keeps a prior approval that the last policy still qualifies for', () => {
    expect(runChain([first(false), last(true)], true)).toBe(true);
  });

  it('dismisses on a branch where the conditional first step is skipped', () => {
    expect(runChain([first(undefined), last(false)], true)).toBe(false);
  });

  it('leaves a stale approval when the dismissing step is the skippable one', () => {
    // The arrangement to avoid: the step holding dismiss-stale runs first and
    // is skipped, so nothing dismisses. Pinned so the ordering rule in the
    // README is not silently broken.
    const skippedDismisser: Step = { eligible: undefined, dismissStale: true };
    const suppressed: Step = { eligible: false, dismissStale: false };
    expect(runChain([skippedDismisser, suppressed], true)).toBe(true);
  });
});
