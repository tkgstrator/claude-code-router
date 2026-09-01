# Phase 3-2 先行スパイク: Gemini サブスク枠（gemini-cli / Code Assist）

**調査日**: 2026-09-01
**対象**: master-plan §Phase 3-2 の「未確定リスク」— Code Assist API にクォータ取得エンドポイントが
存在するか、および ToS 上の扱い
**成果物**: 本ドキュメントのみ（コード変更なし）

---

## 0. 追記 (2026-09-01) — **Phase 3-2 は descope で決着**

本スパイクの後、実アカウントで検証まで進めた結果、**Phase 3-2 は実施しないことに決まった**。
以下は §1 以降の調査結果を否定するものではなく、その上に載る実測と判断である。

**実測でわかったこと**（このリポジトリのオーナーの環境）:

| 確かめたこと | 結果 |
|---|---|
| 個人枠（free / ai-pro / ai-ultra）で OAuth できるか | **不可**。公式 CLI が `Your current account is not eligible for Gemini Code Assist for individuals, the free version` を返す。2026-06-18 の提供停止が実機で確認された |
| Code Assist の契約があるか | **無かった**。Cloud Console が「サブスクリプションを作成するには請求先アカウントが必要」と案内する状態だった |
| `Gemini Cloud Assist` が無料で使えるのでは | **別製品**。GCP コンソール向けのアシスタントで、`cloudcode-pa` の権限は付いてこない。名前が1文字違いで、Google 自身のエラー文でも両者が混ざっている |
| 契約後に使えるか | サブスクは作れたが **ライセンス数 0**。1枚割り当てた時点で **$22.80/月・シート**が発生し、翌月1日に自動更新される |

**判断の理由**:

1. **接続先が存在しなかった。** 実装しても繋ぐ相手が無く、動作確認すらできない状態だった
2. **経済的に逆ざや。** Rialto から Gemini を叩くだけなら AI Studio の api_key（Phase 3-1 実装済み）で足りる。月額シートを払って得られるのは 1,500 req/日と、プロジェクト + API 有効化 + IAM + ライセンス割り当てというセットアップである
3. **体験が別物。** Claude Code / Codex の「OAuth でログインするだけ」に対し、Code Assist は組織アカウント前提で `GOOGLE_CLOUD_PROJECT` が必須（公式ドキュメントに明記）。同じ「サブスク枠」の枠組みに収まらない

**実装で残した状態**: `gemini-cli` の到達不能な UI 残骸（`vendor-labels.ts` の
`VENDOR_ORDER` / `VENDOR_LABEL` / `VENDOR_HINT_KEY` 各1件、`ConnectVendorRail.tsx` の
`VENDOR_ICON` 1件、locale 3言語の `providers.vendorHint.geminiCli`）は**削除した**。
残すと「対応予定」という誤ったシグナルになるため。`SetupScreen.tsx` の接続候補も
`Gemini CLI / AI Pro・Ultra` から `Google AI / AI Studio API key` に直してある。

`__tests__/shared/transformer-chain.test.ts` と `__tests__/llms/provider-registry-chain.test.ts` が
「auth transformer を持たない subscription ベンダは `null` を返して未登録にする」という不変条件を
`gemini-cli` を題材に検証しているが、descope したので**題材はそのままでよい**。

**将来 Google が方針を戻した場合**、§1 以降の調査（`retrieveUserQuota` の実在、OAuth 設計、
`SubAccountQuota` への写像、触るファイル一覧）はそのまま使える。破棄せずに残す理由がそれである。

**未検証のまま残った点**: `retrieveUserQuota` が Standard / Enterprise ティアで bucket を
返すかは**最後まで確認できなかった**（ライセンスを割り当てなかったため）。再開するならここが
最初の関門である。

---

## 1. 結論

### 1-1. クォータ取得は **可能**（master-plan の未確定リスクは解消）

Code Assist API には **`POST https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota`** が
実在し、gemini-cli 本体がプロダクションコードで使用している。レスポンスは per-model の
bucket 配列で、`remainingFraction`（0..1）・`remainingAmount`・`resetTime` を返す。

これは Rialto の `SubAccountQuota` の「pct 規約」（`used = utilization`, `limit = 100`）に
そのまま乗る形であり、**429 反応型のみ**という劣化分岐に落ちる必要はない。

master-plan §3-2 の以下の記述は**否定された**:

> 取得できない場合は `SubAccountQuota` は書かれず、`routing-scheduler` の collector は
> 当該アカウントで no-op、429反応型のfailoverのみで運用

### 1-2. しかし、**そのクォータを持つ相手が既に存在しない**

**2026年6月18日をもって、Gemini CLI / Code Assist IDE 拡張は
「Gemini Code Assist for individuals（無料）」「Google AI Pro」「Google AI Ultra」の
3ティアへのリクエスト提供を停止した。**（本日 2026-09-01 時点で既に2ヶ月半経過）

master-plan §3-2 が想定していた対象は、まさにこの `free` / `ai-pro` / `ai-ultra` である:

> **SubAccount**: `buildGeminiDiscoveredAccount` を追加。plan は `free` / `ai-pro` / `ai-ultra`

つまり **Phase 3-2 は、技術的リスク（クォータ取得）ではなく前提（対象ティアの存在）の側で
崩れている。** クォータは取れるが、取る相手がいない。

### 1-3. 残っている経路と評価

| 経路 | 技術的可否 | ToS | 評価 |
|---|---|---|---|
| **A.** Code Assist **Standard / Enterprise**（GCP 有償シート）を `cloudcode-pa` 経由で | ○ 稼働中 | △ 要確認（GCP 側の規約体系。Antigravity ToS §6 の直接適用外） | 実装可能。ただし「個人サブスク枠」ではなく B2B シート |
| **B.** **Antigravity** の OAuth を流用（`cloudcode-pa` は共用） | ○ 技術的には可 | ✗ **明示的に禁止**（後述 §6） | **採用不可** |
| **C.** `google` api_key（Gemini API / AI Studio キー） | ○ | ○ | Phase 3-1 で**実装済み**。唯一の無リスク経路 |

### 1-4. 推奨

**Phase 3-2 を「Gemini の個人サブスク枠」としては descope（縮退）し、
経路 A（Code Assist Standard / Enterprise）に読み替えるか、Phase 4 以降へ後回しにする。**

理由:

1. 当初の対象ユーザー（AI Pro / Ultra 個人契約者）に**提供できる機能が存在しない**。
   実装しても接続できるアカウントがない。
2. 経路 A は技術的には同じ形（`OauthBase` → `SubAccount` → collector）に載るが、
   **`projectId` がユーザー必須入力になる**（§4 参照）ため UI と設計が変わる。かつ
   対象は「GCP で Code Assist ライセンスを買った組織」であり、Claude Max / ChatGPT Pro と
   並べる「サブスク枠」という Rialto の訴求とは客層が違う。
3. 経路 B は ToS 違反かつ **Google アカウント BAN の実報告がある**（§6）。
   ゲートウェイという製品の性質上、これを製品機能として提供するのは不可。

判断はプロジェクト側に委ねる。実装に進む場合の具体的な計画は §5 に置いた。

---

## 2. 根拠

### 2-1. クォータエンドポイントの存在（**確認済み事実**）

gemini-cli は Apache-2.0 の OSS であり、一次情報が読める。

**`packages/core/src/code_assist/server.ts`** — メソッド定義（原文）:

```typescript
async retrieveUserQuota(
  req: RetrieveUserQuotaRequest,
): Promise<RetrieveUserQuotaResponse> {
  return this.requestPost<RetrieveUserQuotaResponse>(
    'retrieveUserQuota',
    req,
  );
}
```

URL は `getMethodUrl(method)` → `` `${this.getBaseUrl()}:${method}` `` で組まれ、
定数は以下（原文）:

```typescript
const CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com';
const CODE_ASSIST_API_VERSION = 'v1internal';
```

→ 実効 URL は `https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota`。

**`packages/core/src/code_assist/types.ts`** — ワイヤ型（原文）:

```typescript
export interface RetrieveUserQuotaRequest {
  project: string;
  userAgent?: string;
}

export interface RetrieveUserQuotaResponse {
  buckets?: BucketInfo[];
}

export interface BucketInfo {
  remainingAmount?: string;
  remainingFraction?: number;
  resetTime?: string;
  tokenType?: string;
  modelId?: string;
}
```

**`packages/core/src/config/config.ts`** — 実際の消費側（原文、抜粋）。
これが「定義だけ存在する死んだ API ではない」ことの証拠:

```typescript
async refreshUserQuota(): Promise<RetrieveUserQuotaResponse | undefined> {
  const codeAssistServer = getCodeAssistServer(this);
  if (!codeAssistServer || !codeAssistServer.projectId) {
    return undefined;
  }
  try {
    const quota = await codeAssistServer.retrieveUserQuota({
      project: codeAssistServer.projectId,
    });

    if (quota.buckets) {
      this.lastRetrievedQuota = quota;
      this.lastQuotaFetchTime = Date.now();

      for (const bucket of quota.buckets) {
        if (!bucket.modelId || bucket.remainingFraction == null) {
          continue;
        }
        // ...
        if (bucket.remainingAmount) {
          remaining = parseInt(bucket.remainingAmount, 10);
          limit =
            bucket.remainingFraction > 0
              ? Math.round(remaining / bucket.remainingFraction)
              : (this.modelQuotas.get(modelId)?.limit ?? 0);
        } else {
          // Server only sent remainingFraction — use a normalized scale.
          limit = 100;
          remaining = Math.round(bucket.remainingFraction * limit);
        }
        // ...
      }
    }
    // ...
  } catch (e) {
    debugLogger.debug('Failed to retrieve user quota', e);
    return undefined;
  }
}
```

`refreshUserQuotaIfStale(staleMs = 30_000)` から呼ばれる。**ポーリング間隔 30 秒**。

**`packages/core/src/code_assist/server.test.ts`** — 実レスポンス形状のフィクスチャ（原文）:

```javascript
const mockResponse = {
  buckets: [
    {
      modelId: 'gemini-2.5-pro',
      tokenType: 'REQUESTS',
      remainingFraction: 0.75,
      resetTime: '2025-10-22T16:01:15Z',
    },
  ],
};
const req = {
  project: 'projects/my-cloudcode-project',
  userAgent: 'CloudCodePlugin/1.0 (gaghosh)',
};
```

**注意点（確認済み事実）**:
- bucket は **per-model**（`modelId`）であり、**日次**（RPD）クォータである。
  Claude の 5h / 7d、Codex の primary / secondary のような**ローリングウィンドウではない**。
  リセットは太平洋時間の深夜。→ `SubAccountQuota` へのマッピングに設計判断が要る（§5-3）。
- `tokenType` は `'REQUESTS'` の他の値を取りうる。フィルタが必要。
- `project` が必須。つまり **クォータ取得は projectId 解決に依存する**（§4）。

ソース:
- <https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/server.ts>
- <https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/types.ts>
- <https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/config/config.ts>

### 2-2. 個人ティアの提供停止（**確認済み事実**）

Google Developers Blog の公式アナウンス（原文引用）:

> "On June 18, 2026, Gemini CLI and Gemini Code Assist IDE extensions will stop serving
> requests for Google AI Pro and Ultra, as well as those using it free of charge using
> Gemini Code Assist for individuals."

継続するもの（原文）:

> "Gemini CLI will also remain accessible via paid Gemini and Gemini Enterprise Agent
> Platform API keys"

> Organizations with Gemini Code Assist Standard or Enterprise licenses maintain
> unchanged access

リポジトリの扱い（原文）:

> "The project remains available to the community as an Apache 2.0 licensed repository
> with no changes."

Google Cloud ドキュメント側の同趣旨の記述:

> Starting June 18, 2026, Gemini Code Assist IDE Extensions and Gemini CLI stopped serving
> requests for the Gemini Code Assist for individuals, Google AI Pro, and Google AI Ultra
> tiers. However, Gemini Code Assist Standard and Enterprise services remain available.

**傍証（確認済み）**: 公式クォータ表
（`developers.google.com/gemini-code-assist/resources/quotas` → `docs.cloud.google.com/gemini/docs/quotas` に 301）を
本日確認したところ、**個人 / 無料 / AI Pro / AI Ultra のティアが表から消えており、
Standard と Enterprise のみが残っている**（Standard = 1500 req/day、Enterprise = 2000 req/day、
2 req/sec）。停止前は「無料 1,000 req/day・60 req/min、AI Pro 1,500、AI Ultra 2,000」と
掲載されていた。

**gemini-cli 自体は生きている（確認済み）**: 最新リリース **v0.57.0 / 2026-08-25 公開**。
README に廃止バナーは無い。これは矛盾ではなく、CLI が Standard / Enterprise と
有償 API キー向けには引き続き提供されているため。

ソース:
- <https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/>
- <https://github.com/google-gemini/gemini-cli/discussions/27274>
- <https://docs.cloud.google.com/gemini/docs/quotas>
- <https://docs.cloud.google.com/gemini/docs/release-notes>
- <https://github.com/google-gemini/gemini-cli/releases/tag/v0.57.0>
- （報道・二次情報）<https://www.theregister.com/ai-ml/2026/05/20/bye-bye-gemini-cli-google-nudges-devs-toward-antigravity/5243605>

### 2-3. OAuth 資格情報（**一部推測**）

**確認済み** — `packages/core/src/code_assist/oauth2.ts`:

```
client_id:     681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com
client_secret: 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
scopes:        https://www.googleapis.com/auth/cloud-platform
               https://www.googleapis.com/auth/userinfo.email
               https://www.googleapis.com/auth/userinfo.profile
PKCE:          code_challenge_method: S256（使用する）
redirect_uri:  http://127.0.0.1:{動的ポート}/oauth2callback
               （OAUTH_CALLBACK_HOST / OAUTH_CALLBACK_PORT で上書き可）
```

**client_secret が平文で埋まっている点**は Claude / Codex との重要な差分。Google の
「installed application」クライアント型では secret は機密ではない扱いだが、
トークンエンドポイントへの POST に **`client_secret` を同梱する必要がある**（RFC 6749 の
public client ではなく confidential client 扱い）。

**確認済み** — `packages/core/src/config/storage.ts`:

```typescript
export const OAUTH_FILE = 'oauth_creds.json';

static getOAuthCredsPath(): string {
  return path.join(Storage.getGlobalGeminiDir(), OAUTH_FILE);
}
```

→ **`~/.gemini/oauth_creds.json`**。ファイルは `JSON.stringify(credentials, null, 2)`、
パーミッション `0o600`。別ファイル `google_accounts.json` にメールアドレスがキャッシュされる。

**推測（未検証）** — ファイルの中身は google-auth-library の `Credentials` 型をそのまま
直列化したもの、すなわち:

```jsonc
{
  "access_token":  "ya29....",
  "refresh_token": "1//0g...",
  "scope":         "https://www.googleapis.com/auth/cloud-platform ...",
  "token_type":    "Bearer",
  "id_token":      "eyJ...",     // 任意
  "expiry_date":   1750000000000  // epoch **ミリ秒**（Claude の expiresAt と同じ単位）
}
```

**この環境には `~/.gemini/` が存在しなかった**ため実ファイルでの照合はできていない。
`import-credentials` のスキーマを書く際は、実ファイル1つで必ず裏を取ること。
`expiry_date` がミリ秒（秒ではない）である点は google-auth-library の慣習に基づく推測で、
ここを取り違えると `ensureFreshToken` が常に「期限切れ」または「永久に有効」と判断する。

ソース:
- <https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/oauth2.ts>
- <https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/config/storage.ts>

### 2-4. Code Assist エンドポイント一覧（**確認済み事実**）

`CodeAssistServer` の全メソッド。すべて `https://cloudcode-pa.googleapis.com/v1internal:<method>`。

| メソッド | Verb | パス | 備考 |
|---|---|---|---|
| `loadCodeAssist` | POST | `v1internal:loadCodeAssist` | projectId / tier 解決 |
| `onboardUser` | POST | `v1internal:onboardUser` | LRO（`done` まで 5 秒間隔ポーリング） |
| `getOperation` | GET | `v1internal/{name}` | 上の LRO ポーリング先 |
| `generateContent` | POST | `v1internal:generateContent` | 非ストリーム |
| `generateContentStream` | POST | `v1internal:streamGenerateContent?alt=sse` | SSE。`data: ` プレフィクス |
| **`retrieveUserQuota`** | POST | `v1internal:retrieveUserQuota` | **本スパイクの本題** |
| `countTokens` | POST | `v1internal:countTokens` | |
| `fetchAdminControls` | POST | `v1internal:fetchAdminControls` | |
| `listExperiments` | POST | `v1internal:listExperiments` | |
| `refreshAvailableCredits` | POST | `v1internal:loadCodeAssist` | |
| `recordCodeAssistMetrics` | POST | `v1internal:recordCodeAssistMetrics` | テレメトリ。**送る必要はない** |

リトライ設定（原文）: `retry: 3`, `statusCodesToRetry: [[429,429],[499,499],[500,599]]`。

ボディは Gemini ネイティブ形（`contents[] { role, parts }` / `systemInstruction { parts }`）に
`project` と `user_prompt_id` と `session_id` を被せたラッパ
（`toGenerateContentRequest(req, userPromptId, projectId, sessionId, ...)`）。
レスポンスは `candidates[] { content, finishReason }` + `usageMetadata`。

→ **既存の `GeminiTransformer` が生成するボディをそのままラップするだけで足りる**。
これは `transformer-chain.ts` の `CONVERSION_STEP` に `gemini` を置き、その後段に
auth transformer を1つ足す形（Codex とまったく同じ構造）に収まることを意味する。

---

## 3. OAuth フロー設計（claude-code-oauth / codex-oauth との差分）

既存2実装との差分だけを書く。共通部分（`OAuthTransformer` 継承、`resolveSubscriptionAuth`、
`withRefreshLock`、`updateSubAccountAccessToken`）はそのまま流用できる。

| 論点 | claude | codex | **gemini（設計）** |
|---|---|---|---|
| authorize URL | `claude.com/cai/oauth/authorize` | `auth.openai.com/oauth/authorize` | `accounts.google.com/o/oauth2/auth` |
| token URL | `platform.claude.com/v1/oauth/token` | `auth.openai.com/oauth/token` | `oauth2.googleapis.com/token` |
| token body | **JSON**（+ 独自に `state` 必須） | form-urlencoded | **form-urlencoded** |
| `client_secret` | 不要 | 不要 | **必要**（上記の埋め込み値） |
| PKCE | S256 | S256 | S256 |
| redirect_uri | `/callback`（ポート任意）<br>リモート時は `platform.claude.com/oauth/code/callback` | `http://localhost:1455/auth/callback`<br>**ポート固定**（専用リスナー必要） | `http://127.0.0.1:{任意}/oauth2callback`<br>**ポート任意**（→ Rialto 本体のポートを再利用できる） |
| refresh の rotation | する | **する**（単発。`refresh-lock` 必須） | **しない見込み**（Google の refresh_token は通常固定） |
| 期限の権威 | `expires_in` | access_token の `exp` クレーム | `expiry_date`（ファイル）/ `expires_in`（レスポンス） |
| アカウント同定 | `/api/oauth/profile` の `account.uuid` | `id_token` の `chatgpt_account_id` | `userinfo` の `sub` / `email`、または `id_token` |
| 追加の前段呼び出し | なし | なし | **`:loadCodeAssist`（+ `:onboardUser`）で projectId 解決** |

**設計上の朗報**: redirect の**ポートが任意**なので、Codex のような専用リスナー
（`src/services/codex-auth/callback-listener.ts`、:1455 固定）は不要。
Claude と同じく Rialto 本体のポート上の1パスで受けられる。パスは `/oauth2callback`。

**設計上の懸念**: `client_secret` を Rialto のソースに埋め込むことになる。gemini-cli が
Apache-2.0 で公開している値そのものなので新たな秘密の漏洩ではないが、
「OSS クライアントの資格情報を別製品が名乗る」という行為であることは §6 の論点と地続き。

**refresh の実装**: `OAuthTransformer.refresh()` を素直にオーバーライドすれば足りる。
rotation しない前提なら Codex 用に作った `ensureFreshCodexAccessToken`
（`src/services/codex-auth/token.ts`）相当の特別扱いは**不要**で、
基底クラスの `ensureFreshToken` をそのまま使える。ただし rotation の有無は未検証（§7）。

---

## 4. projectId 解決の扱いと、置くレイヤ

### 4-1. 何が起きるか（確認済み）

`packages/core/src/code_assist/setup.ts` の `setupUser`:

1. env から候補を読む — `process.env['GOOGLE_CLOUD_PROJECT'] || process.env['GOOGLE_CLOUD_PROJECT_ID'] || undefined`
2. `loadCodeAssist({ cloudaicompanionProject: projectId, metadata: { duetProject: projectId, ... } })`
3. レスポンスの `cloudaicompanionProject` を採用。無ければ `allowedTiers` から
   `isDefault` のティアを選び（`getOnboardTier`）、`onboardUser` を呼ぶ
4. `onboardUser` は LRO。`done` になるまで **5 秒間隔**で `getOperation` をポーリング
5. projectId が最後まで得られない場合 `ProjectIdRequiredError`:
   > "This account requires setting the GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID env var..."

### 4-2. 個人ティア消滅による重大な設計変更

**無料 / AI Pro / Ultra では `loadCodeAssist` が Google 管理のプロジェクトを
自動で返していた**ため、ユーザーは projectId を意識しなくてよかった。
master-plan §3-2 の「`:loadCodeAssist` / `:onboardUser` で projectId を解決する」という
記述はこの前提に立っている。

**その前提は 6/18 に消えた。** 残る Standard / Enterprise は
`userDefinedCloudaicompanionProject` 側であり、**ユーザーが自分の GCP プロジェクト ID を
供給しなければならない**（= `ProjectIdRequiredError` の経路が既定になる）。

したがって経路 A で実装する場合:

- **Add Subscription ダイアログに「GCP Project ID」入力欄が必要**（Claude / Codex には無い UI）
- 加えて、そのプロジェクトで **Cloud Code Private API (`cloudcode-pa.googleapis.com`) が
  有効化されている必要がある**。未有効だと `SERVICE_DISABLED` / 403 PERMISSION_DENIED になる
  （gemini-cli の issue #25167 / #25226 / #26105 に多数の実例）
- `onboardUser` の LRO ポーリングは最大60秒。OAuth コールバックのリクエスト内で回すと
  ブラウザがタイムアウトしうる

### 4-3. どのレイヤに置くか（設計）

**結論: 「アカウント記録時に解決して `SubAccount` に永続化」する。ホットパスに置かない。**

これは Claude が `buildClaudeDiscoveredAccount` の中で `fetchClaudeProfile()` を呼んで
`userId` / `plan` / `rateLimitTier` を確定させているのと同じ形であり、既存の型に素直に乗る。

| 処理 | レイヤ | 根拠 |
|---|---|---|
| `:loadCodeAssist` / `:onboardUser` 呼び出し | `src/services/code-assist/project.ts`（新規） | 純粋な upstream HTTP。`claude-profile-service.ts` と同じ位置づけ |
| 解決結果の projectId / tier の確定 | `subscription-account-sync/discovery.ts` の `buildGeminiDiscoveredAccount` | Claude の profile fetch と同一の役目 |
| 永続化 | `SubAccount.codeAssistProjectId`（新カラム） | 再解決は高コスト（LRO 最大60秒）。毎リクエストは論外 |
| リクエスト時の読み出し | `provider.transformer.subscriptionAuth` オーバーレイ経由 | 既存の `OauthSubscriptionAuthBlockSchema` に `projectId` を1フィールド追加 |
| クォータ取得時の利用 | collector が `SubAccount.codeAssistProjectId` を直読み | collector は DB 側にいるのでオーバーレイ不要 |

**ホットパスに置いてはならない理由**: `onboardUser` は LRO で最大60秒かかりうる。
transformer の `transformRequestIn` の中で解決すると、初回リクエストが確実にタイムアウトする。
また `retrieveUserQuota` の `project` 必須要件により、**projectId が無いアカウントは
クォータも取れない**ため、「projectId 未解決 = アカウント未完成」として
`recordGeminiOAuthAccount` の段階で失敗させるのが正しい（Claude が `account.uuid` を
取れなかったら `null` を返して記録を諦めているのと同じ判断）。

---

## 5. 実装計画

**前提**: 経路 A（Code Assist Standard / Enterprise）で実装する場合。
経路 C（api_key）は既に完了しているため追加作業なし。

### 5-1. Prisma マイグレーション

**2本必要**。1本にまとめてはいけない。

**#1 — enum 値の追加**

```sql
-- migration: <ts>_add_gemini_code_assist_api_style/migration.sql
ALTER TYPE "ApiStyle" ADD VALUE 'gemini_code_assist';
```

> **罠**: PostgreSQL は `ALTER TYPE ... ADD VALUE` で追加した値を**同一トランザクション内で
> 使用できない**。Prisma はマイグレーションをトランザクションで包むため、
> enum 追加と、その値を使う DDL / DML を同じマイグレーションに入れると失敗する。
> 必ずマイグレーションを分けること。

**#2 — カラム追加**

```sql
-- migration: <ts>_add_subaccount_code_assist_project/migration.sql
ALTER TABLE "SubAccount" ADD COLUMN "codeAssistProjectId" TEXT;

-- §5-3 の設計判断で「日次ウィンドウ列を追加する」を採る場合のみ:
ALTER TABLE "SubAccountQuota" ADD COLUMN "dailyUsed" DOUBLE PRECISION;
ALTER TABLE "SubAccountQuota" ADD COLUMN "dailyLimit" DOUBLE PRECISION;
ALTER TABLE "SubAccountQuota" ADD COLUMN "dailyResetAt" TIMESTAMP(3);
ALTER TABLE "SubAccountQuota" ADD COLUMN "dailyWindowSeconds" INTEGER;
```

**マイグレーション後は `bun run db:migrate:test` も必須**（`rialto_test` は別 DB。
これを忘れると CI の Test ゲートだけが落ちる）。

### 5-2. 触るファイル一覧

#### 新規（8ファイル + テスト）

| パス | 内容 |
|---|---|
| `src/services/gemini-oauth-service.ts` | authorize URL 組み立て + token 交換。`claude-oauth-service.ts` のミラー |
| `src/services/code-assist/project.ts` | `:loadCodeAssist` / `:onboardUser` / `:getOperation`（LRO ポーリング）。projectId + tier を返す |
| `src/services/code-assist/quota.ts` | `:retrieveUserQuota` の呼び出しと bucket 正規化 |
| `src/llms/transformers/gemini/code-assist-oauth.ts` | `GeminiCodeAssistOauthTransformer`。`OAuthTransformer` を継承 |
| `src/schemas/wire/code-assist.ts` | `LoadCodeAssistResponse` / `RetrieveUserQuotaResponse` / `BucketInfo` の Zod |
| `__tests__/llms/transformers/gemini-code-assist-oauth.test.ts` | |
| `__tests__/services/code-assist/quota.test.ts` | bucket → `SubAccountQuota` 写像（純関数） |
| `__tests__/services/code-assist/project.test.ts` | LRO ポーリングと projectId 解決 |

#### 変更（既存ファイル）

**中核（この機能そのもの）— 9ファイル**

| パス | 変更点 |
|---|---|
| `src/prisma/schema.prisma` | `ApiStyle` に `gemini_code_assist`、`SubAccount.codeAssistProjectId`、（採用時）`SubAccountQuota.daily*` |
| `src/shared/transformer-chain.ts` | `ChainApiStyle` に追加、`CONVERSION_STEP['gemini_code_assist'] = 'gemini'`、`SUBSCRIPTION_AUTH_STEP['gemini_code_assist'] = 'gemini-code-assist-oauth'`、`subscriptionStyleFromBaseUrl` に `cloudcode-pa.googleapis.com` |
| `src/shared/data/subscriptions.ts` | `SUBSCRIPTION_PRESETS` に `gemini-cli` を追加（`apiBaseUrl: 'https://cloudcode-pa.googleapis.com/v1internal'`、`credentialsPath: '~/.gemini/oauth_creds.json'`、`cli: 'Gemini'`、`vendor: 'Google'`） |
| `src/services/config/api-style.ts` | `apiStyleForVendor` に `gemini-cli` → `gemini_code_assist` |
| `src/llms/context.ts` | 新 transformer を `registerMany` に追加（6個 → 7個） |
| `src/llms/transformers/gemini/index.ts` | re-export |
| `src/services/subscription-account-sync/discovery.ts` | `buildGeminiDiscoveredAccount`（projectId 解決を含む） |
| `src/services/subscription-account-sync/persist.ts` | `recordGeminiOAuthAccount` |
| `src/services/subscription-account-sync/pricing.ts` | `geminiMonthlyPrice`（Standard / Enterprise のシート単価。§7 の未確定事項） |

**`'claude' | 'codex'` の直和型を広げる — 12ファイル**

この union がコードベース全体にリテラルで散っているのが**最大の実装コスト**。
`grep -rn "'claude' | 'codex'"` で以下が該当する:

| パス | 変更点 |
|---|---|
| `src/llms/transformers/oauth-base.ts` | `resolveSubscriptionAuth` の `kind` 引数 |
| `src/services/session-account-router.ts` | `HARD_LIMIT_METRICS` / `BALANCE_METRIC` / 各ヘルパ（5箇所） |
| `src/services/usage-service/headroom.ts` | `getKindHeadroom` |
| `src/services/usage-service/window-headroom.ts` | 2箇所 |
| `src/services/usage-service/fetch.ts` | gemini スナップショットの取得を追加 |
| `src/api/v1/chain-failover.ts` | `HARD_LIMIT_METRICS` / `earliestResetUntil` |
| `src/llms/scenario-router/failover.ts` | `subscriptionKindOf` |
| `src/services/router-utilization-service.ts` | `kind` 判定（現在 `name.includes('codex')` の二分岐） |
| `src/services/subscription-info-service.ts` | `providerKind`（`'claude' \| 'codex' \| 'other'`） |
| `src/services/routing-scheduler/types.ts` | `AccountQuotaState.kind` |
| `src/lib/api-types.ts` | 2箇所 |
| `src/components/rialto/providers/types.ts` | 1箇所 |

> **設計上の指摘**: この12ファイルの散らばりは、CLAUDE.md が inbound surfaces について
> 言っているのと同じ症状（「知識が1箇所にまとまっていない」）。3つ目のベンダを足す前に、
> **`SubscriptionKind` を1箇所（例: `src/shared/subscription-kind.ts`）に定義して
> メトリクス写像もそこに寄せる**リファクタを先にやると、この先4つ目が来たときに1ファイルで済む。
> 経路 A を実装する / しないに関わらず、この整理自体は単独で価値がある。

**OAuth 経路 — 3ファイル**

| パス | 変更点 |
|---|---|
| `src/api/oauth/route.ts` | `isSupportedProvider` に `'gemini'`、`PROVIDER_CALLBACK_PATH['gemini'] = '/oauth2callback'`、`GET /oauth2callback` ハンドラ、`import-credentials` / `export-credentials` の分岐 |
| `src/schemas/wire/oauth.ts` | `GeminiCredentialsFileSchema`（`~/.gemini/oauth_creds.json`）、`GeminiTokenResponseSchema`、`OauthSubscriptionAuthBlockSchema` に `projectId` |
| `src/schemas/domain/subscription.ts` | `DiscoveredAccountSchema` に `codeAssistProjectId` |

**クォータ collector — 1ファイル**

| パス | 変更点 |
|---|---|
| `src/services/routing-scheduler/collector.ts` | `mapGeminiToQuota`（純関数）と `refreshQuotaSnapshots` の `gemini` 分岐 |

**周辺 — 6ファイル**

| パス | 変更点 |
|---|---|
| `src/services/model-test/probes.ts` | `ApiStyle.gemini_code_assist` 用プローブ |
| `src/services/config/seed.ts` | subscription コンテキストウィンドウの値（新規追加なら不要かも） |
| `src/locales/en.json` / `ja.json` / `zh.json` | Add Subscription の GCP Project ID 欄のラベル・説明、および `providers.vendorHint.geminiCli` の文言修正（現行の "AI Pro / Ultra" は §8-1 のとおり事実誤り） |
| `src/components/rialto/providers/AddProviderScreen.tsx` | GCP Project ID 入力欄（gemini-cli 選択時のみ） |
| `src/components/rialto/system/SetupScreen.tsx` | `CONNECT_OPTIONS` の Gemini 行の `hint`（§8-1 (ii)） |

**既存テストの修正 — 2ファイル（必須）**

| パス | 現状 | 変更後 |
|---|---|---|
| `__tests__/shared/transformer-chain.test.ts:108` | `test('a vendor with no auth transformer is unservable rather than unauthenticated')` が `gemini-cli` + `cloudcode-pa` で `transformerChain(p)` が `null` になることを検証 | **このテストは意味を失う。** 別の未対応ベンダに差し替えるか、`['gemini', 'gemini-code-assist-oauth']` を返す検証に書き換える |
| `__tests__/llms/provider-registry-chain.test.ts:127` | `expect(registry.get('gemini-cli')).toBeUndefined()` | 登録されることの検証に反転 |

**合計: 新規 5（+テスト3）／ 変更 33。Prisma マイグレーション 2本。**

内訳: 中核 9 + `SubscriptionKind` union 12 + OAuth 経路 3 + collector 1 + 周辺 6 + 既存テスト 2。

### 5-3. `SubAccountQuota` へのマッピング設計判断

**問題**: Gemini のクォータは **per-model の日次カウンタ**。
`SubAccountQuota` は `fiveHour` / `weekly` の2スロット + `scopedWindows` JSONB という
Claude / Codex 由来の形をしている。

**採りうる案**:

| 案 | 内容 | 評価 |
|---|---|---|
| **(a)** `fiveHour` スロットに日次値を書き、`fiveHourWindowSeconds = 86400` にする | マイグレーション不要 | ✗ **列名が嘘になる**。`drainTarget()` 等が「5時間ウィンドウ」として扱う前提が壊れる。将来の読み手を必ず誤らせる |
| **(b)** `scopedWindows` JSONB に per-model で書く | マイグレーション不要。データ形は素直 | △ `quota-math.ts` の `accountBudget()` は `fiveHour` / `weekly` しか見ない。`scopedWindows` は `scopedFable` 経由でしか使われないため、**gemini アカウントは常に unknown-budget 扱いになり、クォータを取った意味がなくなる** |
| **(c)** `daily*` 列を4本追加し、`AccountQuotaState.daily` と `accountBudget()` の min に参加させる | 正しい。列名が意味と一致する | ○ マイグレーション1行増 + `quota-math.ts` / `types.ts` / `compute.ts` に手が入る |

**推奨は (c) + (b) の併用**: アカウント全体の予算判断には「有効モデル中で最も逼迫している
bucket」を `daily*` に、モデル別の内訳は `scopedWindows` に per-`modelId` で残す。
`scopedWindows` は既に「upstream が決めるモデル集合」を入れるための JSONB なので用途が一致する。

`used` の算出は Rialto の pct 規約に合わせる:

```
used  = 100 * (1 - remainingFraction)
limit = 100
resetAt = bucket.resetTime
windowSeconds = 86400
```

`remainingAmount` がある場合は絶対数が取れるが、規約を揃えるため pct に統一するのが
既存コード（`PCT_LIMIT = 100`）と整合する。

**ポーリング間隔**: gemini-cli は 30 秒。Rialto の usage-service キャッシュは 5 分 TTL。
`retrieveUserQuota` は既存の Claude / Codex usage 取得とは別の upstream なので、
collector に fetch を1本追加する必要がある（Claude / Codex のように既存フェッチを
再利用できない）。5分 TTL に合わせるのが無難。

---

## 6. ToS / 法務上の注意

**ここが本スパイクで最も重い所見。**

### 6-1. Antigravity（経路 B）は明示的に禁止されている

Google Antigravity Additional Terms of Service, Section 6（原文引用）:

> "Using third party software, tools, or services to access the Service
> (e.g. using OpenClaw with Antigravity OAuth) is a breach of this Agreement.
> Such actions may be grounds for suspension or termination of your account."

**「サードパーティのツールで Service にアクセスすること自体が契約違反」**と、
例まで挙げて名指しされている。Rialto は定義上まさにこれに該当する。

**実際に BAN が執行されている（確認済み・二次情報）**:
- AI Ultra（月 $250）の課金ユーザーを含め、OpenClaw / OpenCode 等の
  サードパーティツール併用でアカウント停止の報告が多数。警告なしのケースあり
- Google は Antigravity バックエンドへの「悪意ある利用の大幅増加」が正規顧客の
  サービス品質を劣化させたと説明している
- OSS 側の当事者も明記している。`NoeFabris/opencode-antigravity-auth` の README（原文）:
  > "Using this plugin (and any proxy for Antigravity) violates Google's Terms of Service.
  > A number of users have reported their Google accounts being **banned** or **shadow-banned**."

  同リポジトリは **2026-08-27 にアーカイブ**（読み取り専用化）されている。

ソース:
- <https://antigravity.google/terms/>
- <https://github.com/NoeFabris/opencode-antigravity-auth>
- <https://www.theregister.com/2026/02/23/google_antigravity_compute_burden/>
- <https://discuss.ai.google.dev/t/google-antigravity-access-disabled-403-tos-violation-requesting-manual-review/172201>

### 6-2. Code Assist Standard / Enterprise（経路 A）はグレー

Antigravity ToS §6 は Antigravity の規約であり、Google Cloud の Gemini Code Assist
Standard / Enterprise には**直接は適用されない**。こちらは Google Cloud Platform ToS +
Service Specific Terms の体系下にある。

**ただし未検証（§7）**。そして Google が 2026年前半に示した執行姿勢
（「バックエンド保護のためサードパーティ経由を切る」）を踏まえると、
同じ判断が cloudcode-pa 全体に及ぶ可能性は現実的に低くない。

**実務上の推奨**:
- 経路 A を実装する場合でも、**UI に明示的な警告を出す**こと
  （「これは Google の公式クライアント以外からのアクセスです。組織の Google Cloud 契約と
  Service Specific Terms を確認してください」）
- **Rialto のデフォルト seed に含めない**。ユーザーが明示的に追加したときだけ有効化する
- gemini-cli の `recordCodeAssistMetrics` は**送らない**。テレメトリを偽装することになる

### 6-3. Claude / Codex との比較

Rialto は既に Claude Code / Codex の OAuth 資格情報を同じやり方で使っている。
「Gemini だけ ToS を理由に止めるのは一貫性がない」という反論はありうる。

しかし**事実として差がある**:
- Anthropic / OpenAI は現時点でサードパーティクライアント経由の利用を
  規約で名指し禁止していない（少なくとも Antigravity ToS §6 のような明文はない）
- Google は**明文で禁止し、かつ実際に BAN を執行している**

この差は無視できない。「他社でやっているから」は経路 B を正当化しない。

---

## 7. 未検証で残った点（正直に列挙）

本スパイクは **実際の OAuth 認証を一切実行していない**（作業ツリー共有・実資格情報保護の
制約による）。以下はすべて**コード読解と公開情報からの推論**であり、実測ではない。

1. **`retrieveUserQuota` が Standard / Enterprise ティアで実際に bucket を返すか。**
   gemini-cli のコードにあることは確認したが、個人ティア向けの機能だった可能性を
   排除できていない。**これが返らなければ §1-1 の結論は覆り、429 反応型に落ちる。**
   → 検証には Code Assist Standard / Enterprise ライセンスの実アカウントが要る。

2. **`~/.gemini/oauth_creds.json` の実際のフィールド名と `expiry_date` の単位。**
   この環境に `~/.gemini/` が存在せず、実ファイルで照合できていない（§2-3）。
   ミリ秒/秒を取り違えるとトークンリフレッシュが恒久的に壊れる。

3. **Google の refresh_token が rotation するか。** しない前提で設計したが未確認。
   rotation する場合は Codex と同様の `refresh-lock` 経路が必須になる。

4. **`bucket.tokenType` の取りうる値の全集合。** `'REQUESTS'` 以外を確認していない。
   フィルタを誤ると別種のカウンタを予算として読んでしまう。

5. **Code Assist Standard / Enterprise の Service Specific Terms における
   サードパーティクライアントの扱い。** 原文にあたれていない（§6-2）。
   **経路 A を採用する前に、法務観点でここを必ず読むこと。**

6. **Standard / Enterprise のシート単価。** 二次情報が $19〜$22.80（Standard）、
   $45〜$75（Enterprise）と割れている。`monthlyPriceUsd` に書く値の根拠が固まっていない。
   そもそもシート課金なので Claude Max のような「1アカウント = 定額」とは意味が違う。

7. **`cloudcode-pa` に対する 403 の頻度。** gemini-cli の issue tracker には
   Standard / Enterprise ユーザーの `403 PERMISSION_DENIED` が多数
   （#25512 / #25954 / #26036 / #26105 / #25167 / #25226）。多くが
   「not planned」で自動クローズされている。公式クライアントですら安定していない可能性がある。

8. **Antigravity CLI 側に代替の合法経路があるか。** Antigravity CLI は Go 製で、
   認証機構の公式仕様が公開されていない。ToS §6 がある以上調査しても採用できないため、
   本スパイクでは踏み込んでいない。

---

## 8. 調査で判明した「実装済みだが計画に反映されていない事実」

### 8-1. UI に `gemini-cli` の受け皿が既に入っている

Phase 5 の UI 実装時に、`gemini-cli` を**先回りで**配線した箇所が5つある。
**そのうち1つはユーザーに実際に表示されており、かつ表示内容が事実として誤っている。**

**(i) 到達不能な死にコード（4箇所）**

| ファイル | 内容 |
|---|---|
| `src/components/rialto/providers/vendor-labels.ts` | `VENDOR_ORDER` に `'gemini-cli'`（claude-code / codex の直後） |
| 同上 | `VENDOR_LABEL['gemini-cli'] = 'Gemini CLI'` |
| 同上 | `VENDOR_HINT_KEY['gemini-cli'] = 'providers.vendorHint.geminiCli'`<br>（本スパイク中に i18n 化された。それ以前は直書きで `'AI Pro / Ultra via Gemini CLI OAuth'`） |
| `src/components/rialto/providers/ConnectVendorRail.tsx:15` | `VENDOR_ICON['gemini-cli'] = 'ri-gemini-line'` |

これらは現在すべて到達不能。`catalog-service.ts` は subscription 系のエントリを
`SUBSCRIPTION_PRESETS` から生成しており（`src/services/catalog-service.ts:130`）、
そこに `gemini-cli` は無いため、`CatalogEntry` として `'gemini-cli'` が出てくることがない。
`bunx knip` はマップのキーを検出しないので dead-code としても報告されない。

**(ii) ユーザーに表示されている（1箇所・要修正）**

`src/components/rialto/system/SetupScreen.tsx:34-38`:

```typescript
// Only claude and codex have an OAuth initiate endpoint. Gemini is listed
// because it is one of the four inbound surfaces, and every card hands off
// to the Providers screen, which owns the connect flow either way.
const CONNECT_OPTIONS: Array<{ label: string; icon: string; hint: string }> = [
  { label: 'Claude Code', icon: 'ri-sparkling-line', hint: 'Pro / Max' },
  { label: 'Codex', icon: 'ri-terminal-line', hint: 'ChatGPT plan' },
  { label: 'Gemini CLI', icon: 'ri-gemini-line', hint: 'AI Pro / Ultra' }
]
```

これは静的配列なので**初回セットアップ画面に実際に描画される**。
つまり Rialto は今、新規ユーザーに対して「Gemini CLI / AI Pro・Ultra を接続できる」と
示唆しているが、**そのティアは 2026-06-18 に提供停止されており接続先が存在しない**。
カードをクリックすると Providers 画面に飛ぶが、そこに `gemini-cli` の行は無い(上記 (i))ため
行き止まりになる。

**推奨**: Phase 3-2 の可否判断に関わらず、この `CONNECT_OPTIONS` の3行目は
削除するか `hint` を改める。descope するなら (i) の4箇所と
（i18n 化後に追加されるであろう）`providers.vendorHint.geminiCli` の locale キーも
まとめて落とすのが正しい。残すと「対応予定」という誤ったシグナルになる。

### 8-2. `transformer-chain.ts` の「未対応 subscription」テストが gemini-cli を使っている

`__tests__/shared/transformer-chain.test.ts:108` と
`__tests__/llms/provider-registry-chain.test.ts:127` は、
「auth transformer を持たない subscription ベンダは `null` を返して未登録にする」という
**設計上の重要な不変条件**を、たまたま `gemini-cli` を題材にして検証している。

Phase 3-2 を実装すると `gemini-cli` は「対応済み」になるため、この2テストは
**題材を差し替える必要がある**（テストの意図自体は生かすべき。`SUBSCRIPTION_AUTH_STEP` が
`null` を返す組が1つも無くなると、この不変条件を守るテストが消えてしまう）。

descope する場合は現状維持でよい。

### 8-3. master-plan の進捗表の記述が古くなる

`docs/plan/rialto/master-plan.md:675`:

> | 3 Gemini | **In Progress** | 3-1(inbound有効化) 完了 … 残: 3-2 サブスク枠（`gemini-cli` / Code Assist）。クォータ取得の可否は未検証 |

本スパイクにより「クォータ取得の可否」は判定済み（§1-1: 取得可能）。
ただし 3-2 の前提が失効しているため、**「未検証」→「検証済み・ただし対象ティア消滅により要 descope 判断」**へ
書き換えるのが正確。§3-2 の本文（`plan は free / ai-pro / ai-ultra`）も同様に事実と食い違っている。

> 本スパイクは指示により `master-plan.md` を変更していない。上記の追記は
> 別途プロジェクト側の判断で反映すること。

---

## 9. 参考リンク一覧

**一次情報（コード）**
- [gemini-cli `code_assist/server.ts`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/server.ts)
- [gemini-cli `code_assist/types.ts`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/types.ts)
- [gemini-cli `code_assist/oauth2.ts`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/oauth2.ts)
- [gemini-cli `code_assist/setup.ts`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/setup.ts)
- [gemini-cli `config/storage.ts`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/config/storage.ts)
- [gemini-cli `config/config.ts`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/config/config.ts)
- [gemini-cli v0.57.0 リリース (2026-08-25)](https://github.com/google-gemini/gemini-cli/releases/tag/v0.57.0)

**一次情報（規約・アナウンス）**
- [Google Developers Blog: Transitioning Gemini CLI to Antigravity CLI](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/)
- [gemini-cli Discussion #27274](https://github.com/google-gemini/gemini-cli/discussions/27274)
- [Google Antigravity Additional Terms of Service](https://antigravity.google/terms/)
- [Gemini for Google Cloud: Quotas and limits](https://docs.cloud.google.com/gemini/docs/quotas)
- [Gemini for Google Cloud: Release notes](https://docs.cloud.google.com/gemini/docs/release-notes)
- [Gemini CLI: Terms of Service and Privacy Notice](https://google-gemini.github.io/gemini-cli/docs/tos-privacy.html)

**二次情報（BAN 執行・報道）**
- [The Register: Bye-bye, Gemini CLI; Google nudges devs toward Antigravity](https://www.theregister.com/ai-ml/2026/05/20/bye-bye-gemini-cli-google-nudges-devs-toward-antigravity/5243605)
- [The Register: Google Antigravity falls to Earth under compute burden](https://www.theregister.com/2026/02/23/google_antigravity_compute_burden/)
- [Google AI Developers Forum: Antigravity Access Disabled (403 ToS Violation)](https://discuss.ai.google.dev/t/google-antigravity-access-disabled-403-tos-violation-requesting-manual-review/172201)
- [NoeFabris/opencode-antigravity-auth（2026-08-27 アーカイブ済み）](https://github.com/NoeFabris/opencode-antigravity-auth)

**403 の実例（Standard / Enterprise 含む）**
- [#25512 opaque 403 for Enterprise users](https://github.com/google-gemini/gemini-cli/issues/25512)
- [#26036 403 PERMISSION_DENIED from cloudcode-pa](https://github.com/google-gemini/gemini-cli/issues/26036)
- [#26105 Cloud Code Private API has not been used in project](https://github.com/google-gemini/gemini-cli/issues/26105)
- [#25167 cloudcode-pa SERVICE_DISABLED](https://github.com/google-gemini/gemini-cli/issues/25167)
