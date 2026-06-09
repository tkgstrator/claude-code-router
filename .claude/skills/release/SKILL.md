---
name: release
description: Promote develop to master — open (or reuse) the develop→master PR, confirm CI is green, merge to master (which triggers the production Cloudflare deploy), then tag the release vX.Y.Z. Use when the user says "release", "cut a release", "promote develop to master", "ship to production". This is the ONLY path that touches master/production.
model: sonnet
---

# release — promote develop to master (production)

The `develop → master` step of the `feature → develop → master` flow. This is the only
skill that merges into `master` and triggers a **production** Cloudflare deploy. Use the
**GitHub MCP** (`mcp__github__*`); **resolve `<OWNER>`/`<REPO>` from
`git remote get-url origin`** (this repo: `mito-shogi/mito`).

## Preconditions

- `develop` is ahead of `master` (there is something to release). Check with
  `mcp__github__list_pull_requests(... base:'master', head:'<OWNER>:develop')` or compare
  branches; if `develop` is not ahead, there is nothing to release — stop.
- Decide the release version: read `package.json`'s `version`. It should already reflect
  the changes on `develop` (bumped by `commit-push-pr`). If it does not, bump it on `develop` via a
  normal `commit-push-pr` PR **first**, then release — never push a version commit straight to
  `develop`/`master`.

## Steps

1. **Open (or find) the release PR `develop → master`.**
   ```
   mcp__github__create_pull_request(
     owner: '<OWNER>', repo: '<REPO>',
     base:'master', head:'develop',
     title:'<type>: release vX.Y.Z', body:'<release notes + footer>')
   ```
   - Title satisfies commitlint (lowercase start, valid `type` incl. `chore`, ≤ 96 chars),
     e.g. `chore: release v0.2.0`. The commitlint `body-max-line-length` rule (each line
     ≤ 100 chars) also applies to the merge commit body that GitHub produces — keep the
     body short or pre-wrap long sentences in the PR body.
   - Body: summary of what is shipping, the version, and the
     `🤖 Generated with [Claude Code](https://claude.com/claude-code)` footer.
   - If a `develop → master` PR already exists, reuse it.

2. **Gate on green CI.** `mcp__github__pull_request_read(method:'get_check_runs' / 'get_status', …)`
   — every required check `conclusion: success`. Pending → wait (`/watch`). Failure → stop
   and report; never release a red PR. Also confirm `mergeable_state` is `clean`.

3. **Confirm production with the user.** Merging this triggers a **production** Cloudflare
   Workers deploy (`.github/workflows/deployment.yaml`, `base.ref == master → production`)
   — outward-facing and hard to reverse. **Get explicit confirmation that they want to
   deploy `vX.Y.Z` to production** before merging (a generic "yes" earlier is not enough).

4. **Merge into master.** Use a **merge commit** (not squash) so `master` and `develop`
   stay in sync and don't diverge:
   ```
   mcp__github__merge_pull_request(
     owner: '<OWNER>', repo: '<REPO>', pullNumber:<pr>,
     merge_method:'merge',
     commit_title:'<type>: release vX.Y.Z')
   ```

5. **Tag `vX.Y.Z` on master.**
   ```
   git fetch origin && git switch master && git pull
   ver=$(jq -r .version package.json)
   git tag -a "v$ver" -m "release v$ver" && git push origin "v$ver"
   ```
   - Annotated tag; pushing a **tag** is allowed (it is not a branch push to master/develop).
   - If the tag already exists, do not force it — report the collision instead.
   - Optionally publish notes: `gh release create "v$ver" --generate-notes` (no MCP
     create-release tool exists, so `gh` is used here).

6. **Report** the merged release commit, the `vX.Y.Z` tag, and that the production deploy
   is now running. Offer to `/watch` the deploy.

## Notes

- Do **not** delete `develop` after release — it is a long-lived branch.
- Never squash `develop → master`; squashing makes the branches diverge and breaks the
  next release's "develop is ahead of master" check.