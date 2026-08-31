# Rialto — 改名・機能集約・Gemini対応 マスタープラン

- Status: **Draft（モック段階で人間レビュー待ち）**
- 起点: `v2.68.3` / `develop`
- 目標リリース: `v3.0.0`（破壊的変更を含む）

---

## 1. 背景

「Claude Code Router」という名前が、いまの実体と合っていない。

- 受け口はもう `/v1/messages` だけではない。`/v1/chat/completions`・`/v1/responses`・`GET /v1/models` は**すでに実装済み**で、OpenAI互換ゲートウェイとしても動く
- しかし **ルーティング設定は `/v1/messages` にしか効かない**（§3.2）。UIのRouter系画面がすべてmessages前提に見えるのはこれが理由
- 上流(provider)側はAnthropic / OpenAI / Gemini / DeepSeekまで広がっている

「Claude Code の router」ではなく「**複数のワイヤ形式を受け、複数のベンダへ振り分けるルーティング・ゲートウェイ**」が実体である。名前を **Rialto** に変え、実体に定義を合わせる。あわせてGeminiをサブスク枠まで含めて一級市民にする。

---

## 2. ゴール / 非ゴール

### ゴール

1. 受け口を **4面 +モデル一覧** に整理し、**どの面でもルーティング設定が効く**ようにする
2. Gemini を **api_key枠・サブスク枠の両方**で対応する
3. UI を情報設計から刷新する。**モック駆動**で、実装前に人間が承認する
4. Zod スキーマを層に分ける
5. Rialto へ全面リネーム（HOME_DIR のデータ移行を含む）
6. 認証を2層にする — 管理UIは Cloudflare Access、`/v1/*` は複数発行のアクセストークン（面とルーティングプロファイルにスコープ）

### 非ゴール

- 機能削減。これは**集約**であって削減ではない
- Prisma / PostgreSQL / Hono / Vite といった基盤の入れ替え
- react-router-dom → TanStack Router のようなUI基盤の入れ替え（今回は基盤維持・設計刷新）
- 上流 `musistudio/claude-code-router` との再同期（すでに別物）
- ローカルDB名（`ccr` / `ccr_test`）の改名。既存ローカル環境を壊す割にリターンが無いので据え置く

---

## 3. 現状

### 3.1 規模（`src/generated` を除く実測 / 2026-08-31）

| 領域 | ファイル | 行数 | 備考 |
|---|---:|---:|---|
| `src/components` | 111 | 17,115 | うち `ui/`(shadcn) 28ファイル。画面は15以上 |
| `src/llms` | 71 | 9,827 | transformer / pipeline / scenario-router / quota-router |
| `src/api` | 46 | 3,986 | Next.js風 `route.ts` 分割 |
| `src/schemas` | 29 | 3,718 | フラット単層 |
| `src/lib` | 40 | 3,549 | |
| `src/services` | 66 | — | config / oauth / usage / routing-scheduler ほか |
| **合計** | **396** | **49,040** | |

名称参照: `CCR` 94ファイル / `ccr` 53ファイル / `claude-code-router` 34ファイル / `Claude Code Router` 19ファイル。

### 3.2 いちばん効く歪み — ルーティングが1面にしか効かない

`src/llms/scenario-router.ts:117-128`:

```ts
// Bypass for OpenAI-compat inbound: /v1/chat/completions and
// /v1/responses callers hand-pick their target with `provider,model`
// ... Skip the whole selector, leave body.model as-is ...
if (req.inboundPath === '/v1/chat/completions' || req.inboundPath === '/v1/responses') {
  req.scenarioType = 'default'
  req.isSubagent = false
  req.resolvedFallbacks = []
```

つまり OpenAI互換で入ってきた瞬間、**シナリオ分類も・ルールスタックも・quota-aware選好チェーンも・failoverも効かない**。

結果として `RouterPreferences` / `RoutingLibrary` / `RoutingLiveEditor` / `RoutingPresetEditor` / `TierEditor` / `RouterUtilization` の6画面はすべて事実上「`/v1/messages` 専用の設定画面」になっている。これが **「UI上の機能が全部messagesだけの設定になっている」の正体**。

判断としてこのバイパス自体は当時妥当だった（OpenAI互換クライアントは自分でモデルを選ぶ前提）。問題は**それが固定で、UIから見えず、切り替えられない**こと。

### 3.3 その他の構造的な歪み

1. **Geminiの受け口が死んでいる** — `GeminiTransformer` は `endPoint = '/v1beta/models/:modelAndAction'` を宣言しているが、`src/index.ts` は `/v1/*` しかマウントしていないので到達不能。宣言だけ残った幽霊
2. **inbound面の知識が4箇所に散っている** — `errorShapeForPath`（`api/v1/error-shape.ts`）、`pickSseAggregator`（`api/v1/route.ts`）、`openaiBearerAuth` のパス列挙（`index.ts`）、`inboundType`（pipeline）。面を1つ足すたびに4箇所直す必要がある
3. **schemasが単層** — 29ファイル3,718行がフラットで、外部ワイヤ形式 / 内部API DTO / UIフォーム / 汎用ユーティリティが同居。`index.ts` の `export *` × 29 により、1つ import すると全部が読まれる（UIバンドルにサーバ専用スキーマが混入する）
4. **デッドコード** — `google-auth-library` / `fastify` / `@fastify/cors` / `fastify-plugin` が依存にあるが `src/` から一切参照されていない
5. **ドキュメントの陳腐化** — `CLAUDE.md` がまだ `packages/cli` / `packages/server` のmonorepo前提。`ccr` CLIコマンド節も残っているが `bin` フィールドはすでに無い
6. **UIの膨張** — 111コンポーネント / 17,115行 / 画面15以上。Router関連だけで5画面に分かれている
7. **命名の二重化** — `CCR` / `ccr` / `claude-code-router` / `Claude Code Router` が混在
8. **transformer選択が設定として成立していない**（§3.4）
9. **認証が単一キー** — `process.env.APIKEY` 1本で `/api/*` と `/v1/*` の両方を守っている。ローテーションすると全クライアントが同時に切れ、リクエストの帰属も取れない。管理UIと機械トラフィックは要件が違うのに同じ門を使っている

### 3.4 transformer選択の実態

登録されている transformer は `src/llms/context.ts:91` にハードコードされた**6つだけ**で、いずれも
ユーザーが選ぶ余地のないものである。

| 名前 | 束縛のされ方 |
|---|---|
| `anthropic` / `openai` / `openai-responses` / `gemini` | endpoint transformer。inbound パスで自動ディスパッチ |
| `claude-code-oauth` / `codex-oauth` | subscription 認証に紐づく |

`provider.transformer.use` は `apiStyle` + `authMode` から完全に導出できる（`apiStyleForVendor()`
が既にその写像）。加えて、この設定欄が機能していない証拠が3つある。

1. **存在しない transformer を指すシードがある** — `VENDOR_DEFAULTS.deepseek.transformer =
   { use: ['deepseek'] }`（`src/shared/data/index.ts:47`）だが `deepseek` という transformer は
   登録されていない。`resolveUseEntry` が `undefined` を返して黙って捨てられる。
   `src/providers/deepseek/` は価格スクレイパで別物
2. **options は何も設定していない** — `src/llms/registry/provider.ts:134` のコメントが
   *"The 6 shipped transformers don't take options today"* と明記している
3. **カスタムプラグイン読み込みが実装されていない** — `Transformers.tsx` は envelope の
   `transformers[]` を書くが、**それを読むコードが存在しない**。`PLUGINS_DIR` も `ensureDir`
   されるだけで一度も読まれない。この機能は外部依存 `@musistudio/llms` にあったもので、
   吸収時に実装が付いてこなかった。CLAUDE.md の記述だけが残骸として残っている

### 3.5 先に潰しておく誤解

| よくある想定 | 実際 |
|---|---|
| 「3つのAPIを実装する」 | **もう実装されている**。やるのは (a) ルーティングを効かせる (b) パリティを揃える (c) 面の知識を1箇所に集める |
| 「Gemini対応を進める」 | outbound(provider)は動いている。無いのは **inboundの有効化** と **サブスク枠** |
| 「CLIの `ccr` コマンド」 | すでに削除済み。ドキュメントだけが残骸 |

---

## 4. 目標アーキテクチャ

### 4.1 Inbound Surface レイヤ

```
                  ┌─ POST /v1/messages ─────────────── anthropic
  クライアント ───┼─ POST /v1/chat/completions ─────── openai-chat
  (Claude Code /  ├─ POST /v1/responses ────────────── openai-responses
   Codex / Gemini ├─ POST /v1beta/models/:m::action ── gemini        ★新規有効化
   CLI / SDK)     └─ GET  /v1/models ───────────────── catalog
                            │
                  ┌─────────▼──────────┐
                  │ InboundSurface     │  面ごとの知識を1つの記述子に集約:
                  │   registry         │  paths / auth / errorShape /
                  └─────────┬──────────┘  sseAggregator / inboundType /
                            │              extractModel / routingMode
                  ┌─────────▼──────────┐
                  │ Router             │  scenario → rule → preference chain
                  │  (面ごとに有効/無効) │  → quota-aware selection → failover
                  └─────────┬──────────┘
                            │
                  ┌─────────▼──────────┐
                  │ Provider transformer│ anthropic / openai / openai-responses
                  │  + pipeline        │ / gemini / *-oauth
                  └─────────┬──────────┘
                            ▼
             Anthropic / OpenAI / Google / DeepSeek / ...
```

面を1つ足す作業を「記述子を1つ足す」に落とす。これが今回の「集約」の本体である。

### 4.2 ルーティング適用モデル（新規）

各面は2つのモードのいずれかを取る。

| モード | 挙動 | 現行の該当 |
|---|---|---|
| `passthrough` | 呼び出し側が `provider,model` を指定し、そのまま上流へ | chat/completions・responses |
| `routed` | シナリオ分類 → ルール → 選好チェーン → quota-aware選択 → failover | messages |

**DB設計**: `RouterPreferenceProfile.key` を面ごとのキーとして使う。この列はもともと「将来の preference presets 用」としてスキーマコメント付きで置かれていた（現在は `key='live'` のシングルトン）。**新規テーブルなしで面ごとのプロファイルに転用できる**。

- `key='live'` → 既定プロファイル（現 messages 設定がそのまま移行）
- 面ごとに「既定を使う / 専用プロファイルを持つ」を選べる

**移行時の既定値は現行踏襲**（messages=`routed`、他=`passthrough`）。挙動は変わらず、UIから切り替えられるようになる。

---

## 5. フェーズ

順序の意図: **リネームを先に**やって以降のPRを綺麗な名前で書く / **UIモックを最初に**作って人間の承認を取り、承認済みモックを以降の実装ターゲットにする。

| Phase | 内容 | 破壊的 | 依存 |
|---|---|---|---|
| 0 | 土台整備・棚卸し | — | — |
| 1 | Rialto 全面リネーム | ✅ | 0 |
| 2 | Inbound Surface 集約 + ルーティング多面化 | 一部 | 1 |
| 3 | Gemini（inbound有効化 / api_key / サブスク枠） | — | 2 |
| 3.5 | 認証（Cloudflare Access + トークン） | 一部 | 2 |
| 4 | Zod スキーマ層分け | — | 2 |
| 5 | UI 刷新（モック駆動） | — | 2,3,4 |
| 6 | 仕上げ・v3.0.0 | — | 全部 |

**UIモックだけは Phase 0 と並行して先行作成する**（人間レビューのリードタイムを確保するため）。

---

### Phase 0 — 土台整備・棚卸し

**目的**: 以降の大規模変更を安全に回すレールを敷く。

作業:
- `CLAUDE.md` の陳腐化修正 — monorepo記述の削除、`ccr` CLIコマンド節の削除、実体（単一パッケージ / `src/` レイアウト / Hono+Vite+Prisma+Docker）への更新
- `knip` でデッドコード棚卸し。`google-auth-library` / `fastify` / `@fastify/cors` / `fastify-plugin` の削除可否を確定
- `src/providers/`（vendorスクレイパ registry）と `src/llms/registry/provider.ts`（ランタイム provider registry）の役割境界をドキュメント化。同名で別物なので混同のもと
- テストのフレーク解消 — フルスイート実行時のみ `__tests__/services/config/envelope.test.ts` が8件落ちる既知の問題を切り分けて潰す
- inboundパリティ用のゴールデンフィクスチャ基盤を `__tests__/providers/__fixtures__` の仕組みの上に**inbound面別**へ拡張

完了条件:
- `bun run knip` が新規の未使用報告ゼロ
- フルスイートが安定してグリーン
- `CLAUDE.md` の記述と実装が一致

---

### Phase 1 — Rialto 全面リネーム

**目的**: 名実を一致させる。機械的置換のみの単独PRとし、ロジック変更を混ぜない（レビュー可能性の確保）。

置換マップ:

| 現在 | 新 |
|---|---|
| `Claude Code Router` | `Rialto` |
| `CCR`（識別子・コメント） | `Rialto` |
| `ccr`（変数・関数名） | `rialto` |
| `claude-code-router`（パッケージ/パス） | `rialto` |
| `CCR_HOME_DIR` | `RIALTO_HOME_DIR`（旧名も読む・deprecation warn） |
| `~/.claude-code-router` | `~/.rialto` |
| `tkgling/claude-code-router`（Docker） | `tkgling/rialto` |
| `@musistudio/claude-code-router`（package name） | `rialto` |
| GitHubリポジトリ `claude-code-router` | `rialto` |

**HOME_DIR移行**（最重要・唯一のデータリスク）:

```
起動時 migrateHomeDir():
  1. ~/.rialto が存在 → 何もしない（冪等）
  2. ~/.rialto が無く ~/.claude-code-router がある
     → コピー（renameではない）して ~/.claude-code-router はそのまま残す
     → 「旧ディレクトリは手動で削除してよい」旨をログに出す
  3. どちらも無い → 通常の initDir()
```

rename ではなく **コピー**にするのは、ロールバック時に旧バージョンが動かなくなるのを避けるため。

注意点:
- `<CCR-SUBAGENT-MODEL>` タグは**外部契約**（ユーザーのサブエージェントプロンプトに書かれている）。`<RIALTO-SUBAGENT-MODEL>` を新名として受け付けつつ、旧タグも当面受理する
- GHCR は `ghcr.io/${{ github.repository }}` を使っているのでリポジトリ改名でイメージパスが変わる。旧パスに deprecation 用の最終タグを残す
- `~/.claude/projects/<id>/claude-code-router.json`（プロジェクト単位のルーティング上書き）も外部契約。新名 `rialto.json` を優先し旧名もフォールバック
- Prismaのスキーマコメント / locales 3言語 / README 3言語 / `docs/**` も対象

完了条件:
- 残存する `claude-code-router` 参照が「意図的な後方互換フォールバック」のみ
- 旧HOME_DIRを持つ環境で起動 → 設定が引き継がれる統合テストがグリーン

---

### Phase 2 — Inbound Surface 集約 + ルーティング多面化

**目的**: §3.2 と §3.3-1,2 を潰す。今回のリファクタの中核。

#### 2-1. `InboundSurface` 記述子の導入

`src/api/v1/` を `src/api/inbound/` に整理し、面ごとの知識を1つの記述子へ集約する:

```ts
interface InboundSurface {
  id: 'anthropic' | 'openai-chat' | 'openai-responses' | 'gemini'
  paths: string[]                       // ルート登録
  auth: 'x-api-key' | 'bearer' | 'google'
  errorShape: (status, message, upstream?) => unknown
  aggregateSse: (res: Response) => Promise<Record<string, unknown>>
  extractModel: (req) => string | undefined   // geminiはパスから取る
  inboundType: 'anthropic' | 'openai' | 'gemini'
  defaultRoutingMode: 'routed' | 'passthrough'
}
```

散っていた `errorShapeForPath` / `pickSseAggregator` / `openaiBearerAuth` のパス列挙 / `inboundType` を、この記述子1つに寄せる。

#### 2-2. Gemini 受け口の有効化

- `POST /v1beta/models/:modelAndAction` を実際にマウント（現状は宣言のみで到達不能）
- 認証: `x-goog-api-key` ヘッダと `?key=` クエリを受理する `googleApiKeyAuth` を追加
- モデル名はパスから来る（bodyに無い）→ `extractModel` で吸収
- エラー形式3種目: `{ error: { code, message, status } }` を `errorShape` に追加
- `aggregateGeminiSseToJson` を追加
- `RequestLog.inboundType` に `'gemini'` を追加（マイグレーション）

#### 2-3. ルーティングの多面化

- `scenario-router.ts` のハードコードされたバイパスを削除し、面の `routingMode` を参照する形に置き換える
- `RouterPreferenceProfile.key` を面キーとして使う（§4.2）
- `/api/router-preferences` に面パラメータを追加
- **既定値は現行踏襲**（messages=routed、他=passthrough）。挙動不変のまま設定可能になる

#### 2-4. transformer選択の廃止

§3.4 の結論。選択肢が実質存在しない設定欄を消す。

- `provider.transformer.use` を廃止し、`apiStyle` + `authMode` からの導出に一本化
- ナビの Transformers 画面と、provider 編集ダイアログの transformer picker / options エディタを削除
- `Provider.transformer` JSONB は残すが、中身は既に `_disabledModels` / `providerEnabled` という
  別用途になっているので、Phase 4 で正式なカラムへ昇格させて JSONB を畳む
- UIには**読み取り専用の Request shape** 表示だけ残す（apiStyle / auth / pipeline / endpoint）。
  「このproviderが何を喋るか」は不調時の診断に効く
- envelope の `transformers[]` と `PLUGINS_DIR` は、読み手が無いので削除。CLAUDE.md の
  該当記述も落とす
- `VENDOR_DEFAULTS.deepseek` の宙に浮いた `use: ['deepseek']` を除去

失うのは「将来カスタム transformer を挿す拡張点」だが、**その拡張点は現在動いていない**ので、
失うのは実装ではなく設定欄だけ。必要になったら `InboundSurface` レジストリと同じ形で
`apiStyle → transformer` の写像に1行足す方が素直。

#### 2-5. パリティ・マトリクス

面 × 機能で表を定義し、各セルにテストを割り当てる。

| | messages | chat/completions | responses | gemini |
|---|---|---|---|---|
| ストリーミング (SSE) | | | | |
| 非ストリーム集約 | | | | |
| tool use | | | | |
| system プロンプト | | | | |
| 画像入力 | | | | |
| thinking / reasoning | | | | |
| usage 記録 (RequestLog) | | | | |
| エラー形式 | | | | |
| cacheトークン計上 | | | | |
| failover / 429 | | | | |

**空白セルの洗い出しがこのフェーズの実質的な成果物**。埋められないセルは「未対応」として明示的にドキュメント化する（黙って落とさない）。

完了条件:
- 面を1つ足す作業が「記述子を1つ足す」だけで済む
- 4面すべてでルーティング設定が効く（面ごとにon/off可能）
- パリティ・マトリクスの全セルに「対応済み / 未対応（理由付き）」のラベルとテストがある

---

### Phase 3 — Gemini 対応

**目的**: Gemini を api_key 枠・サブスク枠の両方で一級市民にする。

#### 3-1. `google`（api_key）の品質向上

既存の `GeminiTransformer` + `src/llms/utils/gemini*` を、Phase 0 で整えたフィクスチャで固める。既存の `__tests__/providers/__fixtures__/google-gemini-*` を拡張。

#### 3-2. `gemini-cli`（subscription）の新設

Claude Code / Codex と**同じ形**に載せる（`OauthBase` → `SubAccount` → quota collector）。

- **OAuth**: Gemini CLI の client_id + PKCE。`~/.gemini/oauth_creds.json` からのインポートにも対応（Claude/Codexと同じく `POST /api/oauth/import-credentials` 経路）
- **エンドポイント**: Code Assist API（`cloudcode-pa.googleapis.com`）。`:generateContent` / `:streamGenerateContent` の前に `:loadCodeAssist` / `:onboardUser` で projectId を解決する必要がある
- **transformer**: `GeminiCliOauthTransformer`（`ClaudeCodeOauthTransformer` / `CodexOauthTransformer` と同じ構造）
- **SubAccount**: `buildGeminiDiscoveredAccount` を追加。plan は `free` / `ai-pro` / `ai-ultra`、`monthlyPriceUsd` を `pricing.ts` に追加
- **ApiStyle**: enum に `gemini_code_assist` を追加（マイグレーション）
- **SUBSCRIPTION_PRESETS** に `gemini-cli` を追加

**未確定リスク（正直に）**: Code Assist API は非公開APIで、Claude / Codex のようなクォータ取得エンドポイントが公開されているか未検証。取得できない場合は:
- `SubAccountQuota` は書かれず、`routing-scheduler` の collector は当該アカウントで no-op
- 429反応型のfailoverのみで運用（proactiveな回避は不可）

この分岐は Phase 3 の**最初のスパイクで判定**し、結果を本ドキュメントに追記する。ToS 上の扱いもあわせて確認する。

#### 3-3. 周辺の組み込み

- `model-test-service` / `probes.ts` に gemini_code_assist 用プローブ
- 価格スクレイプ（`scrape-gemini-pricing.ts`）はサブスク枠には無関係なので api_key 側のみ
- Router / catalog / UI のモデル一覧に反映

完了条件:
- Gemini CLI で `RIALTO_BASE_URL` を向けて実際に対話できる
- Gemini のサブスクアカウントが Providers 画面に Claude / Codex と並んで表示される
- クォータ取得可否の結論が本ドキュメントに記録されている

---

### Phase 3.5 — 認証: Cloudflare Access + アクセストークン

**目的**: §3.3-9 を潰す。単一 `APIKEY` を、**面ごとに責任者が違う2層**に置き換える。

#### 3.5-0. 前提となる構成

管理UIは Cloudflare Access（エッジ）で守り、`/v1/*` は Rialto 自身のトークンで守る。

```
Access app A:  rialto.example.com/     Allow (email)     → UI + /api/*
Access app B:  rialto.example.com/v1   Bypass (Everyone) → Rialto の access token
```

**`/v1/*` を Bypass にせざるを得ない理由**: Claude Code / Codex CLI / Gemini CLI はブラウザでは
ないので対話ログインができず、サービストークン（`CF-Access-Client-Id` / `CF-Access-Client-Secret`）
のヘッダも送れない。よってこの経路はエッジを素通りさせ、Rialto のトークンが唯一の門になる。

（クライアントが任意ヘッダを送れる場合は Service Auth ポリシーでエッジ側にも門を置ける。
CI など制御下のクライアントでは検討する価値がある。）

#### 3.5-1. Access JWT の検証（`/api/*`）

- ヘッダ `Cf-Access-Jwt-Assertion` の JWT を検証する
- JWKS: `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`
- `issuer` = チームドメイン、`audience` = そのアプリの AUD タグ（`ACCESS_AUD`）
- 検証済み payload の `email` を管理操作の実行者として記録する
- **ヘッダを信用するだけでは不可**。オリジンに直接到達できると偽装できるため、
  cloudflared 経由でオリジンを非公開にするか、検証を必ず通す

**ログイン画面は作らない。** 認証主体が Cloudflare に移るので、アプリ側に持つと認証系が
二重になり、弱いほうが残る。`Login.tsx` は Phase 5 で削除する。

#### 3.5-2. アクセストークン（`/v1/*`）

```
AccessToken
  id, name, tokenHash (sha256, unique), prefix (表示用の先頭8文字)
  endpoint     面に固定する場合のみ（null = 全面）
  profileKey   RouterPreferenceProfile.key（null = 既定）
  lastUsedAt, requestCount, expiresAt?, revokedAt?
```

- **スコープは廃止**。全トークンが `/v1/*` 専用（`admin` は Cloudflare Access が代替する）
- 平文は保存しない。発行時に1度だけ表示し、以後は復旧不能（再発行のみ）
- ホットパスなので `lru-cache`（既存依存）でハッシュ→行をキャッシュ。失効時に無効化。
  現行の fail-closed 挙動は維持する
- `RequestLog` に `accessTokenId` を追加 → Activity で「どのクライアントが焼いたか」が出せる

#### 3.5-3. 認証モード

| モード | `/api/*` | `/v1/*` | 用途 |
|---|---|---|---|
| `cloudflare_access` | Access JWT（+ bootstrap token フォールバック） | AccessToken | 公開デプロイ |
| `token` | bootstrap token | AccessToken | ローカル / loopback |

**envelope の bootstrap token は残す**。Access が前段に無いローカル実行と、Postgres が落ちて
UIごと締め出される事態の両方を救う。env 名は `RIALTO_TOKEN`（旧 `APIKEY` も読む、Phase 1）。

得られるもの: エッジでの ID 認証、個別失効、帰属、そして**クライアント単位のルーティング**
（CIのトークンだけ `cost-first` に固定する、など）。

モック: `mocks/settings-access.html` / `mocks/system-states.html`（Access 拒否時）

### Phase 4 — Zod スキーマ層分け

**目的**: §3.3-3 を潰す。29ファイルのフラット層を役割で分ける。

```
src/schemas/
  primitives/   RecordSchema・共通enum・共通スカラ
  wire/         外部ワイヤ形式（inbound surface と1:1）
    anthropic/  openai/  gemini/
  domain/       Provider / Model / Router / SubAccount … DB由来のドメイン型
  api/          /api/* の request/response DTO（domain から導出、.openapi() はここだけ）
  forms/        UIフォーム（api から導出）
```

規約:
- 型の唯一の源は `z.infer`。手書きの重複 interface を作らない
- `.openapi()` は `api/` 層でだけ付ける
- barrel は**層単位**（`@/schemas/wire` など）。全体 barrel `@/schemas` は廃止する
- Zod v4 の機能を使う: `z.iso.datetime()` / `z.strictObject` vs `z.looseObject` の意図的な使い分け / registry API

作業:
- まず重複の実測。`Provider` 形が `config.dto` / `provider.dto` / `llm-pipeline.dto` / `preset.dto` に散っている疑いがあるので、計測してから1本化する（推測で統合しない）
- 移行は旧 barrel を re-export shim にして段階的に。最後に shim を削除

完了条件:
- `@/schemas` の全体 barrel が消えている
- UIバンドルにサーバ専用スキーマが入っていない（bundle analyzer で確認）
- スキーマ総行数が削減（数値目標は重複の実測後に設定する）

---

### Phase 5 — UI 刷新（モック駆動）

**目的**: 15以上に散った画面を5つに集約し、視覚設計を刷新する。**基盤は維持**（react-router-dom v7 / shadcn / Tailwind v4）。

#### 5-1. 新しい情報設計

| 新画面 | 統合元 |
|---|---|
| **Overview** | 新規。稼働状態・4面のトラフィック・クォータ・直近セッション・コストの1枚要約 |
| **Routing** | RouterPreferences + RoutingLibrary + RoutingLiveEditor + RoutingPresetEditor + TierEditor + RouterUtilization |
| **Providers** | Providers + Subscriptions + ModelsDashboard + Transformers + catalog |
| **Activity** | Sessions + SessionDetail + Usage + ApiCost + LogViewer |
| **Settings** | SettingsPage + Presets + Personas + StatusLine + Debug。Access セクションに Cloudflare Access の状態とトークン管理（Phase 3.5）が入る |

`Login.tsx` は移行先を持たない — **削除**する（§Phase 3.5-1）。

Routing画面には **Phase 2 で入る「面セレクタ」** が乗る。ここが「messages専用に見える」問題の解消点。

#### 5-2. モック駆動の進め方

1. `mocks/**/*.html` に静的モックを作る（プロジェクトと**同じTailwind・同じデザイントークン**でビルド） — **完了**
2. **人間がモックをレビューして承認する** ← ここで一旦停止（**現在ここ**）
3. 承認されたモックを実装ターゲットとしてReactコンポーネントを実装
4. `ui-mock-diff` スキルで、モックとReact実装をRetina解像度（`deviceScaleFactor: 2`）で撮影し、ピクセル差分を取って収束させる

作成済みの成果物:

レビューの入口: `bun run mocks:serve` → http://localhost:16176/mocks/index.html
（21ビュー。既存の全ルートとダイアログの行き先が index に「統合元」として明記してある）
（`file://` で直接開いてもよい。両者のレンダリングがピクセル単位で同一であることは `mocks:diff` で確認済み）

| パス | 内容 |
|---|---|
| `mocks/index.html` | レビュー用の入口 |
| `mocks/*.html` | **21ビュー**（トップレベルは5画面）。既存22ルート + ダイアログ群を全部カバー。内訳は `mocks/README.md` |
| `mocks/_shared/mock.css` | Tailwindエントリ。`src/index.css` のトークンを逐語コピー |
| `mocks/mocks.json` | 画面レジストリ（モック ↔ Reactルート） |
| `.claude/skills/ui-mock-diff/SKILL.md` | スクショ差分ワークフローのスキル |
| `scripts/build-mock-css.ts` | `bun run mocks:css` |
| `scripts/serve-mocks.ts` | `bun run mocks:serve`（:16176、配信範囲は allowlist 制） |

モックが実装ターゲットとして成立する根拠: `mocks:css` はプロジェクト本体と同じ Tailwind
（`@tailwindcss/node`）でコンパイルし、`src/index.css` の `:root` / `.dark` ブロックが
ずれていたら**ビルドを失敗させる**。フォントとアイコンも `node_modules` から同じ実体を読む。
したがってスクショ差分に出るのはツールチェーン差ではなくデザイン差である。

差分の読み方（`ui-mock-diff` スキル）: 全体一致率は背景の白が支配的なため過小に出る。
**判断材料は `report.json` の `regions`**（差分密度の高い順に並んだ64デバイスpxセル）。

#### 5-3. 遵守すべきUI規約

- `src/components/ui/*.tsx` は**編集禁止**。shadcn CLI (`bunx shadcn@latest add <c> --overwrite`) 経由のみ
- shadcn の `Card` は使わない。`border-l` アクセント + `hover:bg-muted/50` のフラットパターンで統一
- 表で複合指標を1セルに詰めない（`W–L–D` ではなく `W` / `L` / `D` の独立列）。数値は右寄せ mono
- 金額表示は有効数字3桁。既存の `fmtCost` を import する（新規formatterを作らない）
- i18n 3言語（en / ja / zh）のキーを画面統合にあわせて再編する

完了条件:
- 承認済みモックとReact実装の差分が閾値以下（初期目標: 主要ビューポートで mismatch < 2%）
- 旧コンポーネントが削除されている（残骸を残さない）
- 3言語すべてでキー欠落ゼロ

---

### Phase 6 — 仕上げ・v3.0.0

- `knip` クリーン
- `CLAUDE.md` / `README.md`(×3言語) / `docs/**` の全面更新
- Dockerイメージ移行のアナウンス（旧タグに最終ビルド + deprecation notice）
- マイグレーションガイド（旧HOME_DIRからの移行 / 旧Dockerイメージからの移行 / `<CCR-SUBAGENT-MODEL>` タグの新名）
- `v3.0.0` リリース

---

## 6. リスクと緩和

| リスク | 影響 | 緩和 |
|---|---|---|
| HOME_DIR移行の失敗で設定喪失 | 致命 | renameではなく**コピー**。旧ディレクトリを残す。冪等。統合テストを書く |
| GHCRイメージパス変更でpull断 | 大 | 旧パスに最終タグ + deprecation notice。READMEに移行手順 |
| Code Assist APIが非公開で仕様変更 | 中 | Phase 3 冒頭でスパイク。クォータ取得不可なら429反応型に限定して明示 |
| リネームと機能変更の同時実行でレビュー不能 | 中 | Phase 1 を**機械的置換のみの単独PR**に隔離 |
| ルーティング多面化で既存messages挙動が変わる | 大 | 既定値を現行踏襲に固定。既存フィクスチャで回帰を押さえる |
| UI全面刷新の途中で使えない期間が出る | 中 | モック承認 → 画面単位で差し替え。旧画面は差し替え完了まで残す |
| `<CCR-SUBAGENT-MODEL>` の改名で外部プロンプトが壊れる | 中 | 旧タグを当面受理。deprecation warn |
| 大量PRでbackmergeが詰まる | 小 | 既存の backmerge ワークフローに従う。Phase単位でdevelopへ着地 |

---

## 7. 検証計画

- **単体**: `bun test __tests__/lib __tests__/db __tests__/preset`
- **プロバイダ契約**: `bun test __tests__/providers`（フィクスチャ再生）
- **inboundパリティ**: §2-4 のマトリクス全セル
- **移行**: 旧HOME_DIR環境からの起動
- **UI**: `ui-mock-diff` スキルによるスクリーンショット差分（light / dark 両方）
- **CI**: `Build` / `Type Check` / `Test` の3ゲートを維持

Prismaマイグレーション後は `bun run db:migrate:test`（`ccr_test`）も必ず流す。

---

## 8. リリース / ブランチ運用

- ベースは `develop`。Phase単位で feature ブランチ → PR → develop
- 本番反映は `develop → master`（devflow の `release` スキル）
- commitlint: scope に `ui` / `format` は不可（`style` は可）。body は200字/行
- バージョンbumpは feature PR 内で手動。CIの `check-version.ts` が唯一の検査

---

## 9. トラッキング

各Phaseに `Done / In Progress / Blocked` を追記して運用する。

| Phase | 状態 | 備考 |
|---|---|---|
| UIモック先行作成 | **Done → 承認済み** | 21ビュー × light/dark（42枚）。`bun run mocks:serve` で確認 |
| `ui-mock-diff` スキル | **Done** | `bun run mocks:{css,shoot,diff}` |
| 0 土台整備 | Not started | envelope.test.ts のフルスイート限定フレークは未解消 |
| 1 Rialtoリネーム | Not started | UI表記のみ先行（サイドバーが `Rialto`）。HOME_DIR / パッケージ名は未着手 |
| 2 Inbound集約+多面ルーティング | **In Progress** | 記述子レジストリ + `InboundSurfaceConfig` + 面ごと profileKey は着地。`docs/architecture/inbound-surfaces.md` |
| 3 Gemini | Not started | 記述子は置いたが `/v1beta/models/*` は未マウント。Code Assist クォータ取得の可否も未確定 |
| 3.5 認証 | Not started | `/api/identity` は表示専用で認証していない。AccessToken テーブルは未作成 |
| 4 Zodスキーマ | Not started | |
| 5 UI刷新 | **In Progress** | 新シェル + Overview が着地。残り20ビューを実装中 |
| 6 仕上げ・v3.0.0 | Not started | |
