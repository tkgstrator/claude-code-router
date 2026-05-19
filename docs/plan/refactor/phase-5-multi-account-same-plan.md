# Phase 5: Multi-Account Same Plan

## Objective

同一サブスクプラン（例: Claude Code Max）を複数アカウントで運用できるようにする。

## Problem

- 現状は provider ごとに単一資格情報前提。
- 複数契約していても、CLIログインを手動で切り替えないと利用を分散できない。

## Target Model

- 1 provider に対して `accounts[]` を持つ。
- `activeAccount` を選択して現在利用対象を決定する。
- 将来的に `activeAccount` は固定だけでなく自動選択（LRU / utilizationベース）へ拡張する。

## API Contract

- `GET /api/subscriptions` は以下を返す:
- `subscriptions[].providerName`
- `subscriptions[].accounts[]`
- `subscriptions[].activeAccount`

## Selection Policy (Initial)

1. 期限切れでないアカウントを優先
2. なければ先頭アカウントを採用
3. アカウントが空なら未接続扱い

## Environment Inputs

- Claude: `CCR_CLAUDE_CREDENTIALS_FILES`（`,` 区切り）
- Codex: `CCR_CODEX_AUTH_FILES`（`,` 区切り）

未指定時は従来パスを使う:
- `~/.claude/.credentials.json`
- `~/.codex/auth.json`

## Next Slices

1. UIにアカウント一覧とアクティブ切替を追加
2. リクエスト時に `activeAccount` を利用する transformer 拡張
3. 429 / quota 到達時のフェイルオーバー実装
