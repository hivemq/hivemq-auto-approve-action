import type * as github from '@actions/github';

export async function isActiveMember(
  octokit: ReturnType<typeof github.getOctokit>,
  org: string,
  teamSlug: string,
  username: string,
): Promise<boolean> {
  try {
    const { data } = await octokit.rest.teams.getMembershipForUserInOrg({
      org,
      team_slug: teamSlug,
      username,
    });
    return data.state === 'active';
  } catch (err) {
    // The API answers 404 for a user who is not a member of the team.
    if ((err as { status?: number }).status === 404) return false;
    throw err;
  }
}
