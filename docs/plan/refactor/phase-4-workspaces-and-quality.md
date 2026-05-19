# Phase 4: Workspaces and Quality

## Objective

`packages/*` の責務境界とCI品質ゲートを固定化し、運用負荷を下げる。

## Tasks

1. `packages/shared` の公開境界整理
- 内部実装と公開APIを分離
- 依存方向を `shared -> app` ではなく `app -> shared` に固定

2. `packages/cli` の責務明確化
- CLIのI/O層とドメインロジックを分離
- 出力フォーマットとエラーコードの規約化

3. ビルドと配布導線の整理
- `build` / `release` スクリプトの責務分解
- 不要な重複ビルド手順を削減

4. CI品質ゲートの定着
- 必須ジョブを明文化（Build, Type Check, Test, Lint）
- テスト実行時間と失敗要因を定期計測

## Deliverables

- workspace境界ルール（md）
- CLI構造ガイド（md）
- CI運用基準（md）

## Exit Criteria

- パッケージ境界違反が検出しやすい
- リリース時の手順と責務が明確
- CIの失敗原因が分類可能で再発防止しやすい

## 第1スライス実施内容

- `packages/shared/src/index.ts` の公開エクスポート定義から説明コメントを削除し、barrelの公開面を宣言のみに統一
- 既存の `export *` 対象は変更なし（公開シンボル・挙動ともに不変）
- workspace build 影響確認として `build:shared` を最小実行
