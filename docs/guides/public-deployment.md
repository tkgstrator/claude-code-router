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

### Allow (Everyone) と Bypass は別物

| | Everyone + Allow | Bypass |
|---|---|---|
| ログイン画面 | **出る** | 出ない |
| IdP 認証 | **必要** | 不要 |
| `Cf-Access-Jwt-Assertion` | 注入される | されない |

**「Everyone」は「誰でも通す」ではなく「認証さえ済めば誰でも許可する」。** 認証自体は必須のまま
なので、`/v1` を Everyone + Allow にすると CLI はログイン画面にリダイレクトされて詰む。
ここは Bypass でなければならない。

逆に UI 側（`/`）を Bypass にすると assertion が注入されなくなり、Rialto から見て
「Access が居ない」状態になって `APIKEY` 頼み（未設定ならローカル免除頼み）に落ちる。

Bypass の条件は Everyone でなくてもよい。クライアントの出口IPが固定なら送信元IPで絞れる。
変動するなら Everyone とし、防御は Rialto の発行済みトークン（個別失効・面スコープ）に委ねる。

## 1. Access アプリを作る

`/` 用のアプリを作り、**Application Audience (AUD) Tag** を控える。これが `ACCESS_AUD` になる。
チームドメインは `<team>.cloudflareaccess.com`。

> **Policy ID と間違えないこと。** ポリシー一覧に出る `a26eca84-65d8-4b67-...` のような
> **ハイフン区切りUUID**は Policy ID であって AUD ではない。AUD は**64桁の16進数**（ハイフン無し）で、
> ポリシーではなく**アプリケーション**に属する。Policy ID を入れると署名は通っても audience 検証で落ち、
> assertion がある以上 `APIKEY` にフォールバックしないので**ブラウザから締め出される**。
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
`APIKEY` だけが門になる。cloudflared 経由のみで到達するようにし、
`HOST` を loopback に寄せるか、ファイアウォールで塞ぐ。

## ローカル免除は「peer が loopback か」では判定していない

`/api/*` の管理ゲートには、**Rialto が動いているマシン上のブラウザを免除する**経路がある
（`src/api/local-access.ts`）。自分のノート PC に自分でトークンを打たせる意味が無いためだが、
この判定は**この構成でこそ壊れやすい**: cloudflared は同じホストで動いて 127.0.0.1 に
プロキシするので、トンネルを立てた瞬間、公開インターネットからの**あらゆる**リクエストが
loopback から到着する。peer アドレスだけを信じる実装は、トンネルを設定した時点で管理 API を
世界に公開してしまう。

そのため 2 つの signal を **AND** で要求している:

| signal | 内容 |
|---|---|
| `Host` がループバック名 | マシン上のブラウザは `localhost:16175` を送る。トンネル経由のリクエストは cloudflared が公開ホスト名を保つので一致しない |
| 転送ヘッダが 1 つも無い | `cf-connecting-ip` / `cf-ray` / `cf-access-jwt-assertion` / `x-forwarded-*` / `x-real-ip` / `forwarded` のいずれかがあれば、そのリクエストはこのマシン発ではない |

免除を完全に切りたい場合は `RIALTO_TRUST_LOCAL=false`（プロセス環境変数。config envelope の
キーではない）。ローカルでも必ず資格情報を要求するようになる。

この判定が**防いでいないもの**: そのポートに TCP 接続を張り、任意のヘッダを立てられる何か。
loopback 上ではそれはマシン上のプロセスであり、設定ファイルを読んでトークンを取れる。
マシン外からなら、それはオリジンに直接到達できているということ — 本節が「やるな」と言っている
状態そのもので、ヘッダ検査では直せない。

## `APIKEY` の適用範囲

envelope の `APIKEY` が効くのは **`/api/*` だけ**。`/v1/*` では受理されない。

**新規インストールでは生成されない。** 以前は初回起動時に自動生成していたが、それは
「Access を迂回できるマスターキーが、config.json・バックアップ・シェル履歴のどこかに必ず
存在する」状態を全インストールに配ることを意味していた。いまは誰も必要としていない —
このマシン上のブラウザは免除され、リモートの管理アクセスは Access を通り、`/v1` は発行済み
トークンだけを受ける。手で設定することは引き続きできる。**マスターキーを持たされること**と
**持つことを自分で選ぶこと**は別の判断である。

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
- `APIKEY` 専用のローテーションエンドポイントは無い。Settings 経由（`POST /api/config`）か
  `config.json` の書き換えで変える。**新しい値を入れる分には再起動は要らない** —
  保存後に `applyEnvelopeToEnv` が `process.env` へ即時反映する。ただし
  `applyEnvelopeToEnv` は空の値をスキップするので、`APIKEY` を**消す**方向の変更だけは
  プロセス再起動まで効かない。
