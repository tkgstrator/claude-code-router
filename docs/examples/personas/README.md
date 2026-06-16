# Persona Examples

CCR の `Personas` ライブラリに貼り付けて使える、参考実装のサンプルプロンプト集。
authoring の方法論は `docs/guides/persona-authoring.md` を参照。

## 一覧

| ファイル | キャラ | 出典 | ライセンス |
|----------|--------|------|------------|
| [`yachiyo.txt`](./yachiyo.txt) | 月見ヤチヨ (「超かぐや姫！」) | [tsukumijima/YacchoGPT](https://github.com/tsukumijima/YacchoGPT) | CC0-1.0 |

## 使い方

1. ファイルの**本文をそのまま**コピーする。
2. CCR の Web UI で `/personas/new` を開く。
3. `Name` に任意の表示名 (例: `月見ヤチヨ`) を入れ、`Prompt` 欄に貼り付けて保存。
4. `Router` ページでこのペルソナをアクティブに切り替えれば、`background` 以外の全シナリオで自動的に挿入される。

CCR は persona を `cache_control` を持つ system ブロックの**内側**に append するため、
400 行クラスの長文プロンプトでも prompt cache が効く限り 2 回目以降の runtime コストはほぼゼロ。
詳細は authoring guide の「CCR 固有の事項」セクションを参照。

## ファイルの中身について

各 `.txt` ファイルは**本文だけ**を含む。出典・ライセンス情報は本ファイルにまとめてあり、
プロンプト本文に混ぜていない。これは、ファイルの中身をそのまま system prompt として
モデルに渡せるようにするため (メタ情報を混ぜるとモデルがそれも文脈として解釈してしまう)。

## ライセンス遵守

- `yachiyo.txt` は [tsukumijima/YacchoGPT](https://github.com/tsukumijima/YacchoGPT) の `ヤッチョGPT (for Claude).md` を CC0-1.0 のもとで再配布したもの。**改変自由・出典表記不要**だが、上記の通り経緯としては明記してある。
- 二次配布や改変版を公開する際は、それぞれの作品/キャラクター原典 (「超かぐや姫！」など) の権利関係に各自留意すること。

## 新しいサンプルの追加

サンプルを追加するときは:
1. 出典のライセンスが商用利用・再配布を許容するか必ず確認する (CC0 / MIT 等)。
2. ファイル本文には**プロンプト本文だけ**を含める。
3. このディレクトリの一覧表に行を追加する。
4. ライセンスが要求する形式の出典表記を一覧表に明記する。
