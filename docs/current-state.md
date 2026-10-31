# kotoの現状

2026-11-01、developへ統合する開発内容を対象とする。対応先はCodexとClaude Codeの2製品。旧スキルと付属CLIを削除した後、ユーザーの依頼により、現在のkotoリポジトリ内に`@koto/monorepo`、続いて`@koto/tasks`・`@koto/memory`を実装した。さらにMITライセンスでの再利用を了承された5スキルを、3つのCLIに接続して追加した。

## 現在の構成

| 構成物 | 状態 |
| --- | --- |
| `cli/monorepo/` | Bunで動く独立したCLI。実行名は`koto-monorepo`、外部ライブラリ依存なし |
| `skills/monorepo/` | CLIを使うAI向けの利用手順。処理はCLIへ委ねる |
| `cli/tasks/` | Bunで動く独立したTasks CLI。実行名は`koto-tasks`、外部実行時ライブラリ依存なし |
| `skills/tasks/` | タスク・依存・成果物・引き継ぎを記録するAI向け手順 |
| `cli/memory/` | OKF v0.2を扱う独立したBun CLI。実行名は`koto-memory`、外部実行時ライブラリ依存なし |
| `skills/memory/` | 知識の検索・記録・更新・検証にCLIを使うAI向け手順 |
| `skills/devlow/`・`skills/recall/` | 3つのCLIを使う開発フローと、記録・実態の照合による現在地の復元 |
| `skills/tdd/`・`skills/blast-radius/`・`skills/interrogate/` | 不具合の再現と修正、影響調査、独立レビューの専門手順 |
| `templates/AGENTS.md` | コード変更前のTasks登録と現在のスキルへ案内する指示。monorepoのinstructions操作で利用先へ適用 |
| `packaging/codex/`・`packaging/claude-code/` | 製品別のプラグイン定義とカタログ定義 |
| `space/default/` | 共通知識の正本。既存の23原則を保持 |
| `scripts/build.ts` | 2製品の配布物とカタログを生成・照合 |
| `dist/codex/koto/`・`dist/claude-code/koto/` | CLI・スキル・共通知識・製品別プラグイン定義のコピー |
| `.agents/plugins/marketplace.json`・`.claude-plugin/marketplace.json` | 各製品の配布物を参照するカタログ |
| `tests/monorepo/` | 実際のローカルGitとCLI子プロセスによる操作・保護条件の検証 |
| `tests/tasks/` | タスク操作、競合、再送、依存の失効、記録の保持と保存失敗の検証 |
| `tests/memory/` | 語句検索、属性、Markdown、プロジェクト境界、排他、復旧、JSON入力と競合を検証 |
| `tests/distribution/` | 生成、参照切れ、生成物照合、スキルなし構成、開発環境外でのCLI起動、MIT表示の保持を検証 |

## monorepo CLI

setup、プロジェクト追加・参照、リポジトリ登録・取得・参照・同期・登録解除、複数リポジトリのWorktree作成・参照・片付け、status・doctorを実装した。CLIは人間からも直接実行でき、非対話実行とJSON入出力に対応する。

管理情報は`.space/monorepo.json`と`.space/<project>/monorepo.json`に保存する。Bare Repositoryは`repositories/<project>/<repo>.git/`、編集場所は`workspaces/<project>/<task>/<repo>/`へ置く。プロジェクト省略時はdefault。不明な対象への自動切り替えや、プロジェクト間でのGit保存領域の共有は行わない。

リポジトリ削除は登録解除で、Gitデータは保持する。作成途中を含む作業環境があれば登録解除を拒否する。同じ入力での再実行では作成済みの作業場所と編集を維持する。

片付けは`workspace remove <task> [--dry-run]`で行う。未保存・未追跡・無視対象のファイル、未送信コミット、ロックやGitの作業中状態等を検査し、通常のGitで削除する。ブランチと履歴は残し、途中失敗後は削除記録と実体を照合して再開する。[片付けの設計と検証](monorepo-cleanup-design.md)を参照する。

追加依頼により、`instructions plan|apply|status`でAGENTS.md・CLAUDE.mdの管理ブロックを追加・更新できる。root・project・対象ディレクトリ・製品を指定し、既存文章と独自編集を保護する。旧setupの一致する配置記録を引き継ぎ、途中失敗後も同じ操作で再実行できる。[指示更新の設計](instruction-setup-design.md)を参照する。

指示更新専用12テストと両製品の配布物だけによる実行で、更新・旧形式の移行・途中失敗後の再実行・既存編集と境界の保護を確認した。今回の配布物は192ファイル。型検査と生成物照合も成功した。

実装コミットa7d8c3dの[GitHub Linux CI](https://github.com/sori883/koto/actions/runs/41221775333)では、Bun 1.4.2で全275テスト・1914 assertions、型検査、全生成物照合が成功した。

プロジェクト削除、利用先への共通知識の配置は未実装。専用エージェント・旧setupマニフェスト・今回追加した5つ以外の旧スキルは復元していない。[機能一覧](workspace-feature-inventory.md)の全項目が実装済みという意味ではない。[初版設計](monorepo-cli-design.md)と[CLI手順](../cli/monorepo/README.md)を参照する。

## Tasks CLI

タスクの作成・一覧・詳細・更新、着手・待ち・中断・完了・中止・新しい試行への再開、同一プロジェクト内の依存、作業場所と成果物への参照、チェックポイント、履歴・状態・整合性確認を実装した。CLIだけでも実行でき、monorepoやGitの導入は必要ない。

正本は`.space/<project>/tasks/state.json`。操作IDと当時の応答を一緒に保存して二重更新を防ぎ、versionで古い判断による上書きを拒否する。依存先の版を開始時に固定し、先行タスクのやり直しや推移的な依存の失効を後続の開始・再開・完了へ反映する。

チェックポイントは正本のスナップショットを`.space/<project>/checkpoint/<task>/<id>.json`へ出力する。出力だけ失敗した場合は保存済みであることを返し、同じ操作の再送で完了できる。成果物や作業場所は参照を記録するもので、ファイルの保存・検証・Git操作は行わない。詳細は[Tasksの設計と検証](tasks-cli-design.md)と[利用手順](../cli/tasks/README.md)を参照する。

## Memory CLI

初期化、5分類の知識の保存・詳細・語句検索・属性フィルタ・コード参照検索、更新・関連付け・削除の事前確認と実行、形式・リンク・目次・期限の検証、中断した書き込みの復旧を実装した。YAML frontmatter付きMarkdownを正本とし、既存の任意属性や人間の確認記録を保持する。

保存先は`.space/<project>/memory/`。書き込みの排他、内容ハッシュによる競合検出、各ファイルの置換、複数ファイルの更新予定を使った復旧に対応する。コード参照の存在検査は選択したプロジェクトの領域に限定し、他プロジェクトやシンボリックリンク経由の探索を拒否する。

試作agent-memoryの現時点のソースを参考にした。元リポジトリの未コミット変更はそのまま保持し、データの移動や自動移行は行っていない。[Memoryの設計と検証](memory-cli-design.md)と[利用手順](../cli/memory/README.md)を参照する。

## 開発フローと専門スキル

devlowは工程の選択と受け渡し、3つのCLIを使った開始・中断・再開・完了・片付けを案内する。recallは現在のTasks、保存時点のcheckpoint、コードとGit、関連するMemoryを読み取り専用で照合する。tdd・blast-radius・interrogateは必要な工程だけで使う。計8スキルを両製品へ同梱する。

ソースコードを変更する仕事は規模に関係なく編集前にTasksへ登録し、PR／MRと相互参照する。調査途中でコード変更へ移る場合も対象とし、コードを変更しない調査などは自動でタスク化しない。完了は原則、必要な検証と全PR／MRのマージ確認後とし、ユーザーの明示的な完了指定も受け付ける。その場合も未マージ・未検証の実状態を残す。devlow、recallと利用先向け指示へ反映した運用であり、Tasks CLIがGitやホスティングサービスへ接続して強制する機能ではない。

旧mainの5スキルと工程資料を再利用し、現在の保存先とCLIへ接続した。各LICENSEの著作権表示と許諾文は元のまま保持し、出典・変更経緯・検証記録は[開発資料](devlow-cli-integration.md)へ置いた。旧orch・OKFのCLI、固定エージェント、他の削除済みスキルには依存しない。

## 検証と公開状態

ローカルGitで複数プロジェクト・複数リポジトリ・並行タスク、更新取得時の編集保持、部分失敗からの再実行、登録解除後の履歴保持、パスとシンボリックリンクの拒否、ロック、不明な形式の拒否を検証する。配布物は開発リポジトリ外で実行する。実行結果は[初版設計の検証記録](monorepo-cli-design.md#検証)へ記録する。

ユーザー指定の`agent-monorepo`・`agent-memory`でGitHubへのHTTPS取得・更新取得を確認した。両製品の配布CLIで2タスク・4Worktreeを作成し、再実行時の編集保持、使用中リポジトリの登録解除拒否、doctor成功を確認した。詳細は[実接続の検証記録](monorepo-cli-design.md#githubへの実接続)を参照する。

続く内容変更の許可を受け、検証用ブランチで通常のGitによるcommit・pushを2回ずつ行った。両製品のCLIで3タスク・6Worktreeを扱い、更新取得後も既存の編集とHEADを保持し、新しいタスクでは更新後の内容を使えることを確認した。検証ブランチと一時管理ルートは後片付け済み。同時書き込みの拒否と、実Gitの作成完了直後にCLIを強制終了した場合の再開も自動テストへ追加した。

片付け追加後は25件の自動テスト、型検査、両製品の配布生成が成功した。GitHub実接続でも4Worktreeの片付け、編集中ファイルの保護、ブランチ・履歴保持、続くリポジトリ登録解除まで確認した。

Codex 0.164.0のapp-serverはローカル配布物の`koto:monorepo`を有効なスキルとして読み取った。Claude Code 2.1.307でもセッション限定の配布物読み込みでmonorepo 1件を認識し、プラグインマニフェスト検査は成功した。利用中のプラグインキャッシュやユーザー設定は更新していない。

続いて、別の一時フォルダへ配布物をコピーし、Codex CLIへスキル名やコマンドを指定せず日本語で依頼した。初期化・2リポジトリの登録・作業場所の準備、未保存ファイルがある片付けの停止、保存済みの作業場所の片付けと履歴保持を確認した。[自然言語による検証記録](monorepo-codex-verification.md)を参照する。

monorepoをdevelopへ統合したコミット83902faでは、[GitHubのLinux CI](https://github.com/sori883/koto/actions/runs/41190574787)も成功した。Tasks追加後はローカルの全36テスト・754 assertions、型検査が成功した。Tasks専用9件と配布検証2件を追加し、両製品の配布物だけでTasks単独の操作と、モノレポと組み合わせた準備から片付けまでを確認した。

Memory追加後は全261件・1627 assertionsと型検査・配布物照合が成功し、両製品のMemory単独実行と三つのCLIの併用を確認した。Codexはkoto:memoryをenabledとして認識し、Claude Codeは3スキルを認識した。実装コミットe2db5c7の[GitHub Linux CI](https://github.com/sori883/koto/actions/runs/41196383068)も成功した。詳細は[Memoryの検証記録](memory-cli-design.md#検証)を参照する。

Tasks追加後の配布物も、Codexのapp-serverがkoto:tasksを有効なスキルとして読み取り、Claude Codeのセッション限定の読込ではmonorepo・tasksの2件を認識した。

5スキル追加後は、型検査、配布テスト9件・282 assertions、188ファイルの配布物照合、5スキルの形式検査に成功した。Codexのapp-serverとClaude Codeのセッション限定の読込は8スキルを認識した。独立した評価担当に一時フォルダの配布スキルを渡し、小さな不具合修正のタスク作成から完了記録、および古いcheckpointと現在のコード・依存関係を照合する読み取り専用の状況確認を試した。後者は確認前後の全65ファイルが同一だった。環境差を含む確認範囲は[スキル連携の検証記録](devlow-cli-integration.md#検証)に記載する。

5スキルの実装コミット0a5ec5eの[GitHub Linux CI](https://github.com/sori883/koto/actions/runs/41213746200)では、Bun 1.4.2で全262テスト・1664 assertions、型検査、生成物照合が成功した。

Codexデスクトップ画面とClaude Codeモデルへの自然言語依頼、個別の認証方式・認証失敗時の実接続は未確認。独立担当によるdevlow・recallの試行は、製品クライアントからの自動スキル選択や全専門手法の実行確認を意味しない。monorepoの実モデル検証を他のCLIの検証として扱わない。

monorepoは`main`から作った`develop`へ履歴を残して統合済み。Tasksも`codex/tasks-cli`から履歴を残して統合済み（7cbc872）。Memoryは`codex/memory-cli`から同じ方法で統合済み（3c326b1）。5スキルは`codex/devlow-skills`で開発し、同じ統合方針に従う。`main`へのマージは今回の範囲に含めない。

版数は0.1.8のまま。開発ブランチのGitHubへの反映とプラグインの正式リリースは区別する。公開済み0.1.8とMacに導入済みのプラグインには未反映。`@koto/monorepo`・`@koto/tasks`・`@koto/memory`はローカルのパッケージ識別名で、NPM公開は行っていない。

[配布物の生成](distribution.md)、[先行した配布整理](issue-23-packaging-reset.md)、[先行したスキル削除](issue-23-skill-pruning.md)も参照できる。過去のスキル・CLIの検証記録は、現在利用できる機能を示すものではない。
