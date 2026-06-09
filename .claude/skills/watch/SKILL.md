---
name: watch
description: Monitor GitHub Actions CI for the current PR/branch until it concludes, then report green/red with failure logs. Use when the user says "watch the CI", "is CI passing?", "monitor the checks", or after opening a PR and wanting to wait for checks. Pairs with commit-push-pr (before) and merge (after).
model: sonnet
---

# watch — monitor CI to a conclusion

Follow the GitHub Actions checks for a PR until they finish, then summarize. Use the
**GitHub MCP** (`mcp__github__*`); **resolve `<OWNER>`/`<REPO>` from
`git remote get-url origin`** (this repo: `mito-shogi/mito`).

## Identify the target

- Default to the PR for the current branch — find it by head:
  ```
  mcp__github__list_pull_requests(owner: '<OWNER>', repo: '<REPO>',
    state:'open', head:'<OWNER>:<current-branch>')
  ```
  (current branch = `git branch --show-current`). Take the PR number.
- Accept an explicit PR number/URL if the user gives one.

## Watch (poll loop)

The MCP has no blocking `--watch`, so poll. Each tick, read the PR's checks:

```
mcp__github__pull_request_read(method:'get_check_runs', owner: '<OWNER>',
  repo: '<REPO>', pullNumber:<pr>)
```

- Also `method:'get_status'` for the combined commit status.
- Aggregate: if any check is `in_progress`/`queued` → still pending. If all completed
  with `conclusion: success` → green. Any `failure`/`cancelled`/`timed_out` → red.
- This repo's required checks (`.github/workflows/integration.yaml`): **CommitLint** and
  **Code Check** (Biome + tsc + test). `code_review.yaml` (ChatGPT review) is advisory.
- Pacing: if invoked inside `/loop`, do **one** poll per tick and let the loop schedule
  the interval. Otherwise re-poll roughly every 30s until it concludes.

## On conclusion

- **All green** → report success with the PR URL, then **immediately ask whether to
  merge** via `AskUserQuestion`. Skip the ask only when the PR's `base.ref` is `master`
  (production release — must go through the `release` skill, not `merge`).

  ```
  AskUserQuestion({
    questions: [{
      question: 'CI 全 pass。PR #<N> を develop へ merge しますか？',
      header: 'merge?',
      multiSelect: false,
      options: [
        { label: 'はい、merge する', description: 'merge skill を呼び、squash merge 後に
          develop へ同期する (deployment.yaml が development 環境にデプロイ)。' },
        { label: '今は止めておく', description: 'PR は open のまま残す。後で /merge で再開できる。' }
      ]
    }]
  })
  ```

  - 「はい」を選んだら、続けて `merge` skill を呼ぶ (この skill 自身は merge しない)。
  - 「今は止める」を選んだら、何もせず終了する。
- **Any failure** → identify the failing check from `get_check_runs` (each run has a
  `name`, `conclusion`, and `details_url`). Read its log to find the root cause —
  `gh run view <run-id> --log-failed` is the simplest way to fetch Actions logs (the
  MCP exposes check runs, not raw step logs). Surface the specific failing step (a
  commitlint subject-case violation, a Biome lint error, a tsc error, a failing test)
  and propose the fix. **Do not ask about merging** — never merge a red PR.
- **Pending/stuck** → report what is still queued.

## Notes

- Read-only: this skill never pushes, re-runs jobs, or merges on its own. Merging happens
  only via the `merge` skill, invoked from the AskUserQuestion answer above.
- A common red here is commitlint: the subject started with a capitalized English word
  (subject-case), or the `type` is outside the `.commitlintrc.yaml` enum. Fix and re-push.
