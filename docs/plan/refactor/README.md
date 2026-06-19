# Refactor Plan

このディレクトリは、リポジトリ全体の段階的リファクタ計画を管理するための場所です。

## Documents

- `master-plan.md`: 全体方針、成功条件、進め方
- `phase-1-foundation.md`: 可観測性と安全レールの整備
- `phase-2-backend-architecture.md`: API / Service / DB 層の整理
- `phase-3-frontend-structure.md`: UI 構造と状態管理の整理
- `phase-4-workspaces-and-quality.md`: `packages/*` と品質ゲートの整理
- `phase-5-multi-account-same-plan.md`: 同一プランの複数アカウント運用
- `phase-6-quota-aware-routing.md`: 窓別レートリミットを見た動的ルーティング
- `../../standards/naming-conventions.md`: 命名規約（ファイル名・識別子）

## Operation Rules

- 各フェーズは小さくPRを分ける（1PR = 1テーマ）
- フェーズ開始時に対象・非対象を明記する
- 既存の動作互換を優先し、仕様変更は別PRに分離する
- 各フェーズ終了時に計測結果（CI時間、テスト件数、主要指標）を更新する
