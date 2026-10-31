# Worktreeの片付け

2026-10-31。ユーザーから片付け機能とmonorepoスキルへの組み込みを依頼されたため、既存CLIを拡張する。

`workspace remove <task> --dry-run`で削除対象・保護条件を確認し、同じコマンドから`--dry-run`を外すと実行する。JSON入力は`dryRun: true`を受け付ける。プレビューでもリモート追跡情報を更新するが、作業ファイルと管理JSONは変更しない。実行時は再検査し、プレビューだけを削除の根拠にしない。

対象はタスク内の全リポジトリ。全件を検査してから削除を開始し、未保存・未追跡・無視対象のファイル、未送信コミット、Gitのロック・作業中操作、所有やパスの不整合があれば削除を始めない。HEADが現在のoriginのいずれかのブランチから到達できることを、更新取得とリモート参照の照合で確認する。削除済みのリモートブランチがローカルに残っているだけでは許可しない。通信失敗も停止条件とする。squashやrebase後に履歴の到達関係を証明できない場合も自動許可しない。

Gitは通常のworktree removeを使用し、force・reset・cleanは使わない。ブランチとBare Repositoryを保持する。タスク用の親ディレクトリは空の場合だけ削除し、そこに置かれた他のファイルは残す。プロジェクト削除、Git履歴の削除、リモートへの書き込みは対象外。

削除前に対象リポジトリとHEADをworkspaceのremovalへ保存する。異常終了後、対象パスとGit登録がともに消えており、保持したブランチが記録したHEADと一致する場合だけ完了済みとして扱う。残りは再検査する。途中の状態ではworkspace createを拒否し、removeの再実行を案内する。全件の削除確認後にworkspace登録を取り除く。登録が既にない場合は変更なしで成功する。

CLI間の排他は既存の管理ルートロックを使う。エディターや開発サーバーなどCLI外の書き込みは排他できないため、利用手順では対象の作業を停止してから片付けることを伝える。Gitの削除直前にも状態を確認する。

変更対象はCLIの入力・状態モデル・Git観測・サービス、monorepoスキルと利用手順、設計・現状資料、テスト、両製品の生成物。検証は成功・再実行、保護条件、削除途中の失敗と再開、別タスクと履歴の保持、配布物からの実行を実Gitで行う。アプリ本体の読込・起動は別の実経路で確認する。

Gitの動作は公式の[worktree remove](https://git-scm.com/docs/git-worktree)と[status](https://git-scm.com/docs/git-status)を参照する。

## 検証結果

2026-10-31、macOS、Bun 1.4.4、Git 2.50.1（Apple Git-155）で検証した。

- 型検査成功。全25テスト・467 assertions成功。うち6テストを片付けに追加した。
- 削除プレビュー・実削除・再実行、ブランチと別タスクの保持、未保存・未追跡・ignored・indexで隠れた変更、Gitロックとmerge中状態、未送信コミット、削除済みリモートブランチの古い追跡情報、全件検査、途中失敗とGit削除後の応答失敗からの再開を確認した。
- fetch中に作られたignoredファイルを再検査で検出して停止した。同じBare Repository内の別Worktreeへ`.git`を差し替えた場合も、逆向きのGit登録パスの照合で拒否した。
- 両製品の配布物を84ファイルとして生成。スキルの相対位置からCLI入口を解決し、ユーザー指定のagent-monorepo・agent-memoryで14回のCLI操作を実行した。2タスク・4Worktreeの作成、プレビュー、削除、編集中ファイルの保護、保持ブランチのHEAD照合、リポジトリ登録解除、doctor成功を確認した。この試験はリモートへ書き込まず、検証用の一時管理ルートも後片付け済み。

### クライアントによる読込

Codex 0.164.0のapp-serverをstdioで起動し、initialize後にplugin/readへローカルの`.agents/plugins/marketplace.json`とpluginName=kotoを指定した。応答のsourceは`dist/codex/koto`、skillsは新しい`koto:monorepo` 1件、enabled=trueで、片付けを含む説明文と正しいSKILL.mdのパスを返した。モデルの生成や新しいチャットの作成は行っていない。公式の[Skills API説明](https://learn.chatgpt.com/docs/app-server#skills)と、インストール済みCLIが生成したschemaを参照した。

Claude Code 2.1.307では、`--setting-sources '' --plugin-dir <配布先> plugin details koto`がkoto@inlineとしてmonorepo 1件を認識した。プラグインルートへの`plugin validate --json`はsuccess=true、manifest errors/warningsは0件だった。公開ディレクトリ用の任意検査にはREADME・LICENSEの指摘とアイコンの注意があり、公開審査を通過したという意味ではない。SKILL.mdの形式検証はskill-creatorのquick_validate.pyで成功した。Claudeのvalidateへスキル単体を渡す方法はこの版ではマニフェスト検査として扱われるため、スキル単体の検証根拠にはしていない。

既存のプラグインキャッシュとユーザー設定は変更していない。上記は各クライアント本体による読込と、読み取った配置からのCLI実行の検証である。

続いて、別の一時フォルダでCodex CLIへ日本語で依頼し、スキルの選択、未保存ファイルがある場合の停止、保存済みの作業場所の片付けと履歴保持まで確認した。詳細は[自然言語による検証記録](monorepo-codex-verification.md)を参照する。デスクトップ画面の操作とClaude Codeモデルへの自然言語依頼は未確認。
