# Phase 2: Backend Architecture

## Objective

`API -> Service -> Domain/Infra` の責務を明確にし、変更容易性を上げる。

## Tasks

1. APIルートの薄化
- `src/api/**/route.ts` から業務ロジックを `src/services` へ移管
- ルートは入力検証、認証、レスポンス整形に限定

2. Service層の再編
- `usage`, `models`, `providers`, `transformers` を機能単位で分割
- `src/services` と `src/llms/services` の重複責務を解消

3. DBアクセス境界の固定化
- Prisma呼び出しをRepository風の窓口に寄せる
- トランザクション境界を明示し、暗黙依存を減らす

4. 外部API連携の標準化
- OpenAI/Anthropic/Google 向けアダプタの共通インターフェース化
- リトライ・タイムアウト・エラー分類の統一

## Deliverables

- API層責務ガイド（md）
- 共通サービスインターフェース定義（ts）
- DBアクセス規約（md）

## Exit Criteria

- APIルートの平均行数と分岐が削減
- サービスの単体テスト追加で回帰確認がしやすい
- Provider追加時の変更箇所が限定される

## 第1スライス実施内容

- 対象: `src/api/usage/route.ts`, `src/services/usageService.ts`
- ルート薄化: `/api/usage` ルートから usage 組み立て責務をサービス境界関数へ移動し、ルートは `service call -> json response` のみとした
- サービス境界の明確化: `GetUsageInput` / `GetUsageOutput` を追加し、`fetchUsageSnapshot(input) -> { usage }` の入力/出力契約を定義
- 互換性維持: 既存呼び出し向けに `getUsage()` は残し、新境界関数の薄いラッパー化で挙動変更なし
