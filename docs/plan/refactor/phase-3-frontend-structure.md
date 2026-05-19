# Phase 3: Frontend Structure

## Objective

画面構成と状態管理の責務を整理し、UI変更の局所化を進める。

## Tasks

1. 画面責務の分離
- `src/app` のルート単位でコンテナと表示コンポーネントを分離
- データ取得ロジックを画面から引き剥がし、hooksへ移す

2. UIコンポーネントの整備
- `src/components/ui` の汎用コンポーネント利用を統一
- `src/components/preset` など業務コンポーネントとの境界明確化

3. 状態管理の整理
- フォーム状態、サーバー状態、一時UI状態を分離
- `react-hook-form` 利用箇所のバリデーション規約統一

4. i18nと文言管理の整備
- `src/locales/*.json` のキー規約を統一
- 未使用キーと重複キーを除去

## Deliverables

- 画面責務ガイド（md）
- hooks分割方針（md）
- i18nキー命名規約（md）

## Exit Criteria

- 主要画面のコンポーネント責務が一貫
- UI修正時の影響範囲が限定
- 文言管理が追跡しやすい構成になる

## 第1スライス実施内容（2026-05-19）

- 対象画面: Router（`/router`）
- 変更概要:
  - `Router` 画面内にあった有効モデル一覧の取得（`GET /models`）と `SelectCombobox` 向けの選択肢整形を、`src/hooks/use-enabled-model-options.ts` に分離。
  - 画面側は新hookの戻り値（`modelOptions`）を利用するだけに変更し、フォームUI・保存処理・トースト挙動は不変。
- 意図:
  - 画面コンポーネントからデータ取得/整形責務を切り離し、表示ロジック中心の構造に寄せるための最小スライス。
