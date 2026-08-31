# UI mocks

Rialto の新UIの静的モック。**実装前の人間レビュー用**で、承認後はReact実装のターゲットになる。

計画上の位置づけは `docs/plan/rialto/master-plan.md` §5 Phase 5。

## 見る

```bash
bun run mocks:serve
```

→ http://localhost:16176/mocks/index.html

CSSのビルドとファイル監視込みなので、これ1つでよい。モックを編集すると自動で再ビルドされる
（ブラウザはリロードする）。ポートは `--port` か `MOCKS_PORT` で変えられる。

アプリの dev サーバー（:16175）とは別プロセス。あちらには一切触らない。

**サーバーを使わない場合**: `bun run mocks:css` のあと `mocks/index.html` を直接開く。
`file://` で完結し、CDN も不要。サーバー経由とレンダリングは**ピクセル単位で同一**であることを
`mocks:diff` で確認済み。スクリーンショット撮影が `file://` を使うのはこのため（サーバー不要で
CI でも動く）。

### テーマ

- 初期値は**OSの設定**（`prefers-color-scheme`）に従う
- `index.html` 上部のボタン、または各画面のサイドバー下部の **Theme** で切り替えられる
- 選択は `localStorage`（`rialto-mock-theme`）に保存され、**全画面に引き継がれる**
- `shell.js` を `<head>` から読んでいるので、ページ遷移時に light がちらつかない

スクリーンショット撮影には影響しない。`shell.js` は読み込み時に storage を**読むだけ**で、
書き込むのはユーザーが明示的に切り替えたときのみ。撮影はテーマごとに新しいブラウザコンテキスト
（storage は空）を開き、`shoot.ts` が読み込み後にクラスを明示指定するので、常に決定的になる。

### サーバーの公開範囲

リポジトリルートを起点にしているが、配信するのは以下の3つのプレフィックスだけで、それ以外は
404 になる。`.env` などのルート直下のファイルやソースツリーは配信されない。

```
mocks/
node_modules/@fontsource-variable/
node_modules/remixicon/
```

## なぜモックが実装ターゲットになるか

`_shared/mock.css` はプロジェクト本体と**同じ Tailwind**（`@tailwindcss/node` + oxide スキャナ）でコンパイルされ、
`src/index.css` の `:root` / `.dark` トークンブロックを**逐語コピー**している。ずれた状態でビルド
しようとすると `mocks:css` が失敗する。フォント（Inter / Geist Mono）とアイコン（Remix Icon）も
`node_modules` から同じ実体を読む。

したがってモックと React 実装のスクリーンショットに差が出たら、それはツールチェーンの差ではなく
**デザインの差**である。この前提の上で `ui-mock-diff` スキルが差分を測る。

## 画面

既存の22ルート + ダイアログ群を、5つのトップレベル画面に集約する（Login は Cloudflare Access に置換のため削除）。下表の「統合元」が空でない
ものは、既存コンポーネントを吸収したビュー。

### Top level

| ファイル | ビュー | 統合元 |
|---|---|---|
| `overview.html` | Overview | 新規 |

### Routing

| ファイル | ビュー | 統合元 |
|---|---|---|
| `routing.html` | Chain | RouterPreferences / TierEditor / RouterUtilization |
| `routing-passthrough.html` | Chain (passthrough) | — |
| `routing-map.html` | Map | RoutingLibrary / RoutingLiveEditor / RoutingPresetEditor |
| `routing-rules.html` | Rules | routing-map/RuleEditor |

### Providers

| ファイル | ビュー | 統合元 |
|---|---|---|
| `providers.html` | Subscription | Providers / Subscriptions / ModelsDashboard / Transformers / catalog |
| `providers-apikey.html` | API key | EditProviderDialog / ApiKeyModelsSection |
| `providers-connect.html` | Add provider | ConnectChoiceDialog / ProviderConnectFlow / ImportCredentialsDialog / ManualCallbackDialog / ManageProvidersDialog |

### Activity

| ファイル | ビュー | 統合元 |
|---|---|---|
| `activity.html` | Sessions | Sessions / Usage / ApiCost |
| `activity-requests.html` | Requests | RequestHistoryDrawer / usage/ModelRoutingSection |
| `activity-session.html` | Session detail | SessionDetail |
| `activity-logs.html` | Logs | LogViewer / LogFileList / Breadcrumbs / RequestGroupList / LogEditor |

### Settings

| ファイル | ビュー | 統合元 |
|---|---|---|
| `settings.html` | Server | SettingsPage |
| `settings-access.html` | Access | 新規（Phase 3.5） |
| `settings-logging.html` | Logging | SettingsPage の一部 |
| `settings-personas.html` | Personas | Personas / PersonaView / PersonaEdit |
| `settings-statusline.html` | Status line | StatusLineConfigDialog + 6コンポーネント |
| `settings-presets.html` | Presets | Presets + 6ダイアログ |
| `settings-advanced.html` | Advanced | DebugPage / JsonEditor |

### System（アプリシェル無し）

ログイン画面は無い。管理UIは **Cloudflare Access** がエッジで認証するので、アプリはフォームを
描画しない（計画書 §Phase 3.5）。

| ファイル | ビュー | 統合元 |
|---|---|---|
| `setup.html` | First run | SetupDialog |
| `system-states.html` | System states | OauthResultPage / ErrorPage / Login |

`routing.html` と `routing-passthrough.html` が今回のリファクタの核心。最上位の軸が
**inbound面**（`/v1/messages` / `/v1/chat/completions` / `/v1/responses` / `/v1beta/models/*`）
になっていて、面ごとに routed / passthrough を切り替えられる。現状のコードはこの切り替えが
`scenario-router.ts:117-128` にハードコードされていて、UIからは見えない。

## 構成

```
mocks/
  index.html              レビュー用の入口
  <screen>.html           各画面。file:// で直接開ける
  mocks.json              画面レジストリ（モックファイル ↔ Reactルート）
  _shared/
    shell.js              サイドバー/ヘッダーと共通プリミティブ（classicスクリプト）
    mock.css              Tailwindエントリ。トークンは src/index.css のコピー
    mock.build.css        生成物。手で触らない
  .shots/                 スクショ・差分・report.json（生成物）

scripts/
  build-mock-css.ts       bun run mocks:css
  serve-mocks.ts          bun run mocks:serve
```

`shell.js` が ES module ではなく classic script なのは、`file://` の Chrome が
origin `null` からの module import をCORSで弾くため。すべて `window.Shell` にぶら下げている。

## 実装フェーズでの使い方

`mocks.json` の `route` を `null` から実際のReactルートに変えてから:

```bash
bun run mocks:shoot     # 両サイドをRetina(=@2x)で撮影
bun run mocks:diff      # ピクセル差分 + report.json
```

詳細は `.claude/skills/ui-mock-diff/SKILL.md`。

## 制約

- データはすべてダミー。ボタン・フォームは動かない
- **画面間の遷移は動く** — サイドバー、設定レール、タブのリンクは実際に張ってある。テーマ切り替えも動く
- レスポンシブは未検討。1440×900 固定で設計している
- i18n未適用（英語ハードコード）。キー再編は実装フェーズで行う
