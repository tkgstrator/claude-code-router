# Inbound Parity Matrix（面 × 機能のパリティ）

## 目的

Rialto は 4 つの受け口（[inbound surface](./inbound-surfaces.md)）を 1 本のパイプラインで捌く。
記述子を足せば面は増えるが、**増えた面がどこまで実際に動くか**は記述子の外側 —— 変換層 —— で決まる。
この文書はその実態を面 × 機能の表に落とし、各セルに「対応済み / 部分対応 / 未対応」のラベルと
それを担保するテストのパスを与える。

**空白セルを黙って落とさないことがこの表の存在理由**である。未対応セルには必ず理由と、
どのコードがそう振る舞わせているかを書く。

## 判定基準 —— 変換経路だけを見る

パイプラインには 2 つの経路がある。

- **バイパス経路** —— 面のワイヤ形式とプロバイダのワイヤ形式が一致するとき
  （`/v1/messages` → Anthropic、`/v1beta/models/*` → Google、など）。
  `shouldBypass`（`src/llms/pipeline/request-chain.ts`）が成立し、変換フックは 1 つも走らない。
  ボディは素通しなので、**あらゆる機能が自動的に成立する**。
- **変換経路** —— 面とプロバイダのワイヤ形式が食い違うとき。
  面の endpoint transformer が `transformRequestOut` で内部表現（OpenAI chat.completion 相当）に
  落とし、`transformResponseIn` で面の語彙に戻す。ここで表現できないものは**黙って消える**。

**この表が評価しているのは変換経路である。** バイパス経路を混ぜると全セルが対応済みになり、
表が何も言わなくなる。そして変換経路こそ、面の `routingMode` を `routed` にしたときに
初めて開く道 —— つまりルーティング機能を使うと踏む道 —— でもある。

## マトリクス

凡例: `対応` = 変換経路で機能する / `部分` = 一部の方向・経路でのみ機能する / `未対応` = 機能しない。
括弧内の番号は下の「セル注記」に対応する。

| | messages | chat/completions | responses | gemini |
|---|---|---|---|---|
| ストリーミング (SSE) | 対応 | 対応 | 部分 (1) | 対応 |
| 非ストリーム集約 | 対応 | 対応 | 対応 | 対応 |
| tool use | 対応 | 対応 | 対応 | 対応 (2) |
| system プロンプト | 対応 | 対応 | 対応 | 対応 (3) |
| 画像入力 | 対応 | 対応 | 対応 | 対応 (4) |
| thinking / reasoning | 対応 (5) | 部分 (6) | 部分 (7) | 対応 (8) |
| usage 記録 (RequestLog) | 対応 | 対応 | 対応 | 対応 (9) |
| エラー形式 | 対応 | 対応 | 対応 | 対応 |
| cacheトークン計上 | 対応 | 対応 (10) | 部分 (11) | 対応 (12) |
| failover / 429 | 対応 | 対応 | 対応 | 対応 |

## セル別の担保テスト

| 行 | 担保しているテスト |
|---|---|
| ストリーミング (SSE) | `__tests__/parity/streaming.test.ts` |
| 非ストリーム集約 | `__tests__/parity/non-stream-aggregate.test.ts`、`__tests__/llms/sse-aggregate.test.ts` |
| tool use | `__tests__/parity/tool-use.test.ts`、`__tests__/llms/transformers/anthropic-request.test.ts`、`__tests__/llms/openai-responses-inbound.test.ts`、`__tests__/llms/gemini-inbound-response.test.ts` |
| system プロンプト | `__tests__/parity/system-prompt.test.ts`、`__tests__/llms/openai-transformer-request-out.test.ts` |
| 画像入力 | `__tests__/parity/image-input.test.ts` |
| thinking / reasoning | `__tests__/parity/thinking.test.ts` |
| usage 記録 (RequestLog) | `__tests__/parity/usage-record.test.ts` |
| エラー形式 | `__tests__/parity/error-envelope.test.ts`、`__tests__/api/error-shape.test.ts` |
| cacheトークン計上 | `__tests__/parity/cache-tokens.test.ts` |
| failover / 429 | `__tests__/parity/failover-429.test.ts`、`__tests__/parity/routing-mode.test.ts` |

面そのもの（記述子・パス解決・集約関数の割り当て）は `__tests__/llms/inbound-surfaces.test.ts` と
`__tests__/api/route-plan.test.ts` が担保している。gemini 列の未対応が単一の原因に帰着することは
`__tests__/parity/gemini-request-conversion.test.ts` が固定している。

## セル注記

### (1) responses × ストリーミング —— 逐次性を失う

`OpenAIResponsesTransformer.transformResponseIn`（`src/llms/transformers/openai/endpoint-responses.ts`）は
上流の chat SSE を `aggregateOpenAiChatSseToJson` で**一度 JSON に畳んでから** Responses SSE を
組み直す。イベント列は本物と同じ順序で出るのでワイヤ契約は満たすが、最初の `output_text.delta` が
出るのは上流の完了後 —— つまり TTFT が失われる。Chat → Responses の境界を逐次で通す実装が要る。

### (2) gemini × tool use —— 宣言だけ通り、呼び出しと結果が落ちる

`tools[].functionDeclarations` は unified のツール定義に変換される。落ちるのは、
`contents[]` に載る `functionCall`（アシスタントの呼び出し）と `functionResponse`（ツールの返り値）。
原因は (3)(4) と同じ `contents[]` 変換の破綻。**1 往復目は動いてツール結果を返す 2 往復目で
会話が空になる**ので、宣言だけ見ていると気づけない壊れ方をする。

`toolConfig.functionCallingConfig`（Gemini の呼び出しモード指定）も読まれない。
`GeminiInboundRequestSchema` が宣言しているのは OpenAI 語彙の `tool_choice` で、
Gemini クライアントが実際に送るキーではない。

### (3) gemini × system プロンプト —— `systemInstruction` を読んでいない

`GeminiInboundRequestSchema`（`src/schemas/wire/gemini/content.ts`）に `systemInstruction` の宣言が無く、
`transformRequestOut`（`src/llms/utils/gemini-request.ts`）も読まない。よって gemini 面を
非 Gemini プロバイダへルーティングすると system プロンプトが消える。エラーにならないぶん質が悪い。

### (4) gemini × 画像入力 —— `inlineData` / `file_data` を読んでいない

`GeminiInboundPartSchema` が宣言しているのは `text` だけ。画像パートは変換前に落ちる。

### (2)(3)(4) の共通原因 —— `contents[]` 変換が本文ごと落としている

gemini 列が横並びで欠けているのは、機能ごとの取りこぼしではなく**単一のバグ**である。

`GeminiInboundContentObjectSchema` が `text: z.string().default('')` を宣言しているため、
`inboundContentToMessage`（`src/llms/utils/gemini-request.ts`）の

```ts
if (typeof content.text === 'string') {
  return { role: 'user', content: content.text.length > 0 ? content.text : null }
}
```

が**常に真**になり、その下にある `role === 'user'` / `role === 'model'` の `parts` 分岐に
決して到達しない。結果、Gemini の正規ワイヤ形式

```json
{ "contents": [{ "role": "user", "parts": [{ "text": "hello" }] }] }
```

は `[{ role: 'user', content: null }]` になる —— **本文が消え、`model` ロールは `user` に潰れる**。
`generationConfig.maxOutputTokens` / `temperature` / `thinkingConfig` も同様に、スキーマが
OpenAI 語彙（`max_tokens` / `temperature`）しか宣言していないので読まれない。

バイパス経路（gemini 面 → Google プロバイダ）はこの変換を通らないので影響しない。
**gemini 面を `routed` にした瞬間に壊れる**、という形の未対応である。

### (5) messages × thinking —— 対応済み、ただしブロック順が本家と逆

要求側（`thinking.budget_tokens` → `reasoning.effort`）も応答側（`thinking` ブロック）も通る。
ただし `convertOpenAIResponseToAnthropic`（`src/llms/transformers/anthropic/response-blocking.ts`）は
annotation → text → tool_use → **thinking** の順に積む。Anthropic 本家は思考を先頭に置く。
同じ変換を書いている gemini 側（`gemini-inbound-response.ts` の `buildParts`）は
「思考 → 本文 → ツール」と明示的に並べているので、面の間で順序が割れている。

`thinking.type === 'adaptive'` は unified の `reasoning` を立てない（予算に訳せないため）。
シナリオ分類の think レーンには効くので、これは意図された非対称。

### (6) chat/completions × thinking —— 集約経路でだけ落ちる

非ストリームの素通し経路では `message.thinking` がそのまま届く。落ちるのは
`stream: false` のクライアントを SSE 上流が服務する経路（codex-oauth）で、
`aggregateOpenAiChatSseToJson` が `delta.thinking` を畳み込まないため思考が消える。
**同じ面の中で経路によって挙動が割れている**のがこのセルの厄介なところ。

### (7) responses × thinking —— 要求は通るが応答に載らない

`reasoning: { effort }` は unified に残って上流へ届く。戻りが問題で、
`convertChatCompletionToResponses`（`src/llms/transformers/openai/responses/inbound.ts`）が
組み立てるのは `message` と `function_call` のアイテムだけ。Responses API 本家が返す
`reasoning` アイテムに相当するものが無いので、Codex CLI からは思考が見えない。

### (8) gemini × thinking —— 応答は通るが要求できない

応答側は `thought: true` のパートとして正しく戻る（順序も本家どおり思考が先）。
要求側の `generationConfig.thinkingConfig` が読まれない（(4) の共通原因）。

### (9) gemini × usage 記録 —— **修正済み**（2026-09-01）

RequestLog の 1 行は 2 つの出所から組み立てられる。

- **面の帰属**（`inboundType` / `surface` 列）—— 記述子から `resolveInvocationForModel` が押す。
  4 面すべて正しく刻まれる。
- **トークン数** —— `captureUsage`（`src/llms/pipeline/usage-extraction.ts`）が
  **変換前の生の上流応答**のクローンから読む。`sendToProvider` が
  `processResponseTransformers` の手前でクローンするため、読める語彙は**プロバイダ**の
  ワイヤ形式で決まる。

`UsageBlockSchema`（`src/schemas/domain/usage-record.ts`）が宣言していたのは Anthropic と
OpenAI の名前だけで、Gemini の `usageMetadata`（`promptTokenCount` / `candidatesTokenCount` /
`cachedContentTokenCount`）が入っていなかった。`extractUsage` が null を返すと `captureUsage` は
即 return するので、**行が 1 行も残らない** —— Activity 画面にもコスト集計にも Gemini の
トラフィックが一切出てこない状態だった。

gemini 面の既定の相方は Google プロバイダ（バイパス経路）なので、これは変換経路だけの話ではなく
**gemini 面の通常運用でそのまま起きていた**。この表の中で唯一、バイパス経路でも成立しないセル
だった、という点でも重い。

**修正内容**: Gemini の3フィールドを `UsageBlockSchema` に足し、`JsonResponseWithUsageSchema` が
応答ルートの `usageMetadata`（Gemini は `usage` に入れない）も受けるようにした。SSE 側は
`GeminiUsageChunkSchema` を追加 —— Gemini は多くのチャンクに累積値を載せるので、最後に見たものが
勝つ。`cachedContentTokenCount` は (10) と同じ**包含型**として扱う（SDK が "When `cached_content`
is set, this also includes the number of tokens in the cached content" と明記している）。

マイグレーションは不要だった。`RequestLog` の列はもともと揃っていて、埋める値が来ていなかった
だけである。

### (10) chat/completions × cache トークン —— **修正済み**（2026-09-01）

OpenAI Chat Completions が返すのは `usage.prompt_tokens_details.cached_tokens`、
Responses が返すのは `usage.input_tokens_details.cached_tokens`。`UsageBlockSchema` が
宣言していたのは**後者だけ**だったので、Chat 経路のキャッシュ命中は 0 として記録されていた。
実際には課金が安くなっているのに Activity は満額で出る、という向きの誤りである。

`prompt_tokens_details` を宣言して解消した。ただし**単にフィールドを足すと別のバグが入る**ので、
あわせて合算のしかたも直している。

**二つのベンダは逆の慣習で数える。** Anthropic の `input_tokens` は非キャッシュ分だけで、
キャッシュ分は `cache_read_input_tokens` として隣に並ぶ（足し合わせて総量になる）。
OpenAI の `cached_tokens` は SDK の型定義が **"Cached tokens present in the prompt"** と
明記するとおり `prompt_tokens` / `input_tokens` の**内訳**で、**既に含まれている**。
`computeTokenStats` は Anthropic 式に無条件で加算していたため、OpenAI 側では
キャッシュ命中のあるリクエストの input が命中分だけ水増しされていた
（`input_tokens_details` を読んでいた Responses 経路には**以前から**この誤りがあった）。

`cachedInputTokens()` がどちらの慣習かを判別し、OpenAI 側は合算前に差し引くようにした。
`RequestLog` の列は Anthropic の慣習（`inputTokens` = 非キャッシュ分、
`totalInputTokens` = 総量）のままである。

このため `__tests__/parity/cache-tokens.test.ts` の `openai-responses` のフィクスチャも
直した。`input_tokens: 20` にキャッシュ 80 という**OpenAI からは来ない値**で、
偶然 Anthropic 式の合算と辻褄が合っていた。

### (11) responses × cache トークン —— 計上は通るが返却で落ちる

`input_tokens_details.cached_tokens` は読まれて `cacheReadTokens` に載る（合算の二重計上は
(10) で修正済み）。落ちるのは返却方向で、`convertChatCompletionToResponses` が
組む usage は `input_tokens` / `output_tokens` / `total_tokens` の 3 つだけ。
Codex CLI 側のキャッシュ表示は常に 0 になる。

なお `cacheWriteTokens` が 0 なのは、当初「write 相当の概念は OpenAI に無い」と書いたが
**それは誤り**だった。`node_modules/openai` の型定義には Chat / Responses の両方に
`cache_write_tokens`（"The unadjusted number of prompt tokens written to cache"）が
宣言されている。`UsageBlockSchema` はこれを読んでいないので、OpenAI 側の write は
計上されていない。読むこと自体は小さいが、これが `prompt_tokens` の内訳に含まれるのか
（含まれるなら (10) と同じ差し引きが要る）を確かめてからでないと入れられないので、
**未対応として残す**。

### (12) gemini × cache トークン —— **修正済み**（2026-09-01）。(9) に含まれる

もとは「`cachedContentTokenCount` を読む口が無い以前に、行そのものが作られない」だった。
(9) の修正で行が作られるようになり、あわせて `cachedContentTokenCount` も内訳として
読むようにした。返却方向（`toUsageMetadata` が `cachedContentTokenCount` を出す）は
もともと正しく動いている。

## 面によらないと確認したもの

以下は 4 面で**同一の実装**が動く。この行の担保は「面ごとに動くこと」ではなく
**「面によって差が出ないこと」**の証明になっている。

| 対象 | 実装 | 面を見ていないことの担保 |
|---|---|---|
| フォールバックチェーンの構築 | `src/api/v1/candidate-chain.ts` | `__tests__/parity/failover-429.test.ts` |
| 429 / `insufficient_quota` の判定 | `src/api/v1/upstream-error.ts` | 同上 |
| サブアカウント回転・枯渇マーク | `src/api/v1/chain-failover.ts` | 同上（面依存の分岐が無いことをチェーン一致で示す） |
| エラー封筒の選択 | `src/api/v1/error-shape.ts` | `__tests__/parity/error-envelope.test.ts` |
| 非ストリーム集約関数の選択 | 記述子の `aggregateSse` | `__tests__/parity/non-stream-aggregate.test.ts` |

面によって変わるのは**失敗を返すときの封筒だけ**である。

## ルーティングの面パリティ

マトリクスの手前に「そもそも面ごとにルーティングを効かせられるか」がある
（master-plan §2-5 の完了条件その 2）。以前はこれが `scenario-router.ts` に直書きされていて、
`/v1/messages` 以外は無条件に素通しだった —— つまりルーティング画面はすべて
`/v1/messages` 専用画面だった。今はモードが `InboundSurfaceConfig` の設定値で、
4 面が対称に振る舞う（`__tests__/parity/routing-mode.test.ts`）。

対称でない点が 2 つ残っている。

- **persona 注入は `/v1/messages` 限定**（意図的）。OpenAI 互換の面にトップレベル `system` を
  足すと、上流（codex が代表例）が未知パラメータとして 400 を返す。
- **シナリオ分類が Anthropic 語彙に依存している**（未対応）。5 つのレーンのうち
  `default` 以外は、面によって選べたり選べなかったりする。

| レーン | 読む信号 | 選べる面 |
|---|---|---|
| `longContext`（サイズ） | `countRequestTokens` が `body.messages` / `body.system` / `body.tools` を数える | messages / chat（responses・gemini は本文が `input` / `contents` にあるので**常に 0 トークン**） |
| `longContext`（effort/tier） | `body.output_config.effort`、モデル名の tier | messages のみ（`output_config` は Claude Code 固有） |
| `webSearch` | `tools[].type` が `web_search*` で始まるか | messages のみ（他 3 面のツール型は `function` / `functionDeclarations`） |
| `think` | `body.thinking.type` | messages のみ |
| `default` | 上のどれにも当たらない | 4 面すべて |

つまり **`routed` にはできるが、`/v1/messages` 以外はほぼ `default` レーンにしか落ちない**。
4 面で等しく効くのは「`default` レーンの primary への書き換え」と
「フォールバックチェーンの解決」まで。

## 未対応セルを直すときの手順

未対応セルのテストは、**現在の（壊れた）挙動を固定する**書き方になっている
（例: `expect(unified.messages).toEqual([{ role: 'user', content: null }])`）。
これは意図的で、実装を直すとテストが落ち、この文書の更新を強制する。

1. 実装を直す（`src/` 側）
2. 該当セルのテストの期待値を反転させる（`__tests__/parity/`）
3. この文書のマトリクスとセル注記を更新する

`__tests__/parity/matrix.test.ts` が、マトリクス表が 10 行 × 4 列で埋まっていること、
ラベルが 3 種類のいずれかであること、注記番号が実在することを検査する。
セルを空のまま増やすことはできない。
