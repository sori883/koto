# OKF Agent Memoryの参照元・移植差分・開発時の検証

この文書は構成整理前の開発・検証記録です。現在の配布構成は[現状資料](../../current-state.md)を参照してください。

この文書は開発者向けの保守資料であり、スキルの配布対象に含めない。利用者向けの操作説明は `skills/okf-agent-memory/` に置き、参照元との比較・移植判断・開発時の検証記録はこの文書で管理する。

確認日：2026-09-20

このスキルは [okf-memory/okf-agent-memoryのSKILL.md](https://github.com/okf-memory/okf-agent-memory/blob/main/.agents/skills/okf-memory/SKILL.md) と補助資料を基に、日本語で記述したもの。行動契約、専用ツールでの検索と保存、知識の見直し、検証を完了条件とする運用を引き継ぐ。

参照コミットは `9413d7780714165dcb8e82fff73b9f966feb653a`。確認時点の `main` と `develop` はこのコミットを指していた。保守時はブランチ名だけでなく、以下の固定リンクと比較する。

| 参照ファイル | 取り入れた内容 |
| --- | --- |
| [SKILL.md](https://github.com/okf-memory/okf-agent-memory/blob/9413d7780714165dcb8e82fff73b9f966feb653a/.agents/skills/okf-memory/SKILL.md) | 事実整合性・ドメイン中立性・決定性、Mermaid限定、検索してから行動する、governanceを確認する、人間の検証を捏造しない |
| [discovery.md](https://github.com/okf-memory/okf-agent-memory/blob/9413d7780714165dcb8e82fff73b9f966feb653a/.agents/skills/okf-memory/discovery.md) | 説明から候補を絞り、必要な本文・関連文書だけ読む |
| [remember.md](https://github.com/okf-memory/okf-agent-memory/blob/9413d7780714165dcb8e82fff73b9f966feb653a/.agents/skills/okf-memory/remember.md) | 将来の価値で記録を選び、根拠と不確実性を保持する |
| [update.md](https://github.com/okf-memory/okf-agent-memory/blob/9413d7780714165dcb8e82fff73b9f966feb653a/.agents/skills/okf-memory/update.md) | 重複作成より更新を優先し、訂正と有用な経緯を残す |
| [relationships.md](https://github.com/okf-memory/okf-agent-memory/blob/9413d7780714165dcb8e82fff73b9f966feb653a/.agents/skills/okf-memory/relationships.md) | 意味のある単位を保ち、説明付きのリンクで関連付ける |
| [examples.md](https://github.com/okf-memory/okf-agent-memory/blob/9413d7780714165dcb8e82fff73b9f966feb653a/.agents/skills/okf-memory/examples.md) | 検索から保存・関連付け・検証までの一連の操作 |
| [Convention v0.1](https://github.com/okf-memory/okf-agent-memory/blob/9413d7780714165dcb8e82fff73b9f966feb653a/docs/spec/CONVENTION.md) | 知識のライフサイクルと、判断を担うエージェント・形式処理を担うツールの責務 |
| [CLI実装](https://github.com/okf-memory/okf-agent-memory/blob/9413d7780714165dcb8e82fff73b9f966feb653a/cmd/okf/main.go) | `search` / `show` / `create` / `update` / `relate` / `validate` の呼び出し形式 |

## このプロジェクトに合わせた点

- Goの `okf` コマンドを、スキルに同梱する `scripts/okf.ts` のBun実行に置き換える。ユーザーの指定によりCLIのみを使用し、元スキルのMCP優先は採用しない。MCPサーバーは実装・提供の対象に含めない。
- 保存先を `knowledge/` から `.space/babel/` に変更し、合意済みの5種類のtypeとディレクトリを使う。
- frontmatterは、プロジェクトで決めた `type`・`title`・`description` 必須、3種類のstatus、タイムゾーン付き日時、マッピング配列のsourcesに揃える。元の補助資料にある `status: active` や文字列配列のsourcesなどをそのまま移さない。
- AAGの省略記法を日本語の文章に置き換える。事実整合性・ドメイン中立性・厳密な決定性の目標と、図をMermaidに限定する規則はスキル本体に保持する。
- 元スキルと同様に専用ツールで読み書きする。CLIが失敗した場合に、直接編集や手動確認を成功の代替にしない。
- `hold` は対象操作に適用する。ユーザーが当該保留を踏まえて既に承認した操作について、同じ確認を繰り返さない。
- frontmatterの詳細を参照資料へ分離し、作業別資料は元の検索・保存判断・更新・関連付け・操作例の役割に対応させる。
- `validate --strict --drift` のエラー・警告0件を完了条件として維持する。人間による内容確認とは区別し、通過のために `verified` を捏造しない。

## Bun CLIの移植範囲

CLI 0.1.0は上記コミットの `pkg/okf/{parser,bundle,search,mutate,validator}.go` と `cmd/okf/main.go` を参照した。対象は `init`・`search`・`show`・`create`・`update`・`relate`・`validate`・help/version。MCP、hub、bootstrap、agentsコマンドは対象外。

ユーザーの追加依頼に基づき、Bun版には独自の `delete` コマンドも実装する。

| 項目 | 継承・差分 |
| --- | --- |
| 引数 | concept IDとbundleの位置引数、`--desc`・`--actor`・`--body`・`--json`などを継承 |
| 話題検索 | MiniSearch 7.2.0のBM25+に置換。Intl.Segmenterによる日本語の単語分割、NFKC・小文字化、共通する助詞の除外を追加。前方一致、OR検索、title 4 / tags 3.5 / description 2.5 / ID 2 / body 1の重み、2桁への丸め、同点時のID順を維持。従来の式とbodyの頻度上限5は廃止し、スコア・順位・日本語の一致結果は意図的な差分とする |
| パス検索 | `hold > constraint > context`、パス一致後に検索語のスコアを加算。語に一致しなくても保留文書を除外しない。数値指定時の上限100件を継承し、`--all` で全件取得可能 |
| type検索 | `search --type` を独自に追加。5種類のfrontmatter値で件数制限の前に絞る。検索語なしではgovernance優先・ID順で列挙し、検索語やパスとの併用も可能。ルール・原則は `--all` で全件のdescriptionを確認して該当するIDの `show` へ進む |
| Goとの相互運用 | Goが作成した文書をBunで更新しGoで表示、その逆、関連付けとstrict/drift検証を実行する比較テストを用意。検索はASCII語の候補・一致項目・入出リンクを比較し、意図的に変えたスコア・順位・日本語の分割は独自の回帰テストで検証する |
| 保存先・型 | `.space/babel` と5種類のtypeへ変更。typeに対応するディレクトリ内に保存。title・descriptionも必須 |
| 入力の拡張 | `--metadata-file`・`--body-file`・`--unset`・`--sync` を追加。`--status`・`--tags`・`--type` はupdateでも動作する。本家のupdateはhelpと実装で対応フラグに差がある |
| メタデータ | 人間のverified、タイムゾーン付き日時、sourcesなどは合意済みプロファイルに従う。governance省略時はtypeにかかわらずcontext |
| 検証 | Bun版のstrictは警告も不合格。本家は通常の警告・driftだけではstrictが失敗しない。Bun版はglobのcode_refsも実在確認する |
| 表示 | 空の検索結果は本家のnullではなく `[]`。showのJSONにも入出リンクを追加。本文の空白・改行を保持 |
| 保存 | 未知の項目を保持。同一内容のupdateでは日時・履歴を変更しない。親の目次を祖先へたどって同期する |
| 削除 | `delete` で文書、入出リンク、目次を整理し、削除日時・実行者・対象・更新した文書をログに記録する。文章中のリンクは表示文字を保持し、過去の履歴はID付きの文字列として残す。`--dry-run` で変更対象と新たな孤立文書を取得できる |
| bundleの境界 | `vendor/` は独立bundleとして検索。配下のシンボリックリンクは拒否。操作中の排他とファイル単位の置換を行い、部分失敗を報告 |
| YAML・Markdown | Bun.YAMLを使用するため重複キーの扱いはGoと異なる。リンク解析の対象や保存時の整形は [CLIの詳細](https://github.com/sori883/koto/blob/77b4d4f87a4c575ccb4b243f2a62acd17cd446a2/skills/okf-agent-memory/references/cli.md) を参照 |

全コマンド・すべてのYAML/Markdown入力について本家と完全互換であることを保証するものではない。合意済みプロファイルと上表の差分を、この移植の契約とする。

## 開発時の検証

リポジトリルートで実行する。通常のテストはローカルの一時ディレクトリを使い、Goを必要としない。初回の依存導入とbootstrap試験には、ネットワークまたはBunキャッシュが必要になる。

2026-09-23に依存を`skills/okf-agent-memory/scripts/package.json`と同じ場所のbun.lockへ移した。ルートworkspaceは使わない。先にルートで`bun install --frozen-lockfile --ignore-scripts`を実行し、`bun skills/okf-agent-memory/scripts/okf.ts version --json`でスキル内の依存を用意してから、型検査とテストを実行する。MiniSearchは型定義を同梱する。初回・更新・同時起動・失敗時の検証は[依存移行記録](runtime-migration.md)に記載する。

```sh
bun run test
bun run typecheck
```

実際のGoバイナリとの比較は任意で、指定しない場合は比較テスト2件だけがskipになる。参照コードを作業リポジトリ外へcloneし、固定コミットからビルドする。

```sh
git clone https://github.com/okf-memory/okf-agent-memory.git /tmp/okf-agent-memory-reference
git -C /tmp/okf-agent-memory-reference checkout --detach 9413d7780714165dcb8e82fff73b9f966feb653a
# 参照リポジトリ内で実行
go test ./pkg/okf ./cmd/okf
go build -o /tmp/okf-reference ./cmd/okf
# このリポジトリのルートへ戻って実行
OKF_REFERENCE_BIN=/tmp/okf-reference bun run test
```

2026-09-20の実装では、各機能のテストを先に書き、以下の失敗を実行確認してから実装した。

| 段階 | 実装前に確認した失敗 | 実装後の対象テスト |
| --- | --- | --- |
| 文書 | `document.ts` 未実装のimport失敗 | 17件成功 |
| 保存・関連付け | `bundle.ts` 未実装のimport失敗 | 13件成功 |
| 検索 | `search.ts` 未実装のimport失敗 | 12件成功 |
| 検証 | `validate.ts` 未実装のimport失敗 | 7件成功 |
| CLI | CLI起動テスト12件失敗。その後 `--unset` が項目を消さない失敗も確認 | 12件成功 |
| 復旧・関連節 | HTMLコメントの後で関連リンクが節外へ入る、syncで目次が復旧しない | 追加2件成功 |
| 部分失敗 | 実際のディレクトリ権限エラーで、書き込み済みファイルが返らない | 追加1件成功 |

これにGoとの比較テスト2件を加えて検証する。部分失敗の権限テストはPOSIXの一般ユーザー向けであり、Windowsとroot実行ではskipする。

配布物には`SKILL.md`・利用者向けの`references/`・依存定義とlockを含む`scripts/`・`LICENSE`を含め、開発用の`tests/`と本書を含めない。配布先のCLI起動時にbootstrapが固定依存をscripts内へ導入する。原著の著作権・利用条件はスキルに同梱する [LICENSE](https://github.com/sori883/koto/blob/77b4d4f87a4c575ccb4b243f2a62acd17cd446a2/skills/okf-agent-memory/LICENSE) に保持している。MiniSearchのMITライセンスはインストールされるパッケージに同梱される。

### 日本語検索・MiniSearchへの移行

2026-09-20に日本語検索をテストから追加。「ルール」の検索漏れ、全角英字・半角カナの不一致、否定語の検索漏れ、文書長を考慮しない順位、CLIでの検索漏れの5件が実装前に失敗することを確認した。否定語は分割結果に従い、「しない」と「ない」をそれぞれ含む文書で除外されないことを検証する。

MiniSearch導入後は日本語5項目検索・日英混在・NFKC正規化・助詞除外・BM25の文書長補正・タイトル優先・上限・保留優先・直接編集の反映を検証。Bunの自動インストールを無効化した配布テストで依存不足の失敗も確認し、依存を含めた配布先で検索まで実行するテストに更新した。

最終確認は本家Goとの比較を含む73テスト成功、`bun run typecheck` 成功。別の一時ディレクトリで配布用 `package.json` から実際にインストールし、自動インストールを無効化した状態でも文書作成と日本語検索が成功した。

### typeによる検索・ルール取得

2026-09-20に `search --type` を追加。typeの絞り込み・検索語なしの列挙・件数上限・CLI・配布先でのtype検索について、実装前に7テストの失敗を確認した。実装後は5種類のtype、frontmatterとの完全一致、100件を超える候補からの絞り込み、既存の関連度とパス検索の保留優先、無効値、既定・指定bundleを検証した。

通常テストは80件成功、Go参照バイナリ未指定の比較2件はskip。`bun run typecheck` も成功した。配布用AGENTS.mdと運用スキルのルール取得を `search --type rule --limit 100` → 検索結果のIDを `show` に渡す手順に揃えた。

### 全件のdescriptionから本文を選択

同日の追加指示により、件数制限を外す `search --all` を追加した。数値の `--limit` は既存の上限100件を維持し、`--all` との併用を引数エラーにする。実装前に全件取得・CLI・配布先実行の3テストの失敗を確認し、実装後に105件・125件の候補で検索結果のdescriptionを保持することを確認した。通常テスト82件成功、Go比較2件skip、型チェック成功。

配布用の手順は、ルールと原則をそれぞれtypeで全件検索し、descriptionから合致する文書と適用判断が曖昧な文書を選んで `show` する形に変更した。23原則の `type: principle` は維持し、各descriptionに適用場面を明記した。検索語や検索順位で最初の候補を狭めない。

### 文書・関連リンク・目次の削除

同日の追加指示により `delete <concept-id> [bundle]` と `--dry-run` を追加した。実装前にdeleteの未実装によるCLIテストの失敗を確認し、文書の削除、入出リンクの解除、目次整理、履歴の保持と削除イベント記録を実装した。通常の文章はリンクの表示文字を残し、CLIの関連一覧と目次の単独項目を除去する。リンク解析では、削除時に原文の位置を維持するため、HTMLコメントやインラインコードのマスクを位置保存に揃え、エスケープされたリンクと複数バッククォートのコード例を除外した。

空振りの再実行、dry-runの無変更、独自メタデータと過去のverifiedの保持、CRLF・コード例・外部リンクの保持、パスとロックの検証、解析不能な参照元、シンボリックリンク、削除前の内容照合、権限エラー時の部分失敗を検証した。配布先のコピーでも、Bunの自動インストールを無効化して削除とstrict/drift検証が成功した。

通常テスト94件成功、Go参照バイナリ未指定の比較2件はskip。型チェックとスキル形式検証も成功した。複数ファイル全体の自動巻き戻しは導入せず、既存の部分失敗契約に従って削除済みパスも `written_paths` に含める。削除成功のイベントは対象ファイルの削除後に記録する。
