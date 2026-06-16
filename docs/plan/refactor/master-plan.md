# Repository-wide Refactor Master Plan

## Goal

- 保守性を上げつつ、既存機能の挙動を維持する
- 変更容易性を高め、機能追加時の影響範囲を小さくする
- CIの安定性と速度を改善する

## Scope

- `src/` 全体（API、サービス、LLM連携、UI）
- `packages/cli` と `packages/shared`
- テスト、型チェック、Lint、ビルド導線

## Non-Goals

- 大規模な仕様変更
- UI/UXの全面刷新
- 新規機能開発を主目的とした変更

## Success Criteria

- 主要フローの回帰不具合ゼロ
- CI（`Build`/`Type Check`/`Test`）成功率の維持または改善
- レイヤー境界がドキュメントと実装で一致
- 重複ロジックの削減と責務分離の明確化

## Execution Strategy

1. 先に安全レール（テスト、ログ、型）を強化する
2. バックエンドの依存方向を整理する
3. フロントエンドの状態とUI責務を分離する
4. workspaceを整理し、品質ゲートを固定化する

## Milestones

1. Phase 1: Foundation
2. Phase 2: Backend Architecture
3. Phase 3: Frontend Structure
4. Phase 4: Workspaces and Quality
5. Phase 5: Multi-Account Same Plan
6. Phase 6: Quota-Aware Routing

## Tracking

- 各Phase文書に「Done / In Progress / Blocked」を追加運用する
- PRテンプレートに「対象境界」「非対象境界」「回帰確認項目」を必須化する
