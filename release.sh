#!/usr/bin/env bash
#
# Builds the action bundle, creates a release commit, and tags it.
# Nothing is pushed: review the result, then push the branch and the tag.
#
# Usage: ./release.sh v1.2.3

set -euo pipefail

readonly TAG="${1:-}"
readonly VERSION="${TAG#v}"
readonly RELEASE_BRANCH="main"
readonly DIST_DIR="dist"

die() {
    echo "error: $*" >&2
    exit 1
}

[[ -n "${TAG}" ]] || die "no tag given. Usage: ./release.sh v1.2.3"
[[ "${TAG}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "tag '${TAG}' must look like v1.2.3, which is what the release workflow triggers on"

cd "$(dirname "$0")"

git rev-parse --git-dir >/dev/null 2>&1 || die "not a git repository"

if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
    die "tag '${TAG}' already exists locally"
fi

if [[ -n "$(git ls-remote --tags origin "refs/tags/${TAG}")" ]]; then
    die "tag '${TAG}' already exists on origin"
fi

readonly CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "${CURRENT_BRANCH}" == "${RELEASE_BRANCH}" ]] ||
    die "on branch '${CURRENT_BRANCH}', releases are cut from '${RELEASE_BRANCH}'"

if [[ -n "$(git status --porcelain)" ]]; then
    git status --short >&2
    die "working tree is not clean, commit or stash first so that only the bundle is committed"
fi

echo "Building the action bundle"
npm ci
npm run all

echo "Setting the package version to ${VERSION}"
npm version "${VERSION}" --no-git-tag-version --allow-same-version >/dev/null

echo "Creating the release commit"
git add package.json package-lock.json "${DIST_DIR}"
git commit --message "chore: release ${TAG}"

git tag --annotate "${TAG}" --message "Release ${TAG}"

echo
echo "Created tag ${TAG} at $(git rev-parse --short HEAD)"
echo "Review, then push:"
echo "  git push origin ${RELEASE_BRANCH}"
echo "  git push origin ${TAG}"
