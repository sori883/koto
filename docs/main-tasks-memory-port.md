# mainへのTasks・Memory取り込み

2026-11-01。ユーザーはdevelop側の作業を保留し、mainからブランチを作って、Babelからdefaultへの整理、Tasksの枠組み、新しいMemory CLIを取り込むよう依頼した。旧orch・旧Memory CLIは置き換えるとの回答を受けた。

起点はmainの77b4d4f、取り込み元はdevelopの4bb01d1。作業ブランチはcodex/main-tasks-memory。develop全体をマージせず、機能と必要な連携だけを移植する。設計中だった複数配置の共通設定、monorepo CLI、opsflowは対象に含めない。

## 実装範囲

- cli/tasks・cli/memoryと利用スキル、テストを取り込む。ロギング、scope、競合検出、再送と復旧を維持する。
- このブランチの既存リポジトリでは、root直下のコードはdefaultに所属する。他projectの管理領域は引き続き分離する。利用形式を推測する設定や共通Coreは追加しない。
- 共通知識の配布元はspace/default、利用先は.space/default/memory。タスクとcheckpointは.space/default/tasks、.space/default/checkpoint。既存の開発リポジトリ内のBabel文書は内容を保って移す。
- setupの配布・プロジェクトコピーに独立CLIを含める。CodexのローカルCLIは.agents/cli、Claude Codeは.claude/cliとし、スキルからの相対参照を維持する。
- 旧orch・okf-agent-memoryの実装と旧コマンド資料を廃止する。旧スキル名の入口は新スキルへ案内する短い互換手順とし、既存のプロジェクトコピーを更新した際も旧手順を選ばせない。
- devlow、recall、checkpoint-safely、use-principles、知識を使う専門スキル、エージェント・指示テンプレートを現行CLIへ接続する。ソース変更前のタスク登録、原則マージ後の完了を引き継ぐ。

利用先の旧Babelや旧orch台帳を、setupが勝手に改名・変換・削除することはしない。旧知識が残る場合は検出して移行を案内し、別の空の知識領域へ黙って切り替えない。プロジェクト固有の旧状態や未完了トランザクションを保護する。mainへのマージ、リリース、Macのプラグイン更新はこの取り込みブランチの作成・検証とは別操作。

## 検証

既存リポジトリ直下のコード参照と成果物参照、他project・領域外・シンボリックリンクの拒否を先にテストで確認する。setupの初回導入・更新・既存データ保護、両製品でのプロジェクト・配布元の配置場所変更後のCLI実行、Memory利用ログ、Tasksの中断・再開・完了を検証する。型検査、全テスト、配布物の全ファイル照合を実施する。

追加確認でsetupとMemoryが同じ知識を書き込む経路を確認した。setupも`.okf-write-lock`を取得し、Memoryの未復旧トランザクションがあれば更新を止める。SIGKILL後は所有者を確認したロックの明示的な除去と、同じ版のsetup再実行で復旧する。旧Babelが残るdefaultでのMemory初期化も拒否する。

explain-before-shortenには、以前ユーザーが示した利用条件に合わせて出典を追記した。本文の手法はmainの内容を保持した。Copilotは今回選択された三項目に含まれないため、mainの既存対応を保持し、setupの回帰検証対象にも残した。

旧Babelの移動テストでは独自知識・目次の編集・操作ログが保持され、前回のハッシュから未編集と確認できる共通原則だけが更新された。Memoryとsetupの同時書き込み、旧Babelからの意図しない切り替えは修正前の失敗と修正後の成功を確認した。

最終ローカル検証：

- `bun run test`：310 tests、2,341 assertions、全件成功。
- `bun run typecheck`：成功。
- `bun run build`：386ファイルを生成。`bun run build:check`：全生成物が正本と一致。
- `git diff --check`：成功。
- 配布物をリポジトリ外で実行し、既存知識・指示・ログ・利用先package.jsonを保持。Codex・Claude Codeのプロジェクトコピーは配置元と利用先の移動後も実行できた。mainにあるCopilotの配布経路も回帰検証した。
- この検証はCLIと配布・接続手順の確認。各デスクトップのモデルによる自動選択、Macへのインストール更新、mainへの統合は含まない。
