[![](https://img.shields.io/badge/🇬🇧-English-000aff?style=flat)](README.md)
[![](https://img.shields.io/badge/🇯🇵-日本語-bc002d?style=flat)](README_ja.md)
[![](https://img.shields.io/badge/🇨🇳-中文版-ff0000?style=flat)](README_zh.md)
[![Discord](https://img.shields.io/badge/Discord-%235865F2.svg?&logo=discord&logoColor=white)](https://discord.gg/rdftVMaUcS)
[![](https://img.shields.io/github/license/tkgstrator/rialto)](https://github.com/tkgstrator/rialto/blob/master/LICENSE)

<hr>

> Claude Code のセットアップを変えることなく、あらゆる LLM プロバイダーへリクエストをルーティングする強力なプロキシ。

## ✨ 機能

- **タスクベースのルーティング** — 6 つの組み込みシナリオにそれぞれ異なるモデルを割り当て：`default`、`background`、`think`（プランモード）、`longContext`、`webSearch`、`image`。
- **クォータ対応フォールバック** — シナリオごとの順序付きフォールバックチェーンと、サブスクリプションプロバイダーが週次ドレイン目標を超えたときの先回りフェイルオーバー。effort とモデルティアのシグナルで軽いリクエストを Sonnet、重いリクエストを Opus へ振り分け。
- **ペルソナ** — Claude Code 本体に触らずに、ユーザー向けリクエストへ毎回名前付きのシステムプロンプトを追記。Personas ページでライブラリを管理し、Router ページでアクティブなペルソナを選択。
- **マルチプロバイダー対応** — API キー型プロバイダー（Anthropic、OpenAI、DeepSeek、Gemini、Groq、OpenRouter など）やサブスクリプション型プロバイダー（Claude Code OAuth、OpenAI Codex）に接続。
- **サブスクリプション監視** — レート制限ウィンドウを追跡し、実際の API コストとサブスクリプション料金を比較。
- **使用量・コストダッシュボード** — プロバイダー別・モデル別のコスト内訳と日別コストグラフ。
- **リクエスト履歴** — 過去のセッションをリクエスト単位の統計・アーカイブ済み会話とともに閲覧。
- **Web 管理 UI** — ブラウザで完結する設定管理。手動 JSON 編集不要。
- **トランスフォーマーパイプライン** — 組み込みトランスフォーマーにより Anthropic 形式のリクエストを各プロバイダー API に適合。
- **カスタム JavaScript ルーター** — 組み込みシナリオを超えた任意のルーティングロジックを実装。
- **サブエージェントモデル固定** — インラインプロンプトタグで個々のサブエージェントを特定のプロバイダー・モデルに誘導。
- **ステータスライン** — Claude Code のステータスバーに Rialto のリアルタイム状態を表示。
- **Docker ファーストデプロイ** — PostgreSQL と Redis を含む `docker compose up -d` 一発起動。

## 🖥️ Web UI

![Models ページ](docs/images/screenshot-models.webp)

Web UI（デフォルトでポート **3456** で提供）でルーターのあらゆる設定を管理できます：

| ページ | 目的 |
|--------|------|
| **Models** | 有効なモデル、価格、コンテキストウィンドウの確認と接続テスト |
| **Providers** | API キー型・サブスクリプション型プロバイダーの追加・編集・削除 |
| **Router** | 各ルーティングシナリオへのモデル割り当て、アクティブペルソナの選択 |
| **Personas** | 名前付きシステムプロンプトのライブラリ管理（作成・編集・削除）|
| **Subscriptions** | レート制限ウィンドウの監視とサブスクリプションコスト対 API 支出の比較 |
| **Usage** | プロバイダー・モデル別 API コスト内訳と時系列グラフ |
| **Sessions** | 過去のセッションの閲覧（リクエスト単位のログとアーカイブ済み会話）|
| **Settings** | ホスト、ポート、プロキシ、ログ、ステータスライン、API キーの設定 |

![Providers ページ](docs/images/screenshot-providers.webp)

![Router ページ](docs/images/screenshot-router.webp)

![Usage ページ](docs/images/screenshot-usage.webp)

## 🚀 Docker クイックスタート（推奨）

[Docker](https://docs.docker.com/get-docker/) と [Docker Compose](https://docs.docker.com/compose/install/) をインストール後：

**ステップ 1 — 作業ディレクトリと最小限の設定ファイルを作成：**

```shell
mkdir -p ~/rialto ~/.rialto
cd ~/rialto

cat > ~/.rialto/config.json << 'EOF'
{
  "APIKEY": "your-secret-key"
}
EOF
```

> `APIKEY` は Web UI（`/api/*`）を保護します。省略すると初回起動時に自動生成されサーバーコンソールに表示されます。
>
> **`/v1/*` の認証には使えません。** クライアントは **Settings → Access** で発行する*アクセストークン*で接続します。個別に失効でき、リクエスト単位で帰属が取れ、エンドポイントとルーティングプロファイルにスコープできます。トークンを1本も発行していないインストールはプロキシを通せません。

**ステップ 2 — `compose.yaml` をダウンロード：**

```shell
curl -fsSL https://raw.githubusercontent.com/tkgstrator/rialto/master/compose.yaml -o compose.yaml
```

**ステップ 3 — （任意）プロバイダー認証情報を `.env` に記述：**

```shell
cat > .env << 'EOF'
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...
ANTHROPIC_API_KEY=sk-ant-...
EOF
```

**ステップ 4 — サービスを起動：**

```shell
docker compose up -d
```

サーバーが `http://127.0.0.1:3456` で起動します。ブラウザで開き `APIKEY` でサインインした後、**Providers** ページと **Routing** ページで設定を完了します。続けて **Settings → Access** でアクセストークンを発行してください — クライアントが認証に使うのはこちらです。

**ステップ 5 — Claude Code からルーターに接続：**

```shell
ANTHROPIC_BASE_URL=http://127.0.0.1:3456 ANTHROPIC_AUTH_TOKEN=rialto_your-access-token claude
```

シェル設定ファイルに永続的に追記する場合：

```shell
export ANTHROPIC_BASE_URL=http://127.0.0.1:3456
export ANTHROPIC_AUTH_TOKEN=rialto_your-access-token
```

**ログを確認：**

```shell
docker compose logs -f
```

**設定変更を反映：**

```shell
docker compose restart
```

## 🔌 プロバイダーの接続

### API キー型プロバイダー

**Providers** ページで任意の API キー型プロバイダー（Anthropic、OpenAI、DeepSeek、Gemini など）を選択し、API キーを入力して保存します。`$VAR` 形式の環境変数補間に対応しているため、シークレットをファイルに直書きせず管理できます。

### サブスクリプション型プロバイダー（Claude Code・Codex）

Rialto はサブスクリプション型プロバイダーを API キーなしでルーティングに利用できます。

**Claude Code** — **Providers** ページ → **Subscription** タブ → **Connect** から OAuth フローを完了してください。Rialto が認証情報を保存・自動更新します。

**Codex（OpenAI）** — 現在、ブラウザ経由のログインは未対応です。認証はファイルアップロードによる認証情報の登録のみサポートしています。

![Subscriptions ページ](docs/images/screenshot-subscriptions.webp)

> **利用規約に関する注意：** Claude Code のサブスクリプションを Claude Code 以外のアプリケーションからのリクエストに使用することは、[Anthropic の利用ポリシー](https://www.anthropic.com/legal/aup) に違反する可能性があります。この機能の使用は自己責任で判断してください。

## ⚙️ 設定

### ディスクエンベロープ（`~/.rialto/config.json`）

起動時のスカラー値とディスク常駐オブジェクトを格納します。環境変数補間（`$VAR` / `${VAR}`）と JSON5 コメントをサポート。直近 3 世代のバックアップを自動保持。

| キー | 説明 |
|------|------|
| `APIKEY` | `/api/*` 用の管理シークレット。`x-api-key` または `Authorization: Bearer` で送信。`/v1/*` では受理されません |
| `HOST` | リスニングアドレス。デフォルトは `127.0.0.1`。リバースプロキシ背後では `0.0.0.0`（`APIKEY` 必須）|
| `ACCESS_TEAM_DOMAIN` | Cloudflare Access のチームドメイン。`ACCESS_AUD` と併せて `/api/*` の assertion を検証します |
| `ACCESS_AUD` | Access アプリケーションの AUD タグ。**両方揃わないと有効になりません** |
| `PORT` | リスニングポート（デフォルト：`3456`）|
| `LOG` | `true` でログファイルを有効化 |
| `LOG_LEVEL` | `fatal` / `error` / `warn` / `info` / `debug` / `trace` |
| `PROXY_URL` | アップストリーム API リクエスト用 HTTP プロキシ |
| `API_TIMEOUT_MS` | アップストリーム API コールタイムアウト（ms、デフォルト：`600000`）|
| `CLAUDE_PATH` | `claude` 実行ファイルへのパス |
| `NON_INTERACTIVE_MODE` | Docker / CI 環境で `true` を設定（stdin ハング防止）|
| `CUSTOM_ROUTER_PATH` | カスタム JavaScript ルーターモジュールへの絶対パス |

### プロバイダー・モデル・ルーター（データベース）

初回起動後、プロバイダー・モデル・ルータースロットは Web UI または設定 API を通じて PostgreSQL で管理されます（`config.json` ではありません）。初回起動時に `config.json` の `Providers` / `Router` キーがデータベースに自動マイグレーションされます（一回限り・冪等）。

### ルーティングシナリオ

**Router** ページで各シナリオに使用するモデルを設定します：

| シナリオ | 適用タイミング |
|----------|--------------|
| `default` | 他のシナリオにマッチしないすべてのリクエスト |
| `background` | 軽量なバックグラウンドタスク |
| `think` | 推論集約型タスク（プランモード）|
| `longContext` | コンテキスト閾値超過のリクエスト（デフォルト 60 000 トークン）|
| `webSearch` | ウェブ検索タスク（モデルがネイティブに検索をサポートしている必要あり）|
| `image` | 画像関連タスク（Rialto 組み込み画像エージェントを使用）|

### effort・ティア・フォールバック

上記のシナリオトリガーに加えて、ルーターはリクエストをグレーディングし、順序付きフォールバックチェーンを辿ります：

- **グレーディングシグナル** — `output_config.effort`（low/medium → `default`、high/xhigh/max → `longContext`）と、effort が無いときに `body.model` から読む要求モデルティア（opus → 重い、sonnet/haiku → 軽い）。effort で low/medium が明示されているときはティアのフォールバックを抑制するので、Claude Code の opus デフォルトを呼び出し側から軽くダウングレードできます。
- **シナリオごとのフォールバックチェーン** — 各スロットは `provider,model` 形式の順序付きフォールバックリストを持ちます。ルーターは `[primary, ...fallbacks]` を辿り、週次ウィンドウのヘッドルームがあり、かつリクエストを収容できるコンテキストウィンドウを宣言した最初の候補を選びます。
- **週次ドレインガード** — サブスクリプションプロバイダーは*週次*使用量が線形ドレイン目標を超えるとスキップします（claude は `seven_day_opus` または `seven_day`、codex は `secondary`）。5h / codex プライマリは*ソフト*ウィンドウなのでバーストしてもフェイルオーバーは発火しません。`Router.weeklyDrainMarginPct`（0〜100、デフォルト 0）でガードが発火するまでに許す超過幅を増やせます（フェイルオーバーするより週次を使い切りたい場面向け）。
- **能力ゲート** — 宣言された `contextWindow` がリクエストを収容できない振り先には絶対にフェイルオーバーしません。ウィンドウ未宣言のモデルは許可します（unknown = allow、保守的なデフォルト）。
- **マルチアカウントバランシング** — 同一 Claude プロバイダーで複数の SubAccount が有効なとき、セッションルーターは週次ヘッドルームが最も大きい（線形ドレイン目標から最も離れた）アカウントを選び、同セッション内の後続リクエストはそのアカウントに固定します。

ルーティング判断は構造化ログに記録され、フェイルオーバー時は `{ from, to, scenario, marginPct, tokenCount, trace }` を、全候補が拒否されたときは "dead chain" 警告ログを出します。trace には候補ごとに `rate-limited` / `capability` / `malformed` / `kept` のいずれかが残るので、何が試されてなぜ落ちたかが追えます。

### ペルソナ

*ペルソナ*とは、シナリオ判定後にユーザー向けリクエストへ毎回追記される、名前付きのシステムプロンプト断片です。Claude Code 本体に手を入れずに、口調・役割・作業ルールを常時上乗せできます。

- **ライブラリ** — `Personas` はディスクエンベロープのトップレベル配列。各エントリは安定 uuid の `id`、表示用の `name`（一意でなくてよい）、本文の `prompt` を持ちます。新規インストールには小さなスターターライブラリが同梱されますが、既存環境はディスク上の既存内容を維持します。
- **アクティブ選択** — Router ごとに 1 つだけアクティブにできます。アクティブなペルソナの uuid id は `Router.persona` に乗り、ディスク側では `ActivePersona` エンベロープキーにラウンドトリップします。`null` / 欠落 / 空文字は「ペルソナ無し」。プロジェクト別・セッション別の Router オーバーライドファイルでも `Router.persona` を受け付けます。
- **挿入方法** — ルーターがシナリオを解決すると、アクティブペルソナの `prompt` を、`cache_control` を持つ最後の system ブロック（無ければ最後の文字列テキストブロック）に追記します。これによりペルソナはキャッシュプレフィクスの*内側*に収まり、追加のキャッシュブレークポイントを消費せず、リクエスト間でバイト単位の安定性が保たれます（Anthropic のプロンプトキャッシュが維持される）。`system` が文字列 / 未定義のときは結合、複数ブロックの配列のときはその場で更新します。
- **シナリオ除外** — `background` シナリオは除外します。タイトル生成等の軽量内部タスクで動くので、ペルソナの語り口が出力を汚染するのを避けるためです。他のシナリオ（default / think / longContext / webSearch / image）はアクティブペルソナを継承します。
- **サブエージェントとの相互作用** — ペルソナ挿入は `<RIALTO-SUBAGENT-MODEL>` タグ処理の*後*で走るので、サブエージェント呼び出しごとの system 内容を上書きせず、ペルソナと合成されます。

ライブラリ管理は **Personas** ページ（`/personas`）で、アクティブペルソナの切り替えは **Router** ページで行います。「ペルソナ無し」がデフォルトの no-op です。

再現精度の高いペルソナを書くための実践ガイド（構造パターン・アンチパターン列挙・`think` リクエスト向け思考制御）は [docs/guides/persona-authoring.md](docs/guides/persona-authoring.md) を参照してください。

### トランスフォーマー

トランスフォーマーは Anthropic 形式のリクエストを各プロバイダーのワイヤーフォーマットに変換します。

**組み込みトランスフォーマー：**

| トランスフォーマー | 説明 |
|------------------|------|
| `Anthropic` | ネイティブ Anthropic エンドポイント向けパススルー |
| `claude-code-credentials` | ローカル Claude Code OAuth トークン（`~/.claude/.credentials.json`）を使用・自動更新 |
| `openai-responses` | OpenAI Responses API（`/v1/responses`）— Codex モデル向け |
| `OpenAI` | 標準 OpenAI Chat Completions API |
| `deepseek` | DeepSeek API |
| `gemini` | Google Gemini API |
| `openrouter` | OpenRouter API（`provider` ルーティングパラメータ対応）|
| `groq` | Groq API |
| `maxtoken` | `max_tokens` を上書き（`{ "max_tokens": N }` オプション対応）|
| `tooluse` | `tool_choice` によるツールコール最適化 |
| `reasoning` | `reasoning_content` フィールドの処理 |
| `sampling` | サンプリングフィールド（`temperature`、`top_p`、`top_k`、`repetition_penalty`）の処理 |
| `enhancetool` | ツールコールパラメータへのエラー耐性追加（ストリーミングツールコールは無効化）|
| `cleancache` | リクエストから `cache_control` を除去 |
| `vertex-gemini` | Vertex AI 認証経由の Gemini |
| `gemini-cli` *（実験的）* | Gemini CLI 経由の非公式 Gemini サポート |
| `qwen-cli` *（実験的）* | Qwen CLI 経由の非公式 qwen3-coder-plus サポート |
| `rovo-cli` *（実験的）* | Atlassian Rovo Dev CLI 経由の非公式 GPT-5 サポート |

**トランスフォーマー設定例：**

```json
{
  "name": "openrouter",
  "api_base_url": "https://openrouter.ai/api/v1/chat/completions",
  "api_key": "$OPENROUTER_API_KEY",
  "models": ["google/gemini-2.5-pro", "anthropic/claude-sonnet-4"],
  "transformer": { "use": ["openrouter"] }
}
```

モデル固有のトランスフォーマー：

```json
{
  "name": "deepseek",
  "api_base_url": "https://api.deepseek.com/chat/completions",
  "api_key": "$DEEPSEEK_API_KEY",
  "models": ["deepseek-chat", "deepseek-reasoner"],
  "transformer": {
    "use": ["deepseek"],
    "deepseek-chat": { "use": ["tooluse"] }
  }
}
```

オプション付きトランスフォーマー：

```json
{
  "transformer": {
    "use": [["maxtoken", { "max_tokens": 65536 }], "enhancetool"]
  }
}
```

### カスタム JavaScript ルーター

組み込みシナリオを超えたルーティングロジックには、ディスクエンベロープで `CUSTOM_ROUTER_PATH` を設定します：

```json
{
  "CUSTOM_ROUTER_PATH": "/home/user/.rialto/custom-router.js"
}
```

モジュールは `"provider,model"` または `null`（デフォルトルーターへのフォールバック）を返す `async` 関数をエクスポートする必要があります：

```javascript
module.exports = async function router(req, config) {
  const userMessage = req.body.messages.find(m => m.role === 'user')?.content;
  if (userMessage?.includes('このコードを説明して')) {
    return 'openrouter,anthropic/claude-3.5-sonnet';
  }
  return null;
};
```

完全な例はリポジトリルートの `custom-router.example.js` を参照してください。

### サブエージェントルーティング

サブエージェントのプロンプト先頭に以下のタグを付けて特定モデルに固定します：

```
<RIALTO-SUBAGENT-MODEL>provider,model</RIALTO-SUBAGENT-MODEL>
このコードの分析をお願いします...
```

## 📊 ログ

- **サーバーレベルログ**（pino）：`~/.rialto/logs/rialto-*.log` — HTTP リクエスト、API コール、サーバーイベント。レベルは `LOG_LEVEL` で制御。
- **アプリレベルログ**：`~/.rialto/rialto.log` — ルーティング決定とビジネスロジックイベント。

## 🛠️ 開発

### 前提条件

- Bun ≥ 1.1.0
- PostgreSQL
- Redis

デブコンテナ（`.devcontainer/compose.yaml`）が `postgres` と `redis` を自動的に提供します。

### セットアップ

```shell
bun install
```

```shell
# .env
DATABASE_URL=postgres://postgres:password@postgres:5432/rialto
REDIS_URL=redis://redis:6379
```

```shell
bun run db:migrate
bun run dev         # Vite 開発サーバー（ポート 16175）
```

### ビルド

```shell
bun run build       # Vite プロダクションビルド（SPA → dist/）
```

### テスト

```shell
bun run test              # ユニット・DB テスト
bun run test:providers    # プロバイダー統合テスト
```

### データベースツール

| スクリプト | 目的 |
|-----------|------|
| `bun run db:generate` | Prisma クライアント再生成 |
| `bun run db:migrate` | マイグレーション作成・適用（開発）|
| `bun run db:migrate:deploy` | 既存マイグレーション適用（本番 / CI）|
| `bun run db:reset` | スキーマ削除・再作成（破壊的）|
| `bun run db:studio` | Prisma Studio を開く |

DDL を直接編集せず、必ず Prisma マイグレーションを使用してください。

### 価格スクレイピング

| スクリプト | 目的 |
|-----------|------|
| `bun run scrape:openai-prices` | OpenAI モデル価格をスクレイピング |
| `bun run scrape:anthropic-prices` | Anthropic モデル価格をスクレイピング |
| `bun run scrape:google-prices` | Google / Gemini 価格をスクレイピング |
| `bun run scrape:prices` | 上記すべてをスクレイピング |

### リリース

| スクリプト | 目的 |
|-----------|------|
| `bun run release` | ビルドして Docker イメージを公開 |
| `bun run release:docker` | Docker イメージのみ公開 |

## ライセンス

MIT — `LICENSE` を参照。
