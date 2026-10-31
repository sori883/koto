# kotoの現状

2026-10-31、Issue #23の作業ツリーを対象とする。対応先はCodexとClaude Codeの2製品。旧スキルと付属CLIを削除した後、ユーザーの依頼により、現在のkotoリポジトリ内に`@koto/monorepo`を新しく実装した。

## 現在の構成

| 構成物 | 状態 |
| --- | --- |
| `cli/monorepo/` | Bunで動く独立したCLI。実行名は`koto-monorepo`、外部ライブラリ依存なし |
| `skills/monorepo/` | CLIを使うAI向けの利用手順。処理はCLIへ委ねる |
| `packaging/codex/`・`packaging/claude-code/` | 製品別のプラグイン定義とカタログ定義 |
| `space/default/` | 共通知識の正本。既存の23原則を保持 |
| `scripts/build.ts` | 2製品の配布物とカタログを生成・照合 |
| `dist/codex/koto/`・`dist/claude-code/koto/` | CLI・スキル・共通知識・製品別プラグイン定義のコピー |
| `.agents/plugins/marketplace.json`・`.claude-plugin/marketplace.json` | 各製品の配布物を参照するカタログ |
| `tests/monorepo/` | 実際のローカルGitとCLI子プロセスによる操作・保護条件の検証 |
| `tests/distribution/` | 生成、参照切れ、生成物照合、スキルなし構成、開発環境外でのCLI起動を検証 |

## monorepo CLI

setup、プロジェクト追加・参照、リポジトリ登録・取得・参照・同期・登録解除、複数リポジトリのWorktree作成・参照・片付け、status・doctorを実装した。CLIは人間からも直接実行でき、非対話実行とJSON入出力に対応する。

管理情報は`.space/monorepo.json`と`.space/<project>/monorepo.json`に保存する。Bare Repositoryは`repositories/<project>/<repo>.git/`、編集場所は`workspaces/<project>/<task>/<repo>/`へ置く。プロジェクト省略時はdefault。不明な対象への自動切り替えや、プロジェクト間でのGit保存領域の共有は行わない。

リポジトリ削除は登録解除で、Gitデータは保持する。作成途中を含む作業環境があれば登録解除を拒否する。同じ入力での再実行では作成済みの作業場所と編集を維持する。

片付けは`workspace remove <task> [--dry-run]`で行う。未保存・未追跡・無視対象のファイル、未送信コミット、ロックやGitの作業中状態等を検査し、通常のGitで削除する。ブランチと履歴は残し、途中失敗後は削除記録と実体を照合して再開する。[片付けの設計と検証](monorepo-cleanup-design.md)を参照する。

Memory・Tasks、プロジェクト削除、利用先への共通知識とクライアント指示の配置は未実装。専用エージェント・旧setupマニフェスト・旧スキルは復元していない。[機能一覧](workspace-feature-inventory.md)の全項目が実装済みという意味ではない。[初版設計](monorepo-cli-design.md)と[CLI手順](../cli/monorepo/README.md)を参照する。

## 検証と公開状態

ローカルGitで複数プロジェクト・複数リポジトリ・並行タスク、更新取得時の編集保持、部分失敗からの再実行、登録解除後の履歴保持、パスとシンボリックリンクの拒否、ロック、不明な形式の拒否を検証する。配布物は開発リポジトリ外で実行する。実行結果は[初版設計の検証記録](monorepo-cli-design.md#検証)へ記録する。

ユーザー指定の`agent-monorepo`・`agent-memory`でGitHubへのHTTPS取得・更新取得を確認した。両製品の配布CLIで2タスク・4Worktreeを作成し、再実行時の編集保持、使用中リポジトリの登録解除拒否、doctor成功を確認した。詳細は[実接続の検証記録](monorepo-cli-design.md#githubへの実接続)を参照する。

続く内容変更の許可を受け、検証用ブランチで通常のGitによるcommit・pushを2回ずつ行った。両製品のCLIで3タスク・6Worktreeを扱い、更新取得後も既存の編集とHEADを保持し、新しいタスクでは更新後の内容を使えることを確認した。検証ブランチと一時管理ルートは後片付け済み。同時書き込みの拒否と、実Gitの作成完了直後にCLIを強制終了した場合の再開も自動テストへ追加した。

片付け追加後は25件の自動テスト、型検査、両製品の配布生成が成功した。GitHub実接続でも4Worktreeの片付け、編集中ファイルの保護、ブランチ・履歴保持、続くリポジトリ登録解除まで確認した。

Codex 0.164.0のapp-serverはローカル配布物の`koto:monorepo`を有効なスキルとして読み取った。Claude Code 2.1.307でもセッション限定の配布物読み込みでmonorepo 1件を認識し、プラグインマニフェスト検査は成功した。利用中のプラグインキャッシュやユーザー設定は更新していない。

続いて、別の一時フォルダへ配布物をコピーし、Codex CLIへスキル名やコマンドを指定せず日本語で依頼した。初期化・2リポジトリの登録・作業場所の準備、未保存ファイルがある片付けの停止、保存済みの作業場所の片付けと履歴保持を確認した。[自然言語による検証記録](monorepo-codex-verification.md)を参照する。

Codexデスクトップ画面とClaude Codeモデルへの自然言語依頼、個別の認証方式・認証失敗時の実接続、LinuxでのCI実行は未確認。CLIの実接続、クライアント本体の読込、Codex CLIの実モデルによる操作、ローカルの生成・型検査・テストを区別する。

ユーザーは今回のmonorepo機能を完成として扱い、`main`から作る`develop`への統合を指示した。実装・配布物と設計・検証記録を作業ブランチでコミットし、元の履歴を保持するマージコミットで取り込む。統合先は`develop`であり、`main`へのマージは今回の範囲に含めない。

版数は0.1.8のまま。開発ブランチのGitHubへの反映とプラグインの正式リリースは区別する。公開済み0.1.8とMacに導入済みのプラグインには未反映。`@koto/monorepo`はローカルのパッケージ識別名で、NPM公開は行っていない。

[配布物の生成](distribution.md)、[先行した配布整理](issue-23-packaging-reset.md)、[先行したスキル削除](issue-23-skill-pruning.md)も参照できる。過去のスキル・CLIの検証記録は、現在利用できる機能を示すものではない。
