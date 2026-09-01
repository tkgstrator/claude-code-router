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
`__tests__/api/route-plan.test.ts` が担保している。gemini 列の欠落が単一の原因
（`contents[]` 変換の破綻）に帰着していたことと、その修正後の `contents[]` の全形は
`__tests__/parity/gemini-request-conversion.test.ts` が固定している。

## セル注記

### (1) responses × ストリーミング —— 逐次性を失う

`OpenAIResponsesTransformer.transformResponseIn`（`src/llms/transformers/openai/endpoint-responses.ts`）は
上流の chat SSE を `aggregateOpenAiChatSseToJson` で**一度 JSON に畳んでから** Responses SSE を
組み直す。イベント列は本物と同じ順序で出るのでワイヤ契約は満たすが、最初の `output_text.delta` が
出るのは上流の完了後 —— つまり TTFT が失われる。Chat → Responses の境界を逐次で通す実装が要る。

### (2) gemini × tool use —— **修正済み**（2026-09-01）

`tools[].functionDeclarations` は元から通っていた。落ちていたのは `contents[]` に載る
`functionCall`（アシスタントの呼び出し）と `functionResponse`（ツールの返り値）で、原因は
(3)(4) と同じ `contents[]` 変換の破綻（下の「共通原因」）。**1 往復目は動いてツール結果を返す
2 往復目で会話が空になる**ので、宣言だけ見ていると気づけない壊れ方だった。

現在は `functionCall` が unified の `tool_calls`、`functionResponse` が `role: 'tool'` の
メッセージになる。Gemini は結果をユーザーターンにまとめて詰めるが unified は
OpenAI 流に 1 結果 = 1 メッセージなので、`contents[]` の 1 エントリが複数メッセージを産む。

**id の合成規則**が要点。Gemini の `functionResponse` は id を持たないのが普通なので、
関数名と到着順で呼び出しに突き合わせ、`gemini_call_<name>_<n>` を合成する。採番カウンタは
減らないので、同名ツールを 2 回呼んでも 2 回目の結果が 1 回目に紐づくことはない
（`__tests__/parity/tool-use.test.ts`「同名ツールの複数呼び出し」）。呼び出しの見つからない
結果は `gemini_call_<name>_orphan` になる —— クライアントが古いターンを削るのは合法なので、
捨てずに宛先を与えている。

`toolConfig.functionCallingConfig` も読むようになった（`buildToolConfig` のちょうど逆写像）。
`ANY` + `allowedFunctionNames` が 1 件なら OpenAI 語彙の function 指定、複数なら `required`。
ワイヤ上の大文字（`AUTO` / `ANY` / `NONE`）と自前の outbound が出す小文字の両方を受ける。

### (3) gemini × system プロンプト —— **修正済み**（2026-09-01）

`GeminiInboundRequestSchema`（`src/schemas/wire/gemini/content.ts`）が `systemInstruction`
（と snake_case の `system_instruction`）を宣言し、`transformRequestOut` が unified の
`role: 'system'` メッセージへ写す。**contents[] より前に積む**ので、system を先頭でしか
受けないプロバイダでも効く。

複数パートは改行で連結して**素の文字列**にする。他の 3 面の system も文字列なので、
gemini だけブロック配列にすると面によって形が割れる。

### (4) gemini × 画像入力 —— **修正済み**（2026-09-01）

`GeminiInboundPartSchema` が `inlineData` / `fileData` を宣言し、unified の
`image_url` ブロックに写す。inlineData は `data:<mime>;base64,<payload>` に組み直す ——
`request-content.ts` の `buildImagePart` がカンマで割って base64 に戻すので、
gemini → gemini の往復で元の形に返る。`media_type` も残す（Anthropic outbound が
`source.media_type` を組むのに要る）。

Google の JSON マッピングは camelCase と proto の snake_case を両方受けるので、
`inlineData.mimeType` / `inline_data.mime_type`、`fileData.fileUri` / `file_data.file_uri` の
どちらの綴りでも読む。片方しか読まないと、クライアントの実装次第で画像が消える。

### (2)(3)(4)(8) の共通原因 —— `contents[]` 変換が本文ごと落としていた（修正済み）

gemini 列が横並びで欠けていたのは、機能ごとの取りこぼしではなく**単一のバグ**だった。

`GeminiInboundContentObjectSchema` が `text: z.string().default('')` を宣言していたため、
`inboundContentToMessage`（`src/llms/utils/gemini-request.ts`）の

```ts
if (typeof content.text === 'string') {
  return { role: 'user', content: content.text.length > 0 ? content.text : null }
}
```

が**常に真**になり、その下にある `role === 'user'` / `role === 'model'` の `parts` 分岐に
決して到達しなかった。結果、Gemini の正規ワイヤ形式

```json
{ "contents": [{ "role": "user", "parts": [{ "text": "hello" }] }] }
```

が `[{ role: 'user', content: null }]` になる —— **本文が消え、`model` ロールは `user` に潰れる**。

修正は 2 段構え。`text` の `.default('')` を外して本当に省略可能にし、さらに分岐順を
**「parts があれば parts → 無ければ text → どちらも無ければ捨てる」**に直した。片方だけだと、
レガシーな `{ text }` 形と正規形のどちらかがまた黙って落ちる。あわせて `role` の省略を
`user` 扱いにした —— Gemini API では role は省略可で、以前はそのエントリを丸ごと捨てていた。

inbound 側の変換は `src/llms/utils/gemini/inbound-request.ts` に分離してある
（outbound の `request-content.ts` / `request-config.ts` と対になる）。

`generationConfig.maxOutputTokens` / `temperature` / `thinkingConfig` も読むようになった。
`generationConfig.temperature` の `0` が既定値に化けないことは明示的にテストしてある ——
`||` で書くと落ちる値で、決定論的な出力を求めるクライアントが必ず送る。

バイパス経路（gemini 面 → Google プロバイダ）はこの変換を通らないので、元から影響は無かった。
**gemini 面を `routed` にした瞬間に壊れる**、という形の未対応だったということ。

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

### (8) gemini × thinking —— **修正済み**（2026-09-01）

応答側は元から `thought: true` のパートとして正しく戻っていた（順序も本家どおり思考が先）。
要求側の `generationConfig.thinkingConfig` が読まれていなかったのが欠けていた半分で、
これは上の「共通原因」に含まれる。

現在は `thinkingLevel`（Gemini 3）をそのまま `reasoning.effort` に、旧モデルの
`thinkingBudget` は `getThinkLevel` で段階に丸める。**この丸めは `/v1/messages` が
Anthropic の `budget_tokens` に使うのと同じ関数**である —— 面によって「8192 トークンの思考」の
意味が変わってはいけない。`thinkingBudget` は `reasoning.max_tokens` にも残すので、
`buildGenerationConfig`（outbound）を通した往復で予算が戻る。

`thinkingLevel` は enum ではなく文字列として読む。Google は think レベルを増やすので、
厳格な enum にすると知らない値ひとつでリクエスト全体が 500 になる。読めない値は
`includeThoughts` だけを見て `reasoning: { enabled: true }` に落とす。

過去ターンの `thought: true` パートは `content` ではなく unified の `thinking` フィールドに
載せる。本文に混ぜると、モデルの内心が次のプロバイダに**ユーザーの発話として**渡る。

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

**シナリオ分類の Anthropic 語彙依存は解消した**（2026-09-01）。以前はこの節に
「`routed` にはできるが `/v1/messages` 以外はほぼ `default` レーンにしか落ちない」と
書いてあった。分類器と**ルール述語**が `body.thinking` / `body.output_config.effort` /
`tools[].type` を直読みしていたためで、面ごとにモードは選べるのにその裏のレーンへ道が無い、
という状態だった。

いまは `src/llms/scenario-router/surface-signals.ts` が面ごとの語彙差を吸収し、分類器・
ルール述語・トークン計上の 3 箇所がそこだけを読む。

| レーン | 読む信号（正規化後） | 選べる面 |
|---|---|---|
| `longContext`（サイズ） | `signals.tokenize`（面ごとに `messages` / `input` / `contents` から組む） | 4 面すべて |
| `longContext`（effort/tier） | `signals.effort`、モデル名の tier | 4 面すべて（ただし下記の非対称あり） |
| `webSearch` | `signals.webSearch`（ベンダごとの綴りを意味で判定） | 4 面すべて |
| `think` | `signals.thinking` | 4 面すべて |
| `default` | 上のどれにも当たらない | 4 面すべて |

到達の担保は `__tests__/parity/routing-lanes.test.ts`（16 件）。**各面のクライアントが実際に
送る綴り**でレーンを要求している —— テストが Anthropic 形に寄せて書かれていたら、
正規化を何も検証しないことになるため。

対称でない点は 3 つ残っている。いずれも塞げないものなので明示しておく。

- **persona 注入は `/v1/messages` 限定**（意図的）。OpenAI 互換の面にトップレベル `system` を
  足すと、上流（codex が代表例）が未知パラメータとして 400 を返す。
- **OpenAI 2 面では effort→longContext の escalation に到達しない**（think レーン設定時）。
  Anthropic は `thinking` と `output_config.effort` が**独立した 2 フィールド**なので
  「頑張れ、ただし考えるな」を表現できるが、**OpenAI はノブが 1 つ**（`reasoning_effort`）
  しかない。`'none'` 以外の effort は必然的に reasoning の opt-in でもあるため、分岐順で
  先に来る `think` が必ず勝つ。ベンダの語彙の制約であって、実装の欠落ではない。
- **`minimal` / `none` は `low` に丸める**。`EffortLevel` に `low` より下の段が無い。
  `undefined` に落とすと「何も言わなかった」扱いになり、モデル tier での escalation に
  フォールスルーしてしまう —— 最安の推論を明示した呼び出し側は**何かを言っている**。

## 未対応セルを直すときの手順

未対応セルのテストは、**現在の（壊れた）挙動を固定する**書き方になっている
（例: 注記 (6) の `expect(Reflect.get(Object(choices[0].message), 'thinking')).toBeUndefined()`）。
これは意図的で、実装を直すとテストが落ち、この文書の更新を強制する。
実際 2026-09-01 の gemini 列の修正は、この仕掛けどおり 8 本のテストを落として始まった。

1. 実装を直す（`src/` 側）
2. 該当セルのテストの期待値を反転させる（`__tests__/parity/`）
3. この文書のマトリクスとセル注記を更新する

`__tests__/parity/matrix.test.ts` が、マトリクス表が 10 行 × 4 列で埋まっていること、
ラベルが 3 種類のいずれかであること、注記番号が実在することを検査する。
セルを空のまま増やすことはできない。
