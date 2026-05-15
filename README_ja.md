![](blog/images/claude-code-router-img.png)

[![](https://img.shields.io/badge/%F0%9F%87%AC%F0%9F%87%A7-English-000aff?style=flat)](README.md)
[![](https://img.shields.io/badge/%F0%9F%87%A8%F0%9F%87%B3-%E4%B8%AD%E6%96%87%E7%89%88-ff0000?style=flat)](README_zh.md)
[![Discord](https://img.shields.io/badge/Discord-%235865F2.svg?&logo=discord&logoColor=white)](https://discord.gg/rdftVMaUcS)
[![](https://img.shields.io/github/license/musistudio/claude-code-router)](https://github.com/musistudio/claude-code-router/blob/main/LICENSE)

<hr>

![](blog/images/sponsors/glm-en.jpg)
> このプロジェクトは Z.ai のスポンサーを受けており、GLM CODING PLAN によってサポートされています。

> GLM CODING PLAN は AI コーディング向けサブスクリプションサービスで、月額 $10 からご利用いただけます。Claude Code、Cline、Roo Code などの 10 以上の AI コーディングツールで旗艦モデル GLM-4.7 にアクセスでき、開発者に最高水準の高速・安定したコーディング体験を提供します。

> GLM CODING PLAN 10% OFF：https://z.ai/subscribe?ic=8JVLJQFSKB

> Claude Code のリクエストを異なるモデルにルーティングし、あらゆるリクエストをカスタマイズする強力なツール。

![](blog/images/claude-code.png)

## ✨ 機能

- **モデルルーティング**: 用途に応じてリクエストを異なるモデルにルーティング（バックグラウンドタスク、思考、長コンテキストなど）。
- **マルチプロバイダー対応**: OpenRouter、DeepSeek、Ollama、Gemini、Volcengine、SiliconFlow など多様なモデルプロバイダーをサポート。
- **リクエスト/レスポンス変換**: トランスフォーマーを使って各プロバイダー向けにリクエスト・レスポンスをカスタマイズ。
- **動的モデル切り替え**: Claude Code 内で `/model` コマンドを使ってモデルをその場で切り替え。
- **CLI モデル管理**: `ccr model` コマンドでターミナルからモデルとプロバイダーを管理。
- **GitHub Actions 連携**: GitHub ワークフローから Claude Code タスクをトリガー。
- **プラグインシステム**: カスタムトランスフォーマーで機能を拡張。
- **Claude Code サブスクリプション直結**: `claude-code-credentials` トランスフォーマーにより、ローカルの Claude Code OAuth トークンをそのまま利用。別途 API キー不要。
- **OpenAI Responses API 対応**: `openai-responses` トランスフォーマーで Codex や o シリーズモデルにルーティング。

## 🚀 クイックスタート

### 1. Docker で起動（推奨）

推奨される実行方法は Docker Compose です。[Docker](https://docs.docker.com/get-docker/) と [Docker Compose](https://docs.docker.com/compose/install/) を事前にインストールしてください。

**ステップ 1 — リポジトリをクローン：**

```shell
git clone https://github.com/musistudio/claude-code-router.git
cd claude-code-router
```

**ステップ 2 — 設定ファイルを作成：**

```shell
mkdir -p ~/.claude-code-router
cat > ~/.claude-code-router/config.json << 'EOF'
{
  "APIKEY": "your-secret-key",
  "Providers": [
    {
      "name": "openai",
      "api_base_url": "https://api.openai.com/v1/chat/completions",
      "api_key": "$OPENAI_API_KEY",
      "models": ["gpt-4o", "gpt-4o-mini"],
      "transformer": { "use": ["OpenAI"] }
    }
  ],
  "Router": {
    "default": "openai,gpt-4o-mini"
  }
}
EOF
```

**ステップ 3 — （任意）API キーを `.env` ファイルに記述：**

```shell
cat > .env << 'EOF'
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
EOF
```

**ステップ 4 — サービスを起動：**

```shell
docker compose up -d
```

ルーターが `http://127.0.0.1:3456` で起動します。

**ステップ 5 — Claude Code からルーターに接続：**

```shell
ANTHROPIC_BASE_URL=http://127.0.0.1:3456 ANTHROPIC_AUTH_TOKEN=your-secret-key claude
```

シェルの設定ファイルに永続的に追記する場合：

```shell
export ANTHROPIC_BASE_URL=http://127.0.0.1:3456
export ANTHROPIC_AUTH_TOKEN=your-secret-key
```

> **注意**: `config.json` を変更した場合、設定を反映するにはコンテナを再起動してください：
>
> ```shell
> docker compose restart
> ```

**ログを確認：**

```shell
docker compose logs -f
```

---

### 代替手段：グローバル CLI インストール

Docker を使わない場合は、グローバル CLI ツールとしてインストールできます。

まず [Claude Code](https://docs.anthropic.com/en/docs/claude-code/quickstart) をインストール：

```shell
npm install -g @anthropic-ai/claude-code
```

次に Claude Code Router をインストール：

```shell
# Bun 経由（推奨 — プロジェクトは内部的に Bun で動作）
bun install -g @musistudio/claude-code-router

# npm 経由
npm install -g @musistudio/claude-code-router
```

ルーター経由で Claude Code を起動：

```shell
ccr code
```

> **注意**: 設定ファイルを変更した場合、サービスを再起動して変更を反映してください：
>
> ```shell
> ccr restart
> ```

---

### 2. 設定

`~/.claude-code-router/config.json` を作成・編集します。詳細は `config.example.json` を参照してください。

`config.json` の主なセクション：

- **`PROXY_URL`** (任意): API リクエストのプロキシ設定。例：`"PROXY_URL": "http://127.0.0.1:7890"`
- **`LOG`** (任意): `true` でログを有効化、`false` でログファイルを作成しない。デフォルトは `true`。
- **`LOG_LEVEL`** (任意): ログレベル。`"fatal"` / `"error"` / `"warn"` / `"info"` / `"debug"` / `"trace"`。デフォルトは `"debug"`。
- **ログシステム**: 2 種類の独立したログシステム：
  - **サーバーレベルログ**: HTTP リクエスト・API コール・サーバーイベントを pino で `~/.claude-code-router/logs/ccr-*.log` に記録
  - **アプリレベルログ**: ルーティング決定・ビジネスロジックを `~/.claude-code-router/claude-code-router.log` に記録
- **`APIKEY`** (任意): リクエスト認証用のシークレットキー。クライアントは `Authorization: Bearer your-secret-key` または `x-api-key` ヘッダーで提供する必要があります。
- **`HOST`** (任意): サーバーのリスニングアドレス。`APIKEY` が未設定の場合、セキュリティのため強制的に `127.0.0.1` になります。
- **`NON_INTERACTIVE_MODE`** (任意): `true` で非インタラクティブ環境（GitHub Actions・Docker・CI/CD）との互換性を有効化。stdin 待機によるプロセスハングを防止。
- **`Providers`**: モデルプロバイダーの設定。
- **`Router`**: ルーティングルール。`default` は他のルートにマッチしない場合に使用するモデル。
- **`API_TIMEOUT_MS`**: API コールのタイムアウト（ミリ秒）。

#### 環境変数の展開

`config.json` 内で `$VAR_NAME` または `${VAR_NAME}` 構文を使って環境変数を参照できます。API キーをファイルにハードコードせずに管理できます：

```json
{
  "Providers": [
    {
      "name": "openai",
      "api_base_url": "https://api.openai.com/v1/chat/completions",
      "api_key": "$OPENAI_API_KEY",
      "models": ["gpt-4o"]
    }
  ]
}
```

Docker Compose を使う場合は、プロジェクトルートの `.env` ファイルにキーを記述するだけでコンテナに自動注入されます：

```shell
# .env
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...
ANTHROPIC_API_KEY=sk-ant-...
```

展開はネストされたオブジェクト・配列にも再帰的に適用されます。

設定の総合例：

```json
{
  "APIKEY": "your-secret-key",
  "PROXY_URL": "http://127.0.0.1:7890",
  "LOG": true,
  "API_TIMEOUT_MS": 600000,
  "NON_INTERACTIVE_MODE": false,
  "Providers": [
    {
      "name": "openrouter",
      "api_base_url": "https://openrouter.ai/api/v1/chat/completions",
      "api_key": "sk-xxx",
      "models": [
        "google/gemini-2.5-pro-preview",
        "anthropic/claude-sonnet-4",
        "anthropic/claude-3.5-sonnet",
        "anthropic/claude-3.7-sonnet:thinking"
      ],
      "transformer": {
        "use": ["openrouter"]
      }
    },
    {
      "name": "deepseek",
      "api_base_url": "https://api.deepseek.com/chat/completions",
      "api_key": "sk-xxx",
      "models": ["deepseek-chat", "deepseek-reasoner"],
      "transformer": {
        "use": ["deepseek"],
        "deepseek-chat": {
          "use": ["tooluse"]
        }
      }
    },
    {
      "name": "ollama",
      "api_base_url": "http://localhost:11434/v1/chat/completions",
      "api_key": "ollama",
      "models": ["qwen2.5-coder:latest"]
    },
    {
      "name": "gemini",
      "api_base_url": "https://generativelanguage.googleapis.com/v1beta/models/",
      "api_key": "$GEMINI_API_KEY",
      "models": ["gemini-2.5-flash", "gemini-2.5-pro"],
      "transformer": {
        "use": ["gemini"]
      }
    },
    {
      "name": "openai",
      "api_base_url": "https://api.openai.com/v1/chat/completions",
      "api_key": "$OPENAI_API_KEY",
      "models": ["gpt-4o", "gpt-4o-mini", "o4-mini", "o3"],
      "transformer": {
        "use": ["OpenAI"]
      }
    },
    {
      "name": "codex",
      "api_base_url": "https://api.openai.com/v1/responses",
      "api_key": "$OPENAI_API_KEY",
      "models": ["gpt-5.1-codex-mini", "gpt-5-codex"],
      "transformer": {
        "use": ["openai-responses"]
      }
    },
    {
      "name": "claude-code",
      "api_base_url": "https://api.anthropic.com/v1/messages",
      "api_key": "placeholder",
      "models": ["claude-opus-4-5", "claude-sonnet-4-5"],
      "transformer": {
        "use": ["claude-code-credentials"]
      }
    },
    {
      "name": "volcengine",
      "api_base_url": "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
      "api_key": "sk-xxx",
      "models": ["deepseek-v3-250324", "deepseek-r1-250528"],
      "transformer": {
        "use": ["deepseek"]
      }
    },
    {
      "name": "modelscope",
      "api_base_url": "https://api-inference.modelscope.cn/v1/chat/completions",
      "api_key": "",
      "models": ["Qwen/Qwen3-Coder-480B-A35B-Instruct", "Qwen/Qwen3-235B-A22B-Thinking-2507"],
      "transformer": {
        "use": [
          ["maxtoken", { "max_tokens": 65536 }],
          "enhancetool"
        ],
        "Qwen/Qwen3-235B-A22B-Thinking-2507": {
          "use": ["reasoning"]
        }
      }
    },
    {
      "name": "dashscope",
      "api_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      "api_key": "",
      "models": ["qwen3-coder-plus"],
      "transformer": {
        "use": [
          ["maxtoken", { "max_tokens": 65536 }],
          "enhancetool"
        ]
      }
    },
    {
      "name": "aihubmix",
      "api_base_url": "https://aihubmix.com/v1/chat/completions",
      "api_key": "sk-",
      "models": ["Z/glm-4.5", "claude-opus-4-20250514", "gemini-2.5-pro"]
    }
  ],
  "Router": {
    "default": "deepseek,deepseek-chat",
    "background": "ollama,qwen2.5-coder:latest",
    "think": "deepseek,deepseek-reasoner",
    "longContext": "openrouter,google/gemini-2.5-pro-preview",
    "longContextThreshold": 60000,
    "webSearch": "gemini,gemini-2.5-flash"
  }
}
```

### 3. ルーター経由で Claude Code を起動（CLI モード）

```shell
ccr code
```

> **注意**: 設定ファイルを変更した後は、サービスを再起動して変更を反映してください：
>
> ```shell
> ccr restart
> ```

### 4. UI モード

Web UI で設定を管理できます：

```shell
ccr ui
```

ブラウザが開き、`config.json` を視覚的に編集できます。

![UI](/blog/images/ui.png)

### 5. CLI モデル管理

```shell
ccr model
```
![](blog/images/models.gif)

このコマンドで以下の操作をインタラクティブに行えます：

- 現在の設定を確認
- 設定済みモデルの一覧表示（default・background・think・longContext・webSearch・image）
- モデルの切り替え
- モデルの追加
- 新しいプロバイダーの作成（API エンドポイント・API キー・モデル一覧・トランスフォーマー設定）

### 6. プリセット管理

設定をプリセットとして保存・共有・再利用できます。

```shell
# 現在の設定をプリセットとしてエクスポート
ccr preset export my-preset

# メタデータ付きでエクスポート
ccr preset export my-preset --description "My OpenAI config" --author "Your Name" --tags "openai,production"

# ローカルディレクトリからプリセットをインストール
ccr preset install /path/to/preset

# インストール済みプリセットの一覧
ccr preset list

# プリセット情報を表示
ccr preset info my-preset

# プリセットを削除
ccr preset delete my-preset
```

**プリセットの特徴：**
- **エクスポート**: 現在の設定をプリセットディレクトリ（manifest.json）として保存
- **インストール**: ローカルディレクトリからプリセットをインストール
- **機密データの処理**: エクスポート時に API キー等の機密データを自動サニタイズ（`{{field}}` プレースホルダーに置換）
- **動的設定**: インストール時に必要情報を収集するための入力スキーマをプリセットに含められる
- **バージョン管理**: 各プリセットにバージョンメタデータを含む

### 7. activate コマンド（環境変数の設定）

`activate` コマンドでシェルにグローバルな環境変数を設定し、`claude` コマンドを直接使用したり Agent SDK アプリと連携できます。

```shell
eval "$(ccr activate)"
```

設定される環境変数：

- `ANTHROPIC_AUTH_TOKEN`: 設定ファイルの API キー
- `ANTHROPIC_BASE_URL`: ローカルルーターのエンドポイント（デフォルト: `http://127.0.0.1:3456`）
- `NO_PROXY`: `127.0.0.1`（プロキシ干渉を防止）
- `DISABLE_TELEMETRY`: テレメトリを無効化
- `DISABLE_COST_WARNINGS`: コスト警告を無効化
- `API_TIMEOUT_MS`: 設定ファイルの API タイムアウト

> **注意**: 永続的に設定するには `eval "$(ccr activate)"` をシェル設定ファイル（`~/.zshrc` や `~/.bashrc`）に追記してください。

#### Providers

`Providers` 配列で各モデルプロバイダーを定義します。各エントリに必要なフィールド：

- `name`: プロバイダーの一意な名前
- `api_base_url`: チャット補完の API エンドポイント
- `api_key`: プロバイダーの API キー
- `models`: このプロバイダーで利用可能なモデル名のリスト
- `transformer` (任意): リクエスト・レスポンスを処理するトランスフォーマーの指定

#### Transformers

トランスフォーマーはリクエスト・レスポンスのペイロードを変換し、各プロバイダー API との互換性を確保します。

- **グローバルトランスフォーマー**: プロバイダーの全モデルにトランスフォーマーを適用：
  ```json
  {
    "name": "openrouter",
    "api_base_url": "https://openrouter.ai/api/v1/chat/completions",
    "api_key": "sk-xxx",
    "models": ["google/gemini-2.5-pro-preview", "anthropic/claude-sonnet-4"],
    "transformer": { "use": ["openrouter"] }
  }
  ```

- **モデル固有のトランスフォーマー**: 特定モデルにのみトランスフォーマーを適用：
  ```json
  {
    "name": "deepseek",
    "api_base_url": "https://api.deepseek.com/chat/completions",
    "api_key": "sk-xxx",
    "models": ["deepseek-chat", "deepseek-reasoner"],
    "transformer": {
      "use": ["deepseek"],
      "deepseek-chat": { "use": ["tooluse"] }
    }
  }
  ```

- **オプション付きトランスフォーマー**: `maxtoken` など一部のトランスフォーマーはオプションを受け付けます：
  ```json
  {
    "transformer": {
      "use": [["maxtoken", { "max_tokens": 16384 }]]
    }
  }
  ```

**組み込みトランスフォーマー一覧：**

- `Anthropic`: Anthropic 形式のリクエスト・レスポンスをそのまま透過（Anthropic エンドポイントへの直接接続に使用）。
- `claude-code-credentials`: ローカルの Claude Code OAuth トークン（`~/.claude/.credentials.json`）を API キーとして使用。自動トークンリフレッシュ対応。Claude Code サブスクリプションが必要。Docker 使用時は `compose.yaml` で `~/.claude` がコンテナにマウント済み。
- `openai-responses`: OpenAI Responses API（`/v1/responses`）向けのリクエスト/レスポンス変換。Codex モデル（`gpt-5.1-codex-mini`、`gpt-5-codex`）などに使用。
- `OpenAI`: 標準 OpenAI Chat Completions API 向けのリクエスト/レスポンス変換。
- `deepseek`: DeepSeek API 向けのリクエスト/レスポンス変換。
- `gemini`: Gemini API 向けのリクエスト/レスポンス変換。
- `openrouter`: OpenRouter API 向けのリクエスト/レスポンス変換。`provider` ルーティングパラメータで使用する下位プロバイダーを指定可能。詳細は [OpenRouter ドキュメント](https://openrouter.ai/docs/features/provider-routing) 参照：
  ```json
  "transformer": {
    "use": ["openrouter"],
    "moonshotai/kimi-k2": {
      "use": [["openrouter", { "provider": { "only": ["moonshotai/fp8"] } }]]
    }
  }
  ```
- `groq`: Groq API 向けのリクエスト/レスポンス変換。
- `maxtoken`: 特定の `max_tokens` 値を設定。
- `tooluse`: `tool_choice` パラメータで特定モデルのツール使用を最適化。
- `gemini-cli` (実験的): Gemini CLI 経由の非公式 Gemini サポート [gemini-cli.js](https://gist.github.com/musistudio/1c13a65f35916a7ab690649d3df8d1cd)。
- `reasoning`: `reasoning_content` フィールドの処理。
- `sampling`: `temperature`・`top_p`・`top_k`・`repetition_penalty` などサンプリングフィールドの処理。
- `enhancetool`: LLM が返すツールコールパラメータにエラー耐性を追加（ツールコールのストリーミングは無効になる）。
- `cleancache`: リクエストから `cache_control` フィールドを除去。
- `vertex-gemini`: Vertex 認証を使った Gemini API の処理。
- `qwen-cli` (実験的): Qwen CLI 経由の非公式 qwen3-coder-plus サポート [qwen-cli.js](https://gist.github.com/musistudio/f5a67841ced39912fd99e42200d5ca8b)。
- `rovo-cli` (実験的): Atlassian Rovo Dev CLI 経由の非公式 gpt-5 サポート [rovo-cli.js](https://gist.github.com/SaseQ/c2a20a38b11276537ec5332d1f7a5e53)。

**カスタムトランスフォーマー：**

独自のトランスフォーマーを作成し、`config.json` の `transformers` フィールドで読み込めます：

```json
{
  "transformers": [
    {
      "path": "/User/xxx/.claude-code-router/plugins/gemini-cli.js",
      "options": {
        "project": "xxx"
      }
    }
  ]
}
```

#### Router

`Router` オブジェクトで各シナリオに使用するモデルを定義します：

- `default`: 通常タスクのデフォルトモデル。
- `background`: バックグラウンドタスク用モデル（コスト削減のため小型・ローカルモデルを推奨）。
- `think`: 推論集約タスク（プランモードなど）用モデル。
- `longContext`: 長コンテキスト（例：60K トークン超）処理用モデル。
- `longContextThreshold` (任意): 長コンテキストモデルを起動するトークン数のしきい値。未指定の場合は 60000。
- `webSearch`: ウェブ検索タスク用モデル（モデル自体が対応している必要あり。OpenRouter 使用時はモデル名に `:online` サフィックスを追加）。
- `image` (ベータ): 画像関連タスク用モデル（CCR 組み込みエージェントで対応）。ツールコール非対応のモデルの場合は `config.forceUseImageAgent: true` を設定。

Claude Code 内で `/model` コマンドを使ってモデルを動的に切り替え：
`/model provider_name,model_name`
例：`/model openrouter,anthropic/claude-3.5-sonnet`

#### カスタムルーター

より高度なルーティングロジックが必要な場合、`config.json` の `CUSTOM_ROUTER_PATH` でカスタムルータースクリプトを指定できます：

```json
{
  "CUSTOM_ROUTER_PATH": "/User/xxx/.claude-code-router/custom-router.js"
}
```

カスタムルーターファイルは `async` 関数をエクスポートする JavaScript モジュールです。リクエストオブジェクトと設定オブジェクトを受け取り、`"provider_name,model_name"` 形式の文字列（またはデフォルトルーターへのフォールバックとして `null`）を返します：

```javascript
module.exports = async function router(req, config) {
  const userMessage = req.body.messages.find((m) => m.role === "user")?.content;

  if (userMessage && userMessage.includes("このコードを説明して")) {
    return "openrouter,anthropic/claude-3.5-sonnet";
  }

  return null;
};
```

##### サブエージェントルーティング

サブエージェント内のルーティングには、プロンプトの**先頭**に `<CCR-SUBAGENT-MODEL>provider,model</CCR-SUBAGENT-MODEL>` を記述してモデルを指定します：

```
<CCR-SUBAGENT-MODEL>openrouter,anthropic/claude-3.5-sonnet</CCR-SUBAGENT-MODEL>
このコードスニペットを分析して潜在的な最適化点を見つけてください...
```

## ステータスライン（ベータ）

claude-code-router のリアルタイムステータスを表示するためのステータスラインツールを v1.0.40 から内蔵しています。UI から有効化できます。
![statusline-config.png](/blog/images/statusline-config.png)

表示例：
![statusline](/blog/images/statusline.png)

## 🤖 GitHub Actions

[Claude Code Actions](https://docs.anthropic.com/en/docs/claude-code/github-actions) を設定後、`.github/workflows/claude.yaml` を以下のように変更してルーターを使用します：

```yaml
name: Claude Code

on:
  issue_comment:
    types: [created]
  # ... other triggers

jobs:
  claude:
    if: |
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@claude')) ||
      # ... other conditions
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
      issues: read
      id-token: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Prepare Environment
        run: |
          curl -fsSL https://bun.sh/install | bash
          mkdir -p $HOME/.claude-code-router
          cat << 'EOF' > $HOME/.claude-code-router/config.json
          {
            "NON_INTERACTIVE_MODE": true,
            "Providers": [
              {
                "name": "openai",
                "api_base_url": "https://api.openai.com/v1/chat/completions",
                "api_key": "${{ secrets.OPENAI_API_KEY }}",
                "models": ["gpt-4o"],
                "transformer": { "use": ["OpenAI"] }
              }
            ],
            "Router": { "default": "openai,gpt-4o" }
          }
          EOF
        shell: bash

      - name: Start Claude Code Router
        run: |
          nohup ~/.bun/bin/bunx @musistudio/claude-code-router@latest start &
        shell: bash

      - name: Run Claude Code
        id: claude
        uses: anthropics/claude-code-action@beta
        env:
          ANTHROPIC_BASE_URL: http://localhost:3456
        with:
          anthropic_api_key: "any-string-is-ok"
```

> **注意**: GitHub Actions などの自動化環境で実行する場合、`"NON_INTERACTIVE_MODE": true` を設定してプロセスのハングを防いでください。

## 📝 詳細情報

- [プロジェクトの動機と仕組み](blog/en/project-motivation-and-how-it-works.md)
- [ルーターでできることを考える](blog/en/maybe-we-can-do-more-with-the-route.md)

## ❤️ サポートとスポンサー

このプロジェクトが役立つと感じたら、開発のスポンサーをご検討ください。

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/F1F31GN2GM)

[Paypal](https://paypal.me/musistudio1999)

<table>
  <tr>
    <td><img src="/blog/images/alipay.jpg" width="200" alt="Alipay" /></td>
    <td><img src="/blog/images/wechat.jpg" width="200" alt="WeChat Pay" /></td>
  </tr>
</table>
