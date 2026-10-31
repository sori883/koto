# koto所有のmonorepo CLI 初版設計

2026-10-31。CLI中心の分担への合意と「koto所有のmonorepo CLIとして設計・実装する」という依頼に基づく。Gitの履歴・ブランチ・Worktree処理は既存Gitを呼び、kotoは入力、配置、登録情報、保護条件、再実行を所有する。

## 所有と配置

ユーザーの確認により、実装先は今のkotoリポジトリ内の`cli/monorepo/`とする。パッケージ名は`@koto/monorepo`。従来のWorkspaceを別リポジトリにする方針を変更し、依存はこのモジュール内で完結させる。Memory・Tasksへの依存は作らない。TypeScriptとBunを用い、外部ライブラリは追加しない。生成時に両製品の`cli/monorepo/`へコピーする。

実行名は`koto-monorepo`、リポジトリ内では`bun run monorepo -- ...`、配布物からは`bun /path/to/plugin/cli/monorepo/monorepo.ts ...`を入口とする。CLIはAIなしで実行できる。利用者向け手順と薄いmonorepoスキルを同梱する。

## 初版の範囲

| 操作 | 内容 |
| --- | --- |
| `setup` | 管理ルートとdefaultプロジェクトを初期化。既存状態を検証して再実行できる |
| `project add <id>` / `list` / `show` | プロジェクトを追加・参照する |
| `repo add <id> --url <url>` / `list` / `show <id>` | リポジトリを登録・取得・参照する |
| `repo sync <id>` | リモートブランチの更新を取得する。作業ブランチには取り込まない |
| `repo remove <id>` | 利用中の作業環境がないことを確認し、登録を解除する。Git管理領域は保持し、同じ取得元で再登録できる |
| `workspace create <task-id> --repo <id>...` | 一つ以上のリポジトリのWorktreeを作成する |
| `workspace list` / `show <task-id>` | 作業場所と実際の変更状態を確認する |
| `workspace remove <task-id> [--dry-run]` | 全Worktreeを検査し、ブランチと履歴を保持して作業場所を片付ける |
| `status` / `doctor` | 指定プロジェクトの状態と、管理情報・実体の整合性を確認する |

共通オプションは`--root`・`--project`・`--json`。root省略時は作業ディレクトリ、project省略時はdefault。指定された対象が不明ならエラーとし、別プロジェクトへ切り替えない。project/repository/taskのIDは変更しない短いASCII識別子とし、パスに安全な文字へ限定する。表示名変更は初版で扱わない。

`--input-json`でも同じ操作を指定できる。command配列でコマンドと位置引数を渡し、root・project等を名前付きの値で渡す。通常引数へ変換して同じ入力検証と処理を通す。JSON入力の場合は出力もJSONとする。

Worktreeの開始地点は`--base <remote-branch>`、省略時は登録時に確認したリモートの既定ブランチ。作業ブランチは`--branch`で指定でき、省略時は`koto/<task-id>`。取得元にコミットがない場合は明示的に失敗し、後の再実行で取得を再開できる。

## 保存配置と正本

```text
<root>/
  .space/
    monorepo.json                 形式版、root ID、登録プロジェクトID
    monorepo.lock                 CLIによる書き込みの排他
    <project>/monorepo.json       repositoryとworkspaceの登録情報・処理途中の状態
  repositories/<project>/<repo>.git/
  workspaces/<project>/<task>/<repo>/
```

Memory・Tasksの文書や台帳は初期化しない。共通知識やクライアントの指示ファイルの配置も、この初版のsetupには含めない。配布元の`space/default/`と利用先の`.space/default/`を混同しない。

管理ファイルは同じディレクトリの一時ファイルから置換する。書き込みは管理ルート単位で排他し、完了までロックを保持する。異常終了で残ったロックは勝手に奪わない。Gitの状態をJSONへ複製して正本にせず、ブランチや変更状態はGitから読み取る。

## Gitの扱い

Bare Repositoryは`git init --bare`とremote設定・fetchで準備する。取得するブランチは`refs/remotes/origin/*`へ置き、ローカル作業ブランチをfetchで上書きしない。既定ブランチはリモートHEADから確認する。Worktreeは既存Gitのadd・list、状態はstatus等で取得する。

Gitは引数配列で起動し、shellへコマンド文字列を渡さない。対象リポジトリを明示し、呼び出し元のGIT_DIR等による対象の変更を防ぐ。対話プロンプトを抑え、通信失敗をエラーとして返す。取得元へ秘密情報を埋め込ませず、認証は既存Gitの認証設定を使う。

参考：Git公式の[worktree](https://git-scm.com/docs/git-worktree)、[clone](https://git-scm.com/docs/git-clone)、[fetch](https://git-scm.com/docs/git-fetch)、[status](https://git-scm.com/docs/git-status)。利用環境のGit 2.50.1でもBare RepositoryからのWorktree作成を一時領域で確認した。

## 中断と再実行

取得とWorktree作成は、対象と入力を先に管理情報へ記録する。同じ入力の再実行では、存在する実体とGitの登録情報を照合して続行する。異なる入力による同じIDの再利用は拒否する。存在するだけの未知のディレクトリは引き取らない。

複数リポジトリでは各作成の結果を保存し、全件成功前に全体を成功としない。失敗時に作成済みWorktreeを自動削除しない。再実行は実際の状態を読み、完了済み部分を保持する。

## 削除と対象外

初版のrepo removeは登録解除とする。Git管理領域に所有情報を残して再登録を可能にし、ローカルだけの履歴を消さない。利用中・作成途中の作業環境やGit上のWorktreeがあれば拒否する。続く依頼により、[Worktreeの片付け](monorepo-cleanup-design.md)を追加した。Git実データとプロジェクトの削除は実装しない。

commit・push・merge・PR補助、移動・共有・バックアップ・アーカイブ、Memory・Tasksの機能、既存cloneの移動、任意の開発サーバー起動も含めない。

## 検証

一時的なローカルGitリポジトリで、複数プロジェクト・複数リポジトリ・並行作業、取得と同期、実変更の検出、登録解除と再登録、パスとシンボリックリンクの拒否、入力競合、部分失敗後の再実行を確認する。CLIを子プロセスで実行し、JSON・終了コード・外部配布からの実行を確認する。GitHubへのHTTPS実接続は後述のとおり確認済み。Codex・Claude CodeのUIからの実行と、個別の認証方式・認証失敗時の挙動は未確認範囲として残す。

2026-10-31、macOS、Bun 1.4.4、Git 2.50.1（Apple Git-155）で以下を確認した。

| 確認 | 結果 |
| --- | --- |
| `bun run typecheck` | 成功 |
| `bun run test` | 25件成功、467 assertions。実Gitの操作20件と配布5件 |
| `bun run build` | 84ファイルを生成 |
| `bun run build:check` | 全生成物が正本と一致 |
| `bun run monorepo -- --help` | リポジトリの入口から起動成功 |
| skill-creatorの`quick_validate.py` | monorepoスキルの形式検証成功。PyYAMLはuvの一時環境で使用 |
| 配布先の実行 | 両製品の配布物を一時領域に生成し、ソース側を削除した後にCLI入口からsetup成功 |

空のリポジトリからの再取得、明示した開始ブランチ、JSON入力、Git保存領域内のシンボリックリンク、継承したGIT_DIRによる対象変更もテストに含む。個別の認証方式・認証失敗時、アプリUI、LinuxでのCI、同一OSユーザーによる外部からの同時改変の隔離は確認していない。Git保存領域のシンボリックリンク検査はディレクトリを再帰的に読むため、大規模な履歴での性能は未測定。

### GitHubへの実接続

2026-10-31、ユーザーが検証への利用を許可した次の2リポジトリを、一時的な管理ルートのdefaultプロジェクトへHTTPSで登録した。実行対象は作業ツリー内で生成したCodex版とClaude Code版のCLI。アプリのUIを経由した試験ではない。

| リポジトリ | 取得したmainのコミット |
| --- | --- |
| [sori883/agent-monorepo](https://github.com/sori883/agent-monorepo) | `997b512d88b38bb57efba6a5333624aad132daa5` |
| [sori883/agent-memory](https://github.com/sori883/agent-memory) | `70cbf5e25641a073b9d198d1f4d6ce5532847b0c` |

計12回のCLI操作で、以下を確認した。

- setup、2リポジトリの登録・HTTPS取得、初期doctorが成功した。
- `github-smoke`と`github-parallel`の2タスクに各2リポジトリ、計4つのWorktreeを作成した。後者はJSON入力で作成した。
- Codex版で作った作業環境をClaude Code版から再実行し、同じ場所とローカルの検証用ファイルを保持した。
- 両リポジトリをsyncし、既存Worktreeのコミットと検証用ファイルを保持した。別タスクへ検証用ファイルが混入しないことも確認した。
- 使用中の`agent-monorepo`に対するrepo removeは`IN_USE`・終了コード1となり、登録とデータを保持した。
- 検証用ファイルを除いた後、doctorは`healthy: true`、全4Worktreeは未コミット変更なしだった。

この12操作の検証ではGitHubへの操作は取得と参照のみで、push・リモートブランチ作成・リポジトリ設定変更は行っていない。検証用の管理ルートは終了時に削除した。CLI本体の修正は不要だった。

### GitHubへの変更反映と、編集中の作業の保護

続いてユーザーから両リポジトリの内容変更も許可されたため、通常のGitによるcommit・pushと、monorepo CLIの更新取得・Worktree作成を組み合わせて検証した。CLIへcommit・push機能を追加したものではない。

両リポジトリに検証用の`codex/monorepo-e2e-2cd90435f65b`ブランチを作成し、`koto-e2e-check.txt`を追加・更新した。機密情報や既存コードの内容は検証ファイルへ含めていない。

| リポジトリ | 1回目のpush | 2回目のpush |
| --- | --- | --- |
| agent-monorepo | `23a8367d9b62114bfa18d80c519c3cd77614b34b` | `7e989e1b2c6ef53f72bbec73880385e53c1363ad` |
| agent-memory | `6ce90944f63e27f2294dd1783c9434d1116acdec` | `636e8830f0277a7bd2c14ffc27c1d6baa11e78ba` |

1. Codex版CLIで作った作業場所から、通常のGitで1回目のcommit・pushを行った。
2. Claude Code版CLIで更新取得し、そのリモートブランチを開始地点とする別タスクを作成した。両リポジトリで変更ファイルを取得できた。
3. 別タスクの同じファイルに未コミットの編集を加えたまま、元の作業場所から2回目のcommit・pushを行った。
4. CLIで更新取得と作業場所作成の再実行を行い、編集中のファイルと既存HEADが保持され、`baseDistance.behind`が1になることを確認した。
5. さらに新しいタスクを作成し、両リポジトリで2回目のpush内容から作業を開始できることを確認した。

計3タスク・6Worktree、12回のCLI操作が成功し、doctorは`healthy: true`となった。検証後、リモートの先端が自分のpushしたコミットと一致する条件を付けて検証ブランチを削除し、消失を確認した。両mainの先端が開始前と同じことも確認した。自分で加えた検証用の未コミット編集を戻し、全Worktreeが変更なしであることを確認して一時管理ルートを削除した。

### 同時実行と異常終了

ネットワークに依存しない自動テストを追加した。実際のGitによるWorktree作成の完了直後、CLIが管理情報を完了へ更新する前に処理を待機させる。この状態で別プロセスからプロジェクト追加を実行すると`LOCKED`となり、登録情報が変わらないことを確認する。

作成済みWorktreeに編集を残し、CLIと待機中のGitラッパーを強制終了した。管理情報は`pending`、ロックは残り、再実行は`LOCKED`となった。両プロセス停止後にテストがロックだけを取り除くと、同じ入力の再実行で既存Worktreeを照合して完了し、編集も保持された。CLIが残存ロックを自動削除する仕様にはしていない。
