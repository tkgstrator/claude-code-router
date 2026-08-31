# 外部公開（Cloudflare Tunnel + Access）

Rialto をトンネル越しに公開するときの設定。**`/api/*` と `/v1/*` は要件が違うので、
別々の Access アプリケーションにする**のが要点。

## なぜ2つに分けるのか

| 経路 | 呼び手 | 認証 |
|---|---|---|
| `/` `/api/*` | ブラウザの人間 | Cloudflare Access（メール等） |
| `/v1/*` | Claude Code / Codex CLI / Gemini CLI | Rialto の AccessToken **のみ** |

**`/v1/*` を Access で守ることはできない。** CLI クライアントは対話ログインができず、
サービストークン（`CF-Access-Client-Id` / `CF-Access-Client-Secret`）ヘッダも送れない。
よってこの経路はエッジを **Bypass (Everyone)** で素通りさせ、**Rialto の AccessToken が
唯一の門**になる。

ここを間違えて `/v1/*` にも Access ポリシーを掛けると、Claude Code / Codex が全滅する。

```
Access app A:  rialto.example.com/       Allow (email)      → UI + /api/*
Access app B:  rialto.example.com/v1     Bypass (Everyone)  → Rialto の AccessToken
Access app C:  rialto.example.com/health Bypass (Everyone)  → 外形監視（任意）
```

パスの深い方（`/v1`）が先に評価されるよう、アプリの順序に注意する。

`/health` は APIKEY ゲートの外にある監視用エンドポイントなので、外形監視を当てているなら
同様に Bypass しておく。覆ったままだと監視が Access のログインHTMLを掴んで常時赤になる。

## 1. Access アプリを作る

`/` 用のアプリを作り、**Application Audience (AUD) Tag** を控える。これが `ACCESS_AUD` になる。
チームドメインは `<team>.cloudflareaccess.com`。

> **Policy ID と間違えないこと。** ポリシー一覧に出る `a26eca84-65d8-4b67-...` のような
> **ハイフン区切りUUID**は Policy ID であって AUD ではない。AUD は**64桁の16進数**（ハイフン無し）で、
> ポリシーではなく**アプリケーション**に属する。Policy ID を入れると署名は通っても audience 検証で落ち、
> assertion がある以上 bootstrap にフォールバックしないので**ブラウザから締め出される**。
>
> 迷ったら、Access 経由で開いた状態で `GET /api/access-check/detect` を叩けば、
> そのリクエストの assertion から両方の値が読める。

**Destination にパスを付けないと、ホスト名全体が対象になる。** `llm.example.com` とだけ書いた
アプリは `/v1/*` も `/health` も覆う。次節の Bypass アプリを必ず併せて作ること。

## 2. Rialto に渡す

```
ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com
ACCESS_AUD=<AUD tag>
```

**両方揃って初めて有効になる。** 片方だけでは Access 検証は一切行われない — 署名だけ検証して
audience を見ないと、**同じチームの別アプリのトークンで入れてしまう**ため、意図的に
「半端な設定は無効」にしてある。

設定後 `GET /api/identity` の `accessConfigured` が `true` になり、`mode` が
`cloudflare_access`、`email` に検証済みのアドレスが入る。ここが `token` のままなら
Access は効いていない。

## 3. `/v1/*` 用のトークンを発行する

Settings → Access で発行する。**平文は発行時の1回しか表示されない**（保存しているのは
sha256 のみ）。失くしたら再発行するしかない。

クライアント側:

```bash
export ANTHROPIC_BASE_URL=https://rialto.example.com
export ANTHROPIC_AUTH_TOKEN=rialto_xxxxxxxx
```

UI がまだ無い / 締め出された場合は API から直接発行できる（`APIKEY` は `/api/*` では有効）:

```bash
curl -s -X POST https://rialto.example.com/api/access-tokens \
  -H "X-API-Key: $APIKEY" -H 'content-type: application/json' \
  -d '{"name":"claude-code"}' | jq -r .plaintext
```

トークンには **面**（どのエンドポイントを叩けるか）と **ルーティングプロファイル**を
紐づけられる。CI のトークンだけ `cost-first` に固定する、といった運用ができる。

## 4. オリジンを直接叩けなくする

**Access はエッジでしか効かない。** オリジン（このプロセス）に直接到達できる経路が残っていると、
`Cf-Access-Jwt-Assertion` ヘッダを偽造されても検証は通らないものの、`/api/*` は
bootstrap token だけが門になる。cloudflared 経由のみで到達するようにし、
`HOST` を loopback に寄せるか、ファイアウォールで塞ぐ。

## bootstrap token の適用範囲

envelope の `APIKEY` が効くのは **`/api/*` だけ**。`/v1/*` では受理されない。

`/v1/*` はエッジで Bypass にする以上、このミドルウェアが通すものが
**課金経路の前に立つ唯一の門**になる。そこにマスターキーを残すと、
「失効させると全クライアントが同時に切れる」「どのクライアントが焼いたか分からない」
という、発行済みトークンを導入した理由そのものが復活する。よって `/v1/*` は
**発行済み AccessToken のみ**。

結果として、**トークンを1本も発行していないインストールは `/v1/*` を通せない**。
これは意図した形で、「管理キーを持っている者なら誰でも通れる」より
「誰が呼んでよいかを決めるまで閉じている」を選んでいる。

`/api/*` に `APIKEY` を残しているのは**復旧経路**のため:

- Access 側の障害で管理UIから締め出される
- Postgres が落ちて AccessToken を引けない（＝UIからトークンを発行できない）

公開運用では `APIKEY` を強い値にし、配らないこと。クライアントに配るのは
発行したトークン、`APIKEY` は手元に置く。

## 現状の制限

- `GET /api/config` は `APIKEY` を平文で返す。Access で守られた管理者しか到達できない前提。
- Access のグループ／ポリシー一覧の表示は未実装（Zero Trust API 連携が必要）。
- `APIKEY` のローテーション用エンドポイントは無い。config を書き換えて再起動する。
