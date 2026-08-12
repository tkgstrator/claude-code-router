# develop / master 履歴乖離 — 分析と復旧プラン

> **Status:** analysis only. No reconciliation performed. See §Recovery below for the phased fix.
> **Snapshot date:** 2026-08-12
> **Symptom trigger:** `/release` skill halted on precondition #3 (package.json version <= latest release tag).

## Symptom

`develop → master` の release を打とうとしたら止まった。理由:

- master tip `package.json.version` = **2.59.1**
- develop tip `package.json.version` = **2.59.0**
- 既存 tag: v2.44.1, v2.58.1, v2.58.2, **v2.59.0**, **v2.59.1**

develop から `v2.60.0` を切ろうにも v2.59.0 と v2.59.1 が既にあるので、まず develop を master 相当まで進める必要がある。試しに `git merge origin/master` を打つと **23 ファイルで conflict**、そのうち `RouterPreferences.tsx` と `TierEditor.tsx` は **AA (both added)** — 別実装が両サイドで新規追加されている。

master には develop に無い commit が **30+ 本** ある:

```
d2a9c4b fix(router): expand reasoning_effort enum to full OpenAI ladder (#307)
17a0e68 feat(router): per-model reasoning_effort override (#306)
95af5d7 fix(ui): tier editor lists only enabled models (#305)
5565d6b feat(ui): promote tier editor to routing nav page (#304)
3cdef01 chore: release v2.44.1
590a0c8 chore: release v2.44.0
5b9549a chore: release v2.43.0
… (v2.29.0 まで遡る chore: release commit ぜんぶ)
```

## Root cause

**2 つの構造的問題が結合してる:**

### 1. backmerge automation が動いていない

`.github/workflows/backmerge.yaml` は仕込まれている (`qtmleap/actions` の再利用 workflow を呼び出し)。**master 宛て PR が merge されるたび** に `develop` を `master` に fast-forward push する仕掛け。

しかし直近の run history を見ると:

| 日時 | head branch | 結果 |
|---|---|---|
| 08-12 08:43 | `fix/reasoning-effort-full-enum` | ✅ (feature → master 直行) |
| 08-12 08:35 | `feat/model-reasoning-effort-override` | ✅ (同上) |
| 08-12 07:17 | `fix/tier-editor-enabled-only` | ✅ (同上) |
| 08-12 07:11 | `feat/tier-editor-nav-page` | ✅ (同上) |
| **08-11 20:42** | **`develop`** (release PR) | **❌ failure** |
| 08-10 19:37 | `develop` (release PR) | ❌ failure |
| 08-08 21:23 | `develop` (release PR) | ❌ failure |
| 08-08 20:05 | `develop` (release PR) | ❌ failure |

失敗ログ (2026-08-11 の run 31534274603):

```
remote: - Changes must be made through a pull request.
remote: - 5 of 5 required status checks have not succeeded: .
! [remote rejected] origin/master -> develop (protected branch hook declined)
error: failed to push some refs to 'https://github.com/tkgstrator/claude-code-router'
```

**backmerge job が `git push origin master:develop` で develop に直接 push しようとするが、develop のブランチ保護 (PR 必須 + required status checks) が push を弾いている。** リリース PR が merge されるたびに backmerge が失敗し、develop が置いてきぼりになる。

feature 系 (fix/reasoning-*, feat/tier-editor-*) の run が「成功」しているのは、その merge が master に直行しており、backmerge 対象が空だから vacuous success を返している可能性が高い (ワークフロー実体は同じなので理屈上は同じ push 拒否が起きるはず — 要検証)。

### 2. feature branch が master に直接マージされている

flow は `feature → develop → master` のはずだが、実際には:

- `#304 promote tier editor to routing nav page` — base=`master`
- `#305 tier editor lists only enabled models` — base=`master`
- `#306 per-model reasoning_effort override` — base=`master`
- `#307 expand reasoning_effort enum` — base=`master`

これらが develop を経由せず master 直行になっている。**これが乖離の入口。** backmerge automation が生きていても、feature が master に直接入る限り develop は必ず遅れる。

## 影響範囲 (このセッション時点)

- **`/release` 不可** — develop の version が master の既存 tag より低いので、次に安全に発行できる tag が決まらない
- **develop の deploy は動く** — feat/openai-inbound-compat (PR #308) は develop に landing 済み、dev 環境で動作している
- **master の feature は本番で動いている** — reasoning_effort / TierEditor は本番デプロイ済み

つまり dev 側 (#308) も prod 側 (#304-#307) も個別には稼働している。**ただし両者を統合した release は打てない状態**。

## Recovery plan (phased)

### Phase 1 — 直接 master 行きを止める [最優先・根本原因]

feature branch を base=`master` で切らせない。

- **選択肢 A**: master のブランチ保護に「Restrict who can push to matching branches」を追加し、base=develop からの PR しか merge できないルールを作る
- **選択肢 B**: `.github/CODEOWNERS` + PR template で base=master を人間チェックで弾く (弱い)
- **選択肢 C**: `.github/workflows/` に base=master + head!=develop を検出して fail するチェックを追加

推奨は A。

### Phase 2 — backmerge workflow を PR 化 or bypass 付与

fast-forward push が protection で弾かれるので:

- **案 A**: workflow をリライトして `git push` の代わりに `gh pr create` を叩き、backmerge PR を自動発行させる。承認 + merge は人間 — 安全側だが 1 手増える
- **案 B**: GitHub のブランチ保護に "Bypass" を設定し、github-actions bot が develop に push できる ID を許可する — 一撃だが権限が広がる
- **案 C**: `qtmleap/actions` の再利用 workflow 側で PR-based fallback を実装 (org 横断で恩恵)

Phase 1 と組で修正できると再発しない。

### Phase 3 — 一度だけ手動 reconciliation

30 commit + 23 conflict は 1 PR で処理せず 2 段に分けるのが安全:

**PR #A: master → develop 統合 (reasoning_effort 系)**
- `git switch -c chore/backmerge-master-to-develop origin/develop`
- `git merge origin/master`
- 23 conflict を人力解消 (下記の主要衝突を参照)
- 特に `RouterPreferences.tsx` / `TierEditor.tsx` は AA なので両実装を統合するかどちらかを捨てる判断が必要
- CI 全 green を確認して merge

**PR #B: version bump 2.59.1 → 2.60.0**
- Phase 3 の PR #A が merge されて develop が master と同期したら、package.json を 2.60.0 に bump する PR を出す (私の PR #308 は feat なので minor)
- merge

その後 `/release` 再実行で v2.60.0 tag が切れる。

### 主要衝突ファイル

```
UU src/api/providers/[name]/models/[model]/route.ts
UU src/app/routes.tsx
UU src/components/AppShell.tsx
AA src/components/RouterPreferences.tsx
AA src/components/TierEditor.tsx
UU src/lib/api.ts
UU src/locales/en.json
UU src/locales/ja.json
UU src/locales/zh.json
UU src/prisma/schema.prisma
UU src/schemas/model.dto.ts
UU src/schemas/provider.dto.ts
UU src/services/config/compose.ts
UU src/services/config/crud.ts
UU src/services/config/index.ts
UU package.json
+ M src/llms/transformers/openai-responses.ts (auto-merged but review needed)
+ M src/llms/transformers/openai.ts (auto-merged but review needed)
+ M src/llms/registry/provider.ts (auto-merged)
+ M src/llms/context.ts (auto-merged)
+ M src/schemas/llm-pipeline.dto.ts (auto-merged)
+ A src/prisma/migrations/20260812080000_add_model_reasoning_effort/migration.sql (new from master)
```

reasoning_effort 実装は master 側にあり、develop の PR #308 (OpenAI-compat) はそれと独立に openai-responses.ts / openai.ts を触っている。片方が消えないよう **auto-merge 部分も含めて 1 ファイルずつ diff レビューが必要**。

## Interim state (このセッションで landing した / しなかったもの)

- **landed on develop** (dev 環境デプロイ済):
  - PR #308 `feat(api): add openai-compat inbound (chat/completions, responses, models)` — squash `938cecd`
  - PR #309 `chore(deps): add direnv devcontainer feature and bump biome schema to 2.5.6` — squash `fc5b9d4`

- **not released**:
  - v2.60.0 の tag 発行を予定していたが preconditions を満たさず halt

- **local tasks kept pending** (次セッション用):
  - #6 Backmerge master → develop
  - #7 Bump develop version 2.59.1 → 2.60.0
  - #8 Re-run /release after backmerge + bump

## Next action

このドキュメントを PR で develop に上げる。実際の reconciliation (Phase 3) は履歴とブランチ保護を人の目で見ながら別セッションで進めること。
