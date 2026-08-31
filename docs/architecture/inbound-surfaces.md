# Inbound Surface（受け口）

## 目的

Rialto は「複数のワイヤ形式を受け、複数のベンダへ振り分けるルーティング・ゲートウェイ」である。
その **受け口 = inbound surface** の知識を1箇所に集約し、面を増やす作業を「記述子を1つ足す」に落とす。

実装:

- `src/llms/inbound/surfaces.ts` — 記述子レジストリ（唯一の定義元）
- `src/services/inbound-surface-service.ts` — DB上書きを重ねた解決＋キャッシュ
- `src/api/inbound-surfaces/route.ts` — `GET`/`POST /api/inbound-surfaces`

## なぜ作ったか

面ごとの知識が **4箇所に散っていた**。

| 散っていた場所 | 何を知っていたか |
|---|---|
| `api/v1/error-shape.ts` の `errorShapeForPath` | エラー封筒の形 |
| `api/v1/route.ts` の `pickSseAggregator` | 非ストリーム集約の関数（transformer名で分岐） |
| `index.ts` の `openaiBearerAuth` パス列挙 | 認証ヘッダの種類 |
| `api/v1/invocation.ts` の `inboundTypeFromPath` | 永続化するワイヤ種別 |

面を1つ足すたびに4箇所を直す必要があり、どれか1つを忘れても**静かに壊れる**（たとえばエラーだけ
別形式で返る）。記述子に寄せることで、忘れようがなくなる。

現時点で記述子に寄せ終わっているのは `errorShapeForPath` と `inboundTypeFromPath` の2つ。
`pickSseAggregator` と認証ミドルウェアの選択は未移管で、記述子に `auth` / `errorShape` の
フィールドだけ先に持たせてある。

## 4つの面

| id | path | 想定クライアント | inboundType | 既定 routingMode |
|---|---|---|---|---|
| `anthropic-messages` | `/v1/messages` | Claude Code | `anthropic` | `routed` |
| `openai-chat` | `/v1/chat/completions` | OpenAI SDK | `openai` | `passthrough` |
| `openai-responses` | `/v1/responses` | Codex CLI | `openai` | `passthrough` |
| `gemini-generate` | `/v1beta/models/*` | Gemini CLI | `gemini` | `passthrough` |

`GET /v1/models` はカタログ読み出しであって完了リクエストの面ではないので、レジストリには**入れない**。
ただし呼び手が OpenAI SDK なのでエラー封筒だけは openai 形式を返す（`error-shape.ts` の
`EXTRA_OPENAI_PATHS`）。

> **未接続**: `gemini-generate` は記述子としては存在するが、`/v1beta/models/*` はまだマウントされて
> いない。よって Overview のこの行は常に0件になる。有効化は Phase 3。

## routingMode — 「messages専用に見える」問題の正体

`routed` は シナリオ分類 → ルール → 選好チェーン → quota-aware選択 → failover の全段を通す。
`passthrough` は呼び出し側が `provider,model` を自分で指定する前提で、**全段をスキップ**する。

この分岐自体は妥当だった（OpenAI互換クライアントは自分でモデルを選ぶ）。問題は
`scenario-router.ts` に**ハードコードされていて、UIから見えず、切り替えられない**ことだった。

```ts
// 旧: 固定・不可視
if (req.inboundPath === '/v1/chat/completions' || req.inboundPath === '/v1/responses') { ... }

// 新: 設定
if (!(await isRoutedPath(req.inboundPath))) { ... }
```

結果として `RouterPreferences` / `RoutingLibrary` / `TierEditor` などの画面が事実上
「`/v1/messages` 専用の設定画面」になっていた。これが **「UI上の機能が全部messagesだけの設定に
なっている」の正体**である。

**出荷時の既定値は旧挙動と完全に一致する**（messages=routed、他=passthrough）。
`InboundSurfaceConfig` に行が無い面は記述子の `defaultRoutingMode` を使うので、
誰かが変えるまで挙動は1バイトも変わらない。

## profileKey — 面ごとの選好チェーン

`RouterPreferenceProfile.key` は元々「将来の preference presets 用」としてスキーマコメント付きで
置かれ、`key='live'` のシングルトンのまま眠っていた。面ごとルーティングがその用途である。

```
InboundSurfaceConfig.profileKey → RouterPreferenceProfile.key → entries
```

リクエスト時に `scenario-router.ts` が inbound path から面を解決し、その `profileKey` を
quota-aware セレクタへ渡す。これにより **CIのクライアントが叩く面だけ cost-first に固定する**
といった運用ができる。上書きの無い面は既定プロファイルに解決されるので、これも既定では旧挙動。

## RequestLog.surface

`inboundType` は `anthropic` / `openai` の2値で、**`/v1/chat/completions` と `/v1/responses` を
区別できない**。Overview と Activity は面ごとの内訳を出すので、`RequestLog.surface` に
`InboundSurface.id` のスラグを記録する。

移行時のバックフィル（`20260831043000_backfill_request_log_surface`）:

- `inboundType = 'anthropic'` → `/v1/messages` 以外にありえないので `anthropic-messages` を復元
- `inboundType = 'openai'` → 2面のどちらか判別不能。**NULL のまま残す**

推測で埋めない。UI は NULL を「untracked」として表示し、存在しないトラフィックを特定の面に
帰属させない。

## 面を1つ足す手順

1. `INBOUND_SURFACES` に記述子を1つ足す
2. `src/index.ts` にパスをマウントする
3. `errorShape` が新形式なら `buildErrorEnvelope` に封筒を足す
4. 非ストリーム集約が必要なら aggregator を足す（`pickSseAggregator` は transformer 名で
   分岐しており、まだ記述子には寄せていない。面と transformer は現状1:1なので実害は無いが、
   集約先を記述子に移すのが本来の形）

DBマイグレーションは不要（`InboundSurfaceConfig` は行が無ければ記述子の既定値を使う）。

## 関連

- `docs/architecture/request-flow.md` — この後段の chain / failover
- `docs/plan/rialto/master-plan.md` §4.1, §4.2 — 設計の経緯

## 実装状況（Phase 5 時点）

| 画面 | ルート | モック差分 (light / dark) |
|---|---|---|
| Overview | `/overview` | 1.76% / 1.85% |
| Routing — Chain | `/routing` | 3.51% / 3.82% |
| Routing — Chain (passthrough) | `/routing?surface=openai-responses` | 2.45% / 3.55% |
| Routing — Map | `/routing/map` | 1.68% / 1.68% |
| Routing — Rules | `/routing/rules` | 2.97% / 4.87% |
| Providers — subscription | `/providers/:name` | 3.89% / 7.75% |
| Providers — api_key | `/providers/:name` | 3.83% / 7.15% |
| Providers — connect | `/providers/connect` | 7.22% / 14.66% ※1 |
| Activity — Sessions | `/activity` | 1.96% / 2.88% |
| Activity — Requests | `/activity/requests` | 3.43% / 5.14% |
| Activity — Logs | `/activity/logs` | 3.22% / 7.12% |
| Settings — Server | `/settings` | 1.54% / 1.63% |
| Settings — Access | `/settings/access` | 12.3% / 12.6% ※2 |
| Settings — Logging | `/settings/logging` | 2.28% / 2.29% |
| Settings — Personas | `/settings/personas` | 4.73% / 5.63% |
| Settings — Status line | `/settings/statusline` | 2.24% / 3.03% |
| Settings — Presets | `/settings/presets` | 7.22% / 8.33% |
| Settings — Advanced | `/settings/advanced` | 4.23% / 4.36% |
| First run | `/setup` | 2.85% / 3.01% |
| System states | `/access-denied` ほか | 3.22% / 9.53% |
| Session detail | 未登録 | セッション実データが無く撮影できない |

差分の大半は**モックのダミー値と実データの差**である（このインストールには provider が3件、モックのフィクスチャには7件、など）。

10% を超える2画面は、どちらも**モックと実機が別の状態を描いている**ことによる既知差分で、実装の欠落ではない。
コピーや構造をいじっても下がらないので、追わないこと。

- ※1 `providers-connect`: モックは3ステップの**2番目**（認証中）を描いているが、ルートは当然1ステップ目で開く
- ※2 `settings-access`: モックは **Cloudflare Access 設定済み**のインストール（サインイン済みメール、
  ポリシー行2件）を描いている。未設定のインストールは正しくもう一方の状態を描き、
  モックには存在しない露出警告が加わる
