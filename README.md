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

**`@koto/memory`** はプロジェクトの知識・経験・設計判断をOKFのMarkdownで保存します。語句・属性・コード参照で検索でき、関連付け・削除・形式検証と、中断した書き込みの復旧にも対応します。Bunだけで動き、TasksやGitには依存しません。

```sh
bun run memory -- setup --root /path/to/my-workspace --json
bun run memory -- create knowledge/auth --root /path/to/my-workspace --type knowledge --title "認証方式" --desc "採用した理由" --body "根拠を記録する。" --json
bun run memory -- search "認証" --root /path/to/my-workspace --json
```

[Memory CLIの利用手順](cli/memory/README.md)と[Memoryスキル](skills/memory/SKILL.md)を両製品へ同梱します。保存先は`.space/<project>/memory/`で、TasksやWorkspaceのデータは変更しません。

3つのCLIを組み合わせて進めるための開発スキルも同梱します。

| スキル | 役割 |
| --- | --- |
| [devlow](skills/devlow/SKILL.md) | 開発の工程を選び、monorepo・Tasks・Memoryで開始から中断・再開・完了まで進める |
| [recall](skills/recall/SKILL.md) | タスク・checkpoint・実際のコードを照合して、現在地と次の操作を説明する |
| [tdd](skills/tdd/SKILL.md) | 局所テストで再現できる不具合を、失敗を確認してから直す |
| [blast-radius](skills/blast-radius/SKILL.md) | 変更の影響範囲と安全性に関わる前提を調べる |
| [interrogate](skills/interrogate/SKILL.md) | 利用可能な独立担当のレビューを照合し、指摘の採否を判断する |

例えば「この管理ルートのdefaultで、タスクtask-001の修正とテストまで進めて」はdevlow、「task-001はどこまで進んだか、確認だけして」はrecallで扱います。専門スキルは必要な工程で使い、毎回すべてを呼ぶ構成にはしていません。上の5スキルは既存のMITライセンスの資産を再利用し、各ディレクトリと配布物に著作権表示・許諾文を保持しています。

利用先の`AGENTS.md`・`CLAUDE.md`には、monorepoの指示更新機能で現在のスキルへの入口を設定できます。既存の文章を残してkotoの管理部分だけを更新し、独自編集があれば停止します。

```sh
bun run monorepo -- instructions plan --root /path/to/my-workspace --target /path/to/existing-repo --product codex --json
bun run monorepo -- instructions apply --root /path/to/my-workspace --target /path/to/existing-repo --product codex --json
bun run monorepo -- instructions status --root /path/to/my-workspace --target /path/to/existing-repo --product codex --json
```

Claude Codeには`--product claude-code`を使います。配置先と管理プロジェクトを確認し、詳しくは[指示ファイルの追加・更新](cli/monorepo/README.md#指示ファイルの追加更新)を参照してください。旧setupの記録と一致する指示も更新できます。

共通知識の利用先への配置は未実装です。旧付属CLIと他の削除済みスキルは復元せず、共通知識の正本は`space/default/`に保持しています。

- [現在の構成・検証状況](docs/current-state.md)
- [目的と配布設計](docs/architecture.md)
- [monorepo CLIの設計](docs/monorepo-cli-design.md)
- [Tasks CLIの設計](docs/tasks-cli-design.md)
- [Memory CLIの設計](docs/memory-cli-design.md)
- [開発スキルの連携と再利用元](docs/devlow-cli-integration.md)
- [指示ファイル更新の設計と検証](docs/instruction-setup-design.md)
- [配布物の生成と検証](docs/distribution.md)

develop向けの開発内容です。公開済み0.1.8と導入済みのプラグインには未反映で、NPMへの公開も行っていません。
