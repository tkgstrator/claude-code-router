---
name: merge
description: Merge a feature→develop pull request once CI is green. Use when the user says "merge the PR", "merge if green", "land this", or after watch reports success. Verifies all checks pass and the branch is mergeable before merging; refuses on pending/failed checks. For develop→master production releases use the `release` skill instead.
model: sonnet
---

# merge — merge a feature PR when CI is green

Merge a PR (normally **feature → `develop`**) only after confirming CI passed and there
are no conflicts. Use the **GitHub MCP** (`mcp__github__*`); **resolve `<OWNER>`/`<REPO>`
from `git remote get-url origin`** (this repo: `mito-shogi/mito`).

> Merging into `develop` deploys to the **development** env — not production. A PR whose
> base is `master` is a **release**: stop and use the **`release`** skill (it adds the
> production confirmation and the version tag).

## Identify the target

- Default to the current branch's PR via
  `mcp__github__list_pull_requests(owner: '<OWNER>', repo: '<REPO>',
  state:'open', head:'<OWNER>:<current-branch>')`.
- Accept an explicit PR number/URL if given.

## Gate checks (all must hold before merging)

1. **CI is green.** `mcp__github__pull_request_read(method:'get_check_runs', …, pullNumber:<pr>)`
   (and `method:'get_status'`) — every required check `conclusion: success`. If anything
   is `queued`/`in_progress` → wait (suggest `/watch`) and stop. Any `failure` → stop and
   report; never merge a red PR.
2. **Mergeable.** `mcp__github__pull_request_read(method:'get', …)` → `mergeable` is true
   and `mergeable_state` is `clean` (not `dirty`/`blocked`/`behind`). If behind base,
   update first: `mcp__github__update_pull_request_branch(owner, repo, pullNumber:<pr>)`.

3. **Base must be `develop`.** Confirm the PR's `base.ref` is `develop` (or another
   feature/integration branch). If it targets `master`, this is a production release —
   **stop and switch to the `release` skill**; do not merge it here.

## Merge

```
mcp__github__merge_pull_request(
  owner: '<OWNER>', repo: '<REPO>', pullNumber:<pr>,
  merge_method:'squash',
  commit_title:'<commitlint-style squash subject>')
```

- Default to **squash** merge. `commit_title` must still satisfy commitlint (lowercase
  start, valid `type` incl. `chore`, ≤ 96 chars).
- `merge_pull_request` has no delete-branch option — after a green merge, delete the
  source branch separately: `git push origin --delete <feature-branch>` (deleting a
  feature branch is fine; never delete/force `master`/`develop`).
- Fallback only if the MCP is unavailable: `gh pr merge <pr> --squash --delete-branch`.

## After merge

- Confirm the merge and the merged commit. There is **no version tag** at this stage —
  tagging happens only on the `develop → master` release (`release` skill).
- **Always sync `develop` locally** (do not skip — the user expects to land on a clean
  develop after a merge, ready for the next feature branch):
  1. `git push origin --delete <feature-branch>` — drop the merged source branch on the
     remote. Skip silently if it is already gone.
  2. `git switch develop` — leave the now-stale feature branch.
  3. `git pull --ff-only` — fast-forward to the squash commit just landed. If this is
     not a fast-forward, stop and report (something else moved `develop`); do not merge
     or rebase here.
  4. `git branch -d <feature-branch>` — delete the local feature branch. Use `-d`
     (safe) not `-D`; with squash merges git may refuse because the squash commit has
     a different SHA, in which case run `git branch -D <feature-branch>` (the remote
     copy is already gone, so the work is not recoverable any other way).
- Merging into `develop` runs `deployment.yaml` against the **development** env; offer to
  `/watch` it if the user wants to confirm the dev deploy.
- When `develop` has accumulated the changes meant for production, run **`release`** to
  promote it to `master`, deploy production, and tag `vX.Y.Z`.
