# koto

**koto (Knowledge-Oriented Task Orchestration)**

作業と知識を扱うための、Codex・Claude Code向けプラグインを開発するリポジトリです。Memory・Tasks・Workspaceを独立した責務のツールとして構成します。

最初のツールとして、koto所有の **`@koto/monorepo`** を実装しています。初期設定、プロジェクト追加、Gitリポジトリの登録・更新取得・登録解除、タスクごとのWorktree作成・状態確認・片付けを行います。Gitの処理には既存Gitを使います。

**`@koto/tasks`** はタスクの作成・状態更新・依存関係・成果物参照・チェックポイントを管理します。monorepoから独立したCLIで、同じプロジェクトID・タスクIDを介して組み合わせられます。TasksだけならGitは不要です。

Bun 1.4.2以上とGitを用意し、このリポジトリのルートで実行できます。

```sh
bun run monorepo -- setup --root /path/to/my-workspace
bun run monorepo -- repo add api --url git@github.com:your-org/api.git --root /path/to/my-workspace
bun run monorepo -- workspace create task-001 --repo api --root /path/to/my-workspace --json
```

利用者向けの[CLI手順](cli/monorepo/README.md)と、AI向けの[monorepoスキル](skills/monorepo/SKILL.md)を両製品へ同梱します。CLIはAIなしでも実行できます。登録解除ではGitデータを残します。

片付けは `workspace remove <task> --dry-run` で事前確認できます。未保存のファイルや送信を確認できないコミットがあれば停止し、削除後もブランチとGit履歴を保持します。

```sh
bun run tasks -- setup --root /path/to/my-workspace
bun run tasks -- task add task-001 --title "APIを作る" --operation-id add-task-001 --root /path/to/my-workspace --json
bun run tasks -- task show task-001 --root /path/to/my-workspace --json
```

[Tasks CLIの利用手順](cli/tasks/README.md)と[Tasksスキル](skills/tasks/SKILL.md)も両製品へ同梱します。古い版による上書きや操作の重複を防ぎ、依存タスクのやり直しを後続の確認に反映します。

Memory、利用先への共通知識や指示ファイルの配置は未実装です。旧スキル・付属CLIは削除済みで、共通知識の正本は`space/default/`に保持しています。

- [現在の構成・検証状況](docs/current-state.md)
- [目的と配布設計](docs/architecture.md)
- [monorepo CLIの設計](docs/monorepo-cli-design.md)
- [Tasks CLIの設計](docs/tasks-cli-design.md)
- [配布物の生成と検証](docs/distribution.md)

作業ブランチ上の変更です。公開済み0.1.8と導入済みのプラグインには未反映で、NPMへの公開も行っていません。
