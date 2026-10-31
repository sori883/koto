# koto

**koto (Knowledge-Oriented Task Orchestration)**

作業と知識を扱うための、Codex・Claude Code向けプラグインを開発するリポジトリです。Memory・Tasks・Workspaceを独立した責務のツールとして構成します。

最初のツールとして、koto所有の **`@koto/monorepo`** を実装しています。初期設定、プロジェクト追加、Gitリポジトリの登録・更新取得・登録解除、タスクごとのWorktree作成・状態確認・片付けを行います。Gitの処理には既存Gitを使います。

Bun 1.4.2以上とGitを用意し、このリポジトリのルートで実行できます。

```sh
bun run monorepo -- setup --root /path/to/my-workspace
bun run monorepo -- repo add api --url git@github.com:your-org/api.git --root /path/to/my-workspace
bun run monorepo -- workspace create task-001 --repo api --root /path/to/my-workspace --json
```

利用者向けの[CLI手順](cli/monorepo/README.md)と、AI向けの[monorepoスキル](skills/monorepo/SKILL.md)を両製品へ同梱します。CLIはAIなしでも実行できます。登録解除ではGitデータを残します。

片付けは `workspace remove <task> --dry-run` で事前確認できます。未保存のファイルや送信を確認できないコミットがあれば停止し、削除後もブランチとGit履歴を保持します。

Memory・Tasks、利用先への共通知識や指示ファイルの配置は未実装です。旧スキル・付属CLIは削除済みで、共通知識の正本は`space/default/`に保持しています。

- [現在の構成・検証状況](docs/current-state.md)
- [目的と配布設計](docs/architecture.md)
- [monorepo CLIの設計](docs/monorepo-cli-design.md)
- [配布物の生成と検証](docs/distribution.md)

作業ブランチ上の変更です。公開済み0.1.8と導入済みのプラグインには未反映で、NPMへの公開も行っていません。
