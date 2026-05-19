# Naming Conventions

## Purpose

命名の揺れを減らし、検索性・保守性・レビュー効率を上げる。

## Global Rules

- ファイル名は用途に応じて `PascalCase` / `camelCase` / `kebab-case` を使い分ける
- 略語は一般的なもののみ許可（`api`, `db`, `ui` など）
- 単語区切りは省略せず意味が分かる名前にする
- 新規ファイルは必ず既存ディレクトリ規約に合わせる

## Directory-specific Rules

### `src/components`

- Reactコンポーネント: `PascalCase.tsx`
- 例: `SettingsPage.tsx`, `RequestHistoryDrawer.tsx`

### `src/components/ui`

- UIプリミティブ: `kebab-case.tsx`
- 例: `input-group.tsx`, `multi-combobox.tsx`

### `src/hooks`

- カスタムフック: `use-<feature>.ts` または `use-<feature>.tsx`
- 例: `use-enabled-model-options.ts`

### `src/services`, `src/lib`, `src/utils`

- モジュール: `camelCase.ts`
- 例: `usageService.ts`, `providerTestService.ts`

### `src/api/**`

- ルートエントリは固定で `route.ts`
- ディレクトリ名は `kebab-case`

### `docs/**`

- ドキュメントは `kebab-case.md`
- フェーズ文書は `phase-<n>-<topic>.md`

## Identifier Rules

- 型/インターフェース: `PascalCase`（例: `GetUsageOutput`）
- 関数/変数: `camelCase`（例: `fetchUsageSnapshot`）
- 定数: `UPPER_SNAKE_CASE`（例: `TEST_TIMEOUT`）
- React hooks 関数: `useXxx`（例: `useEnabledModelOptions`）

## Exception Policy

- 外部仕様で固定名が必要な場合のみ例外許可
- 例外は同ディレクトリの `README` または該当PR本文に理由を明記
