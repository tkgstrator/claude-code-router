# Effort Translation（プロバイダごとに `effort` を実 API パラメータへ翻訳）

Status: Planning

## 目的

Claude Code が送る `body.output_config.effort`（`low` / `medium` / `high` / `xhigh` / `max`）を、
routing 用の内部シグナルとして消費するだけでなく、**上流プロバイダの「推論の重さを制御する」ネイティブパラメータ**に翻訳して送信できるようにする。

現状は `output_config` を送信前に丸ごと削除しているため、
CC で「haiku は low、opus は high」のようにモデル別 effort を設定していても、
その意図は Anthropic / OpenAI 側の API 呼び出しには一切反映されていない。

## 問題

### 症状

- CC ユーザーが「このモデルは軽く動かしたい / 重く考えさせたい」と effort を設定しても、
  実際の API 呼び出しでは常に「デフォルトの推論負荷」になる。
- CCR 側で `output_config.effort` を **routing 判定**（`isHeavyRequest` による longContext 昇格、
  rule の `effort` predicate）には使うが、**リクエスト body の書き換え**は行っていない。

### 根本原因

`src/api/v1/invocation.ts` の `resolveInvocationForModel` で、per-attempt body 構築の最後に
`delete body.output_config` を実行して CC 独自メタデータ（`context_management` / `output_config` /
`diagnostics`）を丸ごと剥がしているため、`effort` 値が上流に到達しない。

その手前で `normalizeEffort(body, model)` が per-model 最大値へクランプしているが、
直後に `output_config` ごと消えるので現状は事実上デッドコード。

### プロバイダごとの受け皿

各プロバイダで「推論の重さ」を表現する API パラメータは名前・型が違い、翻訳が要る。

| プロバイダ | 受けるパラメータ | 型 |
|---|---|---|
| Anthropic (extended thinking 対応モデル) | `thinking: { type: 'enabled', budget_tokens: N }` | 数値予算 |
| OpenAI reasoning models (o1 / o3 / gpt-5 系) | `reasoning_effort: 'low'\|'medium'\|'high'` | 3 値 enum |
| Gemini 2.5+ (thinking 対応) | `thinking_config: { thinking_budget: N }` | 数値予算 |
| その他 (グロク系・DeepSeek reasoner 等) | 独自パラメータ or 非対応 | 個別対応 |

## スコープ

- **In scope**: `output_config.effort` を各プロバイダのネイティブ推論パラメータに翻訳して送信する。
- **In scope**: 翻訳表（effort 5 値 → 各プロバイダ固有値）を per-provider に持てる仕組み。
- **In scope**: モデルが `effort` を受け付けない場合は翻訳スキップ（`EFFORT_BY_MODEL` の既存判定を再利用）。
- **In scope**: 400 リトライパス（`route.ts` 内の `deepReplaceValue`）との整合性維持。
- **Out of scope**: rule から `effort` を書き換えるアクション（別レイヤの話）。
- **Out of scope**: CC 側の effort 設定 UI（CC 側の責務）。

## 設計案

### 方針の選択肢

#### A. `invocation.ts` に直書き（小規模、単発）

`normalizeEffort` の直後、`delete body.output_config` の前に per-provider の翻訳分岐を挟む。

```ts
// resolveInvocationForModel の該当箇所
normalizeEffort(body, model)
translateEffortForProvider(body, provider, model)  // ← 追加
delete body.output_config
delete body.context_management
delete body.diagnostics
```

- Pro: 変更が 1 ファイルで完結、影響範囲が読める。
- Con: プロバイダ判定ロジックが `invocation.ts` に混ざる。テストが結合寄りになる。

#### B. Transformer レイヤに `effort-remap` transformer を追加（推奨）

`@musistudio/llms` の transformer 機構（`anthropic-request`, `openai-responses-request`,
`enhancetool`, `reasoning` など）と同じ層に `effort-remap` transformer を新設し、
プロバイダの `transformer.use` に組み込む。

- Pro: 既存の分業（プロバイダ差分 = transformer 層）に沿う。プロバイダ設定 UI から on/off できる。
- Pro: 単体テストがしやすい（transformer の request handler をそのままユニットテスト）。
- Con: `@musistudio/llms` 側の拡張が必要（このリポの外）。
  もしくは CCR 側だけで完結する軽量 remap を transformer 相当の抽象で書く。

**推奨: B。** ただし `@musistudio/llms` を触りたくない場合は
CCR 側に `src/llms/effort-remap.ts` を置き、`resolveInvocationForModel` から呼ぶ形（実質 A の疎結合版）で妥協する。

### 翻訳表の初期案

```ts
// src/llms/effort-remap.ts (仮)

// Anthropic (extended thinking): 5 値 → budget_tokens
// budget は "モデル / max_tokens" とのバランスがあるので、あくまで初期値。
// 実運用で調整する前提。
const ANTHROPIC_BUDGET: Record<EffortLevel, number> = {
  low:    1024,
  medium: 4096,
  high:   16384,
  xhigh:  32768,
  max:    65536
}

// OpenAI reasoning: 5 値 → 3 値 enum
const OPENAI_REASONING: Record<EffortLevel, 'low' | 'medium' | 'high'> = {
  low:    'low',
  medium: 'medium',
  high:   'high',
  xhigh:  'high',
  max:    'high'
}

// Gemini: 5 値 → thinking_budget
const GEMINI_BUDGET: Record<EffortLevel, number> = { ...ANTHROPIC_BUDGET }
```

### プロバイダ判定

`provider.transformer.use` に含まれる transformer 名で分岐するのが安全。

- `anthropic` / `anthropic-oauth` / `claude-code-oauth` → Anthropic 系
- `openai-responses` / `openai` → OpenAI 系
- `gemini` → Gemini 系
- それ以外 → スキップ

API base URL パターンマッチ（`api.anthropic.com` / `openai.com` / `googleapis.com`）でも可だが、
transformer 名の方がユーザーの設定意図に近い。

### 翻訳スキップ条件

以下のいずれかで翻訳しない（既存挙動を維持）:

- モデルが `EFFORT_BY_MODEL` に含まれない（= CCR が effort 未対応と判定している）。
- リクエスト body に既に `thinking` / `reasoning_effort` / `thinking_config` が明示的にセットされている
  （CC 側の意図を上書きしない）。
- プロバイダが上記の 3 系統に該当しない。

### 400 リトライパスとの整合

`route.ts:129` の `deepReplaceValue(inv.body, fix.bad, fix.level)` は
「upstream が特定 effort 値を拒否したら別の値に書き換えて再送」する仕組み。

翻訳後は `body.thinking.budget_tokens` などが数値で入るので、
既存の effort 文字列マッチはヒットしなくなる。翻訳前の body に対して deepReplace が走るなら影響は無い
（現状 delete 前に走るタイミングは無いのでこのまま）。

翻訳後の 400（例: budget が大きすぎる）に対する retry は別途仕組みが要る場合があるが、
初期リリースでは翻訳表の値を保守的にして 400 が出ないラインに寄せる。

## Phase 分割

1. **Phase 1**: `src/llms/effort-remap.ts` を新規作成、
   `translateEffortForProvider(body, provider, model)` を実装。
   Anthropic 系のみ対応（`thinking.budget_tokens`）。
2. **Phase 2**: `resolveInvocationForModel` から呼び出し、`delete body.output_config` 直前に挟む。
   unit test（ユニット関数として） + `__tests__/api/invocation.test.ts` で結合テスト。
3. **Phase 3**: OpenAI reasoning models 対応（`reasoning_effort`）。
4. **Phase 4**: Gemini 対応（`thinking_config`）。
5. **Phase 5** (opt): 翻訳表を config で上書きできる仕組み。
   デフォルト表 + 環境変数 or Provider 設定でオーバーライド可能に。

## 検証観点

- CC が `effort: high` を送った Anthropic subscription リクエストが、
  upstream に `thinking.budget_tokens: 16384` を含んで到達する。
- CC が effort を送らないリクエストは変更なく通る（regression なし）。
- `EFFORT_BY_MODEL` にないモデル（例: `claude-3-5-haiku-*`）は翻訳スキップ。
- CC 側で既に `thinking` を明示している場合、上書きされない。
- 翻訳後の 400 は既存の failover ロジックで正しくローテートする。

## 未決事項

- 翻訳表の値（特に `budget_tokens`）は経験則で決めるしかない。初期値は保守的にし、
  実運用で調整する前提。
- 「rule から effort を書き換える」ユースケース（例: `when: {requestedTier: ['haiku']}, then: {setEffort: 'low'}`）
  を将来追加する場合、rule engine に action 概念を導入する別設計が要る。
  このドキュメントは扱わない。
