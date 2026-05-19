# Testing Responsibility Map

## Purpose

Phase 1時点のテスト責務を可視化し、回帰リスクの高い未カバー領域を明確化する。

## Current Coverage Map

| Area | Main files | Responsibility | Type |
| --- | --- | --- | --- |
| Config envelope read/apply | `__tests__/lib/configEnvelope.test.ts` | `config.json` のJSON/JSON5読込、環境変数展開、`process.env` 反映、`API_TIMEOUT_MS` の後方互換 | Unit |
| Config schema contract | `__tests__/lib/configEnvelopeSchema.test.ts` | `ConfigEnvelopeSchema` の受理/拒否条件（特に `API_TIMEOUT_MS` coercion） | Unit |
| DB config service | `__tests__/db/configService.test.ts` | `applyUiConfig` / `composeUiConfig` の往復整合、Provider/Model削除時のRouterSlot整合、警告、永続化 | Integration (DB) |
| JSON→DB migration | `__tests__/db/migrateFromJson.test.ts` | 起動時マイグレーションの分岐（no-op / migrated / bail）、ディスク書き戻し | Integration (DB + FS) |
| Preset schema/condition | `__tests__/preset/schema.test.ts` | Preset関連Zod schema、条件評価ロジック (`evaluateCondition`) | Unit |
| Provider routing E2E | `__tests__/providers/openai.test.ts` `__tests__/providers/gemini.test.ts` `__tests__/providers/claude.test.ts` `__tests__/providers/codex.test.ts` | `/v1/messages` 経由のSSE形状、最小応答健全性、subscription providerの動的モデル行列スモーク | Live Integration |

## Supporting Test Utilities

- `__tests__/providers/helpers.ts`: CCR API呼び出し、SSEパーサ、subscription model matrix取得
- `__tests__/db/helpers.ts`: DB初期化/クリーンアップ、DB利用可否ゲート

## Gaps (Phase 1 backlog)

1. APIルート単体のHTTP契約テスト不足  
   `src/routes/api/*` のステータスコード・バリデーションエラー・例外時レスポンス形式が未固定。

2. 認証/認可エッジケース不足  
   APIキー未設定・不正キー・ヘッダ欠落時の統一挙動テストが不足。

3. 非live環境でのprovider変換ロジック検証不足  
   現状はlive integration中心で、transformer単体（request/response変換）の決定論テストが薄い。

4. ログ・エラー共通化に対する回帰テスト不足  
   フェーズ1タスクの「ログとエラーハンドリング共通化」を支えるスナップショット/契約テストが未整備。

## Week 1 Test Priorities

1. APIルート契約の最小テストセット定義（対象エンドポイント一覧化）
2. 失敗系（401/403/422/500）レスポンス形の期待値固定
3. provider変換ロジックのoffline unit test追加ポイント確定
