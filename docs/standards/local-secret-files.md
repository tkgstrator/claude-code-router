# Local Secret Files

## Purpose

ローカルの認証情報ファイルが誤ってコミットされるのを防ぐ。ステージの作法ではなく `.gitignore` を唯一の防御線として扱う理由を記録する。

## Rule

**ローカルに置く認証情報ファイルは、作成と同時に `.gitignore` へ登録する。**

「気をつけて `git add` する」は防御にならない。理由は下記の実例を参照。

現在カバーされているパターンは `.gitignore` の先頭ブロックにまとまっている（dotenv 系と wrangler 系）。新しい種類の秘密ファイルを導入するときは、**最初のコミットより前に**そのブロックへ追加する。

## Why staging discipline is not enough

2026-08-29、v2.68.2 のリリース作業中に実際に起きたこと。

作業者は秘密ファイルを避けるため `git add -A` を使わず、パスを明示してステージしていた。それにもかかわらず、以下のコミットが作業ブランチ上に出現した。

```
10a50d2  🚨 **STOP** — このコミットには実在するAPIキーが含まれています。
         <local secrets file> | 2 ++
```

作成時刻は push の 55 秒後。devflow プラグインの `Stop` フックに登録された `auto-commit.sh` が、応答終了後に作業ツリーを `git add -A` で全ステージしてコミットしたもの。**慎重なステージは、後続のフックによって上書きされる。**

このコミットは rebase 時に気付いて除去されたため、リモートには到達していない。ただし発覚の端緒は rebase の出力を人が読んだことだけで、これは管理策ではない。

ignore されたファイルは `git add -A` から不可視になる。つまり `.gitignore` への登録は、この経路を含むすべての自動ステージを一度に塞ぐ唯一の手段。

## Why this cannot be fixed in settings.json

Claude Code の設定スキーマには、**プラグインのフックを個別に無効化するキーが存在しない**。使えるのは以下のみで、いずれも過剰。

| 設定 | 影響 |
|------|------|
| `disableAllHooks` | statusLine 含む全フック停止。`secrets-guard`（秘密ファイル読み取りの遮断）や `biome-fix` も失われる |
| `enabledPlugins` で devflow を `false` | スキル（commit-push-pr / watch / merge / release）ごと失われる |
| `allowManagedHooksOnly` | managed settings 専用。通常のリポジトリ設定からは指定できない |

`auto-commit.sh` が呼ぶ `commit-gate.sh` は Biome / tsc / test の**品質チェックのみ**で、認証情報の検査を行わない。ゲートの改修はプラグイン側（`qtmleap/claude-plugins`）の課題であり、このリポジトリからは閉じられない。

## Defense in depth

`.gitignore` が第一防御線、CI の GitGuardian が第二防御線。後者は push 後に検出するため、流出前に止められるのは前者のみ。

## Related

- リポジトリ直下の `.gitignore`
- [develop-master-divergence](../plan/develop-master-divergence.md)
