---
name: commit-push-pr
description: Commit the current working tree on a feature branch (cut from develop), push it, and open a pull request into develop. Use when the user says "ship this", "make a PR", "commit and push and open a PR", or wants to turn local changes into a reviewable PR. Handles branch-first safety, commitlint-format messages, and the GitHub PR.
---

# commit-push-pr — commit, push, open a PR into develop

Turn the current local changes into a pushed feature branch + GitHub PR **targeting
`develop`**. Never commit **or push** directly onto a protected branch (`master`,
`develop`, `main`) — work only ever lands there through a merged PR.

**Branch flow:** `feature → develop → master`. `commit-push-pr` covers `feature → develop`
(merging there deploys to the **development** env). The `develop → master` release
(production deploy + version tag) is the separate **`release`** skill.

## Repo coordinates

- GitHub operations go through the **GitHub MCP** (`mcp__github__*`). **Resolve
  `<OWNER>`/`<REPO>` first** from `git remote get-url origin` (→ `…/<OWNER>/<REPO>.git`;
  this repo is `mito-shogi/mito`). Use the resolved values in every MCP call
  below — never assume a hard-coded repo, so the skill also works in template-derived repos.
- Local git (branch, commit, push, tag) uses the `git` CLI — there is no MCP equivalent
  for pushing local commits. `gh` is only a fallback if the MCP is unavailable.

## Preconditions

- There are changes to ship: `git status --porcelain` is non-empty.

## Steps

1. **Branch first, off develop (hard rule).** Get the current branch with
   `git branch --show-current`.
   - If it is `master`, `main`, `develop`, or detached → create a feature branch from the
     latest `develop` **before committing**:
     `git fetch origin && git switch -c <type>/<short-kebab-desc> origin/develop`
     where `<type>` reflects the work (`feat`, `fix`, `chore`, `docs`, `refactor`…).
   - If already on a feature branch → keep it.
   - Never commit onto `master`/`main`/`develop`.

2. **Version bump (semver — only if the change warrants a release).** Judge from the
   change whether `package.json`'s `version` should move, following semantic versioning:
   - **breaking change** (`feat!`, removed/renamed public API, incompatible behavior) → **major**
   - **feat** (new backward-compatible capability) → **minor**
   - **fix / perf / refactor** that ships user-visible behavior → **patch**
   - pure `docs` / `chore` / `ci` / `test` / `format` / internal-only → **no bump**

   Pre-1.0 nuance (repo is currently `0.x`): keep breaking changes as a **minor** and
   features/fixes as a **patch** until the user opts into 1.0. When in doubt, prefer the
   smaller bump or ask. If a bump is warranted, edit the `version` field in `package.json`
   (and `bun.lock` if it pins it) **before** committing, so the new version flows into
   `develop` with this PR. The matching `vX.Y.Z` git tag is created later by `release`
   when `develop` is promoted to `master` — not here.

3. **Release notes (only when the version was bumped in step 2).** When you bumped
   `package.json` to a new version, also add a matching section to
   `src/app/routes/releases/index.tsx` so the in-app `/releases` page documents what
   shipped. Insert the new entry at the **top** of the `releases` array (releases are
   ordered newest-first), mirroring the existing format:
   ```ts
   {
     version: '<X.Y.Z>',           // matches package.json
     date: '<YYYY-MM-DD>',         // today (use `git log -1 --format=%cs HEAD` for the
                                    // previous release's date format)
     notes: [
       '<ユーザー向けに 1 行で何が変わったか>',
       ...
     ]
   }
   ```
   - Notes are written in **Japanese** for end users (this app's audience). Distill the
     PR's user-visible changes, not the internal refactors. One bullet per change.
   - No bullet for `chore` / `ci` / `format` / internal-only items unless the user can
     actually see the difference.
   - If you did not bump the version, **skip this step** — the next bump will catch any
     accumulated note items.

   ### Voice — write for a shogi fan, not a developer

   The reader is someone who opened MITO to look over their game. They do not know what
   a cache, an API, a MultiPV, or a depth gate is, and they do not need to. Use words
   that match what is **actually on the screen**. If a sentence only makes sense to
   someone who has read this repo, rewrite it.

   **Substitute jargon for plain language:**
   - 「KV」「キャッシュ」「サーバ/クライアント」「API」 → **「高速解析」** (the in-app
     name of the feature, exposed in the settings UI). Prefer this over phrasings like
     「他の人の解析結果」 — that wording can read as "someone else's data leaking to
     me", which is not the impression we want even though the mechanism is shared.
   - 「book」「定跡ヒット」 → **「定跡」「定跡の手」**
   - 「MultiPV」 → **「候補手の設定」「候補手の数」**
   - 「探索メトリクス (nodes / nps / time / seldepth)」 → **「思考時間や読んだ手数」**
     or even just **「探索メトリクス」** alone (collective noun is fine when the
     specific fields don't matter to the user)
   - 「FV_SCALE (評価値スケール)」 → **「最適な設定値」**
   - 「NNUE 構造」「KP256 / HalfKP256 / HalfKP768」 → **「エンジンの種類」「強いエンジン
     / 弱いエンジン」** (these are exposed in the settings UI under friendly names)
   - 「depth」「seldepth」「採用率トークン」 → just drop or paraphrase

   **Drop entries that have nothing to show the user:**
   - Pure refactors / API moves / type renames / lock-file refreshes do **not** earn a
     note. If you find yourself writing "(内部リファクタリングのため動作上は変化なし)"
     in a release note, that is a tell — delete the entire bullet and (if it is the
     only thing in the release) the entire release entry. The next user-facing change
     will catch the bumped version automatically.

   **Sentence shape:**
   - One change per bullet, present-tense outcome ("〜できるようになりました" /
     "〜の不具合を修正しました").
   - No file paths, no field names, no English type names. If you must mention a UI
     surface, use the label the user sees ("ネットワークと評価関数」ページ", not
     "`networks/index.tsx`").
   - Avoid restating internal mechanism. "MultiPV=1 のユーザーが…" → just describe the
     outcome the user will notice: "高速解析で出る候補手が減ってしまう不具合を修正しました".

   **Past releases are mostly read-only, with a vocabulary-alignment carve-out:**
   - The default rule is: do not retouch released entries to "improve their wording";
     they are a historical record.
   - The carve-out: when this voice guide changes (e.g. a recommended phrasing turns
     out to be misleading and gets retired), you MAY do a targeted retrofit pass over
     past entries to bring the vocabulary into line. Limit it to swapping the exact
     phrase — do not rewrite the surrounding sentence, do not change the meaning, and
     do not touch dates or version numbers.

4. **Commit (commitlint-conventional).** Stage with `git add -A`, then write the message yourself:
   - Header: `<type>(<optional-scope>): <subject>`
   - `<type>` is EXACTLY one of: `build ui ci docs feat fix perf refactor revert format test chore`
     (the set is defined by the repo's `.commitlintrc.yaml` type-enum).
   - Subject + body in **English**, subject **starts lowercase**, no trailing period
     (avoids the commitlint subject-case failure).
   - **Length limits (commitlint):** header ≤ **96** chars (`header-max-length`),
     **every body line ≤ 100 chars** (`body-max-line-length`). The body limit is
     per-line, not total — long sentences must be hard-wrapped. Verify before pushing:
     ```
     awk '{print length}' <(git log -1 --format=%B) | sort -n | tail -3
     ```
     The tail should be ≤ 100. If anything exceeds it, `git commit --amend` with a
     wrapped body **before** push. This repo has tripped the body limit multiple times
     because the auto-checkpoint hook tends to write long single-line bodies — when
     consolidating with `git reset --soft`, recheck the lengths.
   - Commit with the repo's local git identity (already configured) and append:
     ```
     git commit -m "<header>" -m "<optional body>" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
     ```
   - If you bumped the version, mention it in the body (e.g. `bump version to 0.2.0`).
   - If the user explicitly authorized a multi-commit split, make several focused commits.

5. **Push.** `git push -u origin HEAD` — pushes the **feature branch** only. Never push
   to `master` / `develop` / `main` (forbidden), and never `--force` / `-f` (denied).
   Confirm `git branch --show-current` is the feature branch before pushing.

6. **Open the PR via GitHub MCP. Base = `develop`** (never `master` — that is the
   `release` skill's job).
   ```
   mcp__github__create_pull_request(
     owner: '<OWNER>', repo: '<REPO>',
     base: 'develop', head: '<feature-branch>',
     title: '<commitlint-style title>', body: '<body>')
   ```
   - The head branch must already be pushed (step 4) — MCP creates the PR from the
     remote branch.
   - Title follows the same commitlint rules as the commit header.
   - Body: short **What / Why**, a test-plan line, the new version (`vX.Y.Z`) if bumped,
     then the footer:
     ```
     🤖 Generated with [Claude Code](https://claude.com/claude-code)
     ```
   - Merging into `develop` deploys to the **development** env
     (`.github/workflows/deployment.yaml`, `base.ref != master → development`) — no
     production impact yet. Production happens later via `release`.
   - Fallback only if the MCP is unavailable: `gh pr create --base develop --head <branch> --title … --body …`.

7. **Report** the PR URL and the version (bumped or unchanged). Suggest `/watch` to
   follow the checks, then `/merge` once green (merges into `develop`).

## Notes

- Do not push or PR if `git status` is clean — tell the user there is nothing to ship.
- If pushing requires authentication the agent lacks, ask the user to run the push
  themselves with `! git push -u origin HEAD`.
