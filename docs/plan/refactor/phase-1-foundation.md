# Phase 1: Foundation

## Objective

安全にリファクタするための計測・検証基盤を先に整える。

## Tasks

1. テスト基盤の棚卸し
- `__tests__/lib`, `__tests__/db`, `__tests__/preset`, `__tests__/providers` の責務を明文化
- 主要APIルートに対する不足テストを列挙

2. 型とLintの基準統一
- `tsconfig` の役割分離（app / runtime / workspace）
- Biomeルールのうち運用で形骸化している項目を見直し

3. ログとエラーハンドリングの共通化
- `src/lib/logger.ts` とAPIルートの出力形式を統一
- 例外レスポンスのフォーマットを標準化

4. 依存関係の可視化
- 循環参照候補を抽出し、解消優先度を付与
- `src/services` と `src/llms` の境界依存を確認

## Deliverables

- テスト対象マップ（md）
- 共通エラーフォーマット定義（型）
- 依存境界の現状図（md）

## Exit Criteria

- CIが安定して通る
- 主要経路のテストギャップが一覧化されている
- 次フェーズの変更で壊れやすい箇所が可視化されている

## Week 1 Checklist (Execution Order)

1. [ ] `docs/architecture/testing-map.md` を作成し、既存 `__tests__/` の責務を分類する
2. [ ] APIルートの未カバー領域を列挙し、優先度（High/Medium/Low）を付ける
3. [ ] `__tests__/` に不足テストのTODOコメントを最小追加し、実装対象を固定化する
4. [ ] `tsconfig` 役割分離の現状差分（app/runtime/workspace）を調査メモ化する
5. [ ] Biomeルールの形骸化項目を抽出し、暫定運用方針を記載する
6. [ ] ログ/エラーフォーマットの現状を比較し、共通化対象を確定する
7. [ ] Phase 2へ引き渡す「変更禁止境界」と「先行テスト必須境界」を明文化する
