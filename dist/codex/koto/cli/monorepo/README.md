# @koto/monorepo

複数のGitリポジトリをプロジェクトごとに登録し、タスクごとの作業場所を作るCLIです。実行名は `koto-monorepo`。Gitの取得・更新取得・Worktree作成には、インストール済みのGitを使います。

## 実行

Bun 1.4.2以上とGitをPATHに用意してください。同梱されたファイルから、追加の依存パッケージなしで実行できます。

```sh
bun /path/to/koto/cli/monorepo/monorepo.ts --help
bun /path/to/koto/cli/monorepo/monorepo.ts setup --root /path/to/my-workspace
```

以下では、上の `bun /path/to/koto/cli/monorepo/monorepo.ts` を `koto-monorepo` と表記します。パッケージのbinをPATHに配置した環境では、そのまま実行できます。

```sh
koto-monorepo setup --root /path/to/my-workspace
koto-monorepo project add client --root /path/to/my-workspace
koto-monorepo repo add api --url git@github.com:your-org/api.git --root /path/to/my-workspace --project client
koto-monorepo repo add web --url git@github.com:your-org/web.git --root /path/to/my-workspace --project client
koto-monorepo workspace create task-001 --repo api --repo web --root /path/to/my-workspace --project client
koto-monorepo workspace show task-001 --root /path/to/my-workspace --project client --json
```

結果の `path` が編集する作業場所です。作業ブランチのcommit・push・merge・PRは、そこで通常のGitやGitHub CLIを使って行ってください。

## 対象と配置

`--root` は管理ルートです。省略すると現在のディレクトリを使い、親ディレクトリから自動探索しません。`--project` を省略すると `default` を使います。明示したプロジェクトが存在しない場合はエラーになります。

IDは1〜64文字で、半角の小文字・数字から始まり、小文字・数字・ハイフン・アンダースコアを使えます。`constructor` と `prototype` は予約語です。同じリポジトリを別プロジェクトへ登録すると、それぞれに独立したGit管理領域を作ります。

```text
<root>/
  .space/monorepo.json
  .space/<project>/monorepo.json
  repositories/<project>/<repo>.git/
  workspaces/<project>/<task>/<repo>/
```

setupは `default` の管理情報と保存先を準備します。管理ルート全体のGit管理は必要ありません。Memory・Tasksのデータや、Codex・Claude Codeの指示ファイルは作成しません。

利用先の指示ファイルは、配置先と製品を指定する`instructions`操作で追加・更新します。

## コマンド

すべてのコマンドで `--root PATH` と `--json` が使えます。`setup`、`project add`、`project list` 以外は `--project ID` も使えます。

| コマンド | 動作 |
| --- | --- |
| `setup` | 管理ルートとdefaultを初期化する。再実行で既存の管理情報を維持する |
| `project add <id>` | プロジェクトを追加する |
| `project list` | 登録プロジェクトのIDと管理先を返す |
| `project show` | 指定プロジェクトの登録内容を返す |
| `repo add <id> --url <source>` | リポジトリを登録して取得する |
| `repo list` / `repo show <id>` | リポジトリの登録内容を返す |
| `repo sync <id>` | リモートブランチの更新を取得する。作業ブランチと編集内容は保持する |
| `repo remove <id>` | 登録を解除する。Gitデータは保持する |
| `workspace create <task> --repo <id> ...` | 指定した各リポジトリのWorktreeを作る |
| `workspace list` / `workspace show <task>` | 作業場所、変更ファイル、現在のコミット、開始元とのコミット数の差を返す |
| `workspace remove <task> --dry-run` | 全Worktreeの削除対象と保護条件を検査する。作業場所と管理JSONは保持する |
| `workspace remove <task>` | 全件を再検査して作業場所とタスクの登録を取り除く。ブランチとGit履歴は保持する |
| `instructions plan` / `instructions status` | 指定した指示ファイルの変更予定・配置状態・衝突を読み取り専用で確認する |
| `instructions apply` | kotoの管理ブロックを追加・更新し、管理記録を保存する |
| `status` | 指定プロジェクトの登録状態と実体を確認する |
| `doctor` | 整合性を確認し、不整合やロックがあれば終了コード1を返す |

`workspace create` の `--repo` は複数指定できます。`--base <branch>` は取得済みのリモートブランチ名、`--branch <branch>` は新しく作る作業ブランチ名です。省略時はリモートの既定ブランチから `koto/<task>` を作ります。最新のリモート状態から始める場合は、先に `repo sync` を実行してください。空のリポジトリは、最初のコミットと既定ブランチを用意してから再取得してください。

取得元はHTTPS、SSH、file URL、または明示的なローカルパスです。相対パスは呼び出し時の作業ディレクトリを基準にします。認証には既存Gitの設定を使い、URLへトークン・パスワード・クエリを埋め込まないでください。CLIはGitの対話入力を抑えます。認証に失敗した場合はGit側の認証設定を確認してください。

## JSONと終了コード

JSONで入力する場合は `--input-json` を使います。入力と出力の両方がJSONになり、通常のコマンド引数と同じ検証・処理を行います。

```sh
koto-monorepo --input-json '{"command":["workspace","create","task-001"],"root":"/path/to/my-workspace","project":"client","repo":["api","web"]}'
```

`command` はコマンドと位置引数の配列です。その他の入力は `root`、`project`、`url`、`branch`、`base`、`target`、`product`、`source` が文字列、`repo` が文字列の配列、片付けのプレビュー用の `dryRun` がbooleanです。未知のキーや、通常の入力オプションとの混在は拒否します。

## 指示ファイルの追加・更新

既存の管理ルートと登録済みプロジェクトを選び、`--target`に配置先ディレクトリの絶対パス、`--product`に`codex`または`claude-code`を指定します。対象ファイルはそれぞれ`AGENTS.md`・`CLAUDE.md`です。

```sh
koto-monorepo instructions plan --root /path/to/workspace --project default --target /path/to/existing-repo --product codex --json
koto-monorepo instructions apply --root /path/to/workspace --project default --target /path/to/existing-repo --product codex --json
koto-monorepo instructions status --root /path/to/workspace --project default --target /path/to/existing-repo --product codex --json
```

plan/statusは対象と管理記録を書き換えません。返された`block`が配置する内容、`action`がcreate・update・adopt・unchanged・resume、`conflicts`が停止理由です。`canApply`がfalseなら終了コード1で停止します。終了コード0だけで配置済みと判断せず、`current: true`と`pending: false`を確認してください。

指示には管理ルート・project、devlow・recall・3つのCLIスキルへのリンクを設定します。変更前のTasks登録、小規模でもタスクを残すこと、既存タスクの再利用、読み取り専用依頼では書き込まないことを定めます。タスク未登録の編集を機械的に禁止する機能ではなく、AIが読む作業手順です。

配布元は通常このCLIの配置から求めます。単独のCLIなど必要なスキルがない環境では、8スキル・3CLI・指示テンプレートを含むkotoのルートを`--source /absolute/path/to/koto`で明示してください。指示は配布元への絶対パスを参照するため、配布元を削除・移動した場合は、新しい場所をsourceに指定して再適用します。スキルのコピーやプラグイン設定の変更は行いません。

管理ルート内では、ルート自体（defaultのみ）か、選択projectの`workspaces/<project>/`配下へ配置できます。別projectの作業場所、`.space`・`repositories`内、共通の`workspaces/`直下には配置しません。外部の既存リポジトリもtargetとして明示できます。指示ファイル、管理記録、管理ルート内の経路にあるシンボリックリンクは拒否します。指示に埋め込むパスでは制御文字とバッククォートを使えません。

既存ファイルでは`<!-- koto:setup:koto:<product>:start -->`から対応するendまでだけを管理し、その外の内容とファイルのrwx権限を保持します。前回配置時と異なる管理部分の編集・削除、不正・重複したマーカーは衝突として止めます。今回配置する内容に既に完全一致する場合は管理記録へ採用できます。管理記録は`.space/<project>/instructions/<targetのSHA-256>/<product>.json`です。

旧setupの指示は、target内の`.space/setup/koto-<product>.json`のハッシュと一致すれば更新できます。旧記録と他の配置物は残します。旧setupのpendingやロックがある場合は、元の版で処理を完了してから進めてください。元の記録がない既存ブロックや独自編集は自動的に取り込みません。内容を確認せず、記録やマーカーを消して衝突を回避しないでください。

applyは最新の内容を再確認し、管理ルートの`.space/monorepo.lock`とtargetの`.koto-instructions.lock`で排他します。旧setupの記録先がある場合はその`koto.lock`も使います。ロックが残った場合はPID・実際の処理を確認し、停止を確認できたものだけを除いてください。強制上書きはありません。

指示ファイルと管理記録の保存が途中で失敗した場合はPARTIAL_FAILUREを返し、管理記録の隣に`<product>.pending.json`を保持します。同じ対象と配布元でstatusを確認し、原因解消後にapplyを再実行します。途中に別の編集が入ると、ブロック外の編集も含めて停止します。pendingは直接編集・削除せず、保存時の内容と追加編集を保全してから解決してください。

通常のローカルファイルシステムを対象とし、この排他を使わない他の編集ソフトとの同時書き込みを完全には防げません。更新後の指示はGit上の変更になります。保存・共有は利用先の方針に従い、Worktreeの片付けでも通常の未保存ファイル保護が適用されます。配置成功とクライアントによる読込は別なので、実際に利用するフォルダから開始し、既存の指示や入れ子の指示との整合も確認してください。

`--json` は標準出力に1つのJSONを返します。

```json
{"ok":true,"data":{"root":"/path/to/my-workspace","project":"default","changed":false}}
```

失敗時は `{"ok":false,"error":{"code":"...","message":"..."}}` を返します。必要に応じて `error.details` も付与します。`doctor` の不整合は `{"ok":false,"data":{"healthy":false,...}}` で返します。

終了コードは成功が0、操作失敗・不整合が1、コマンドやオプションの誤りが2です。通常表示は読みやすく整形したJSONです。`status` や `workspace show` の成功は照会の完了を意味し、対象の健全性は `observed`、`ready`、`problem` で判断してください。`repo list/show` は登録情報だけを返します。

`phase` は作成処理の状態（`pending` / `ready`）、`observed` は実体の確認結果（`ready` / `unavailable`）です。`dirty` は未コミットの変更の有無、`baseDistance` の `behind` / `ahead` は取得済みの開始元ブランチとのコミット数の差です。変更があるだけでdoctorの不整合にはなりません。

## 再実行と登録解除

同じ入力によるsetup・プロジェクト追加・repo add・workspace createは再実行できます。作業環境の再実行では既存の編集を保持し、別のリポジトリ構成や作業ブランチで同じタスクIDを使おうとすると拒否します。`repo add` の再実行は、取得済みなら更新取得を行いません。

複数リポジトリの途中で失敗すると `PARTIAL_FAILURE` を返し、`error.details` に各リポジトリの状態と原因コードを示します。完了済みの作業場所を保持するので、原因を解消して同じコマンドを再実行してください。完了済みの作業場所が消失・変更された場合は自動作り直しをせず、実体を確認するまで停止します。

`LOCKED` は別のCLI書き込みが管理ルートを使用している状態です。まず終了を待って再実行してください。異常終了後に残った場合に限り、`.space/monorepo.lock` に記録されたプロセスと処理が停止していることを確認してから、そのロックファイルを取り除けます。Gitが作ったロックは別物なので、まとめて削除しないでください。

`repo remove` は登録だけを解除し、結果の `retainedPath` にGitデータを残します。同じID・取得元で再登録できます。管理情報またはGit上に利用中のWorktreeがあれば `IN_USE` で停止します。作成途中の作業環境も利用中に含みます。プロジェクト削除とGit実データの削除は扱いません。

## 作業場所の片付け

対象のエディターでの作業・開発サーバー・他のAIによる書き込みを停止し、まずプレビューを確認してください。CLIのロックは、CLIを通さない書き込みを止めるものではありません。

```sh
koto-monorepo workspace remove task-001 --root /path/to/my-workspace --project client --dry-run --json
koto-monorepo workspace remove task-001 --root /path/to/my-workspace --project client --json
```

対象は指定タスクの全Worktreeです。全件を検査し、問題があれば削除を始めません。プレビューでもoriginから更新を取得し、リモート追跡情報を更新します。作業ファイルと管理JSONは変更しません。プレビュー結果の `canRemove` がfalseなら終了コード1、実行時の事前検査で止まる場合は `CLEANUP_BLOCKED` を返します。`repositories` または `error.details.repositories` に理由を返します。

以下の場合は削除を止めます。

- 未コミットの変更、未追跡ファイル、`.gitignore`等で無視されたファイルがある。
- HEADが現在のoriginのどのブランチにも含まれない、または通信に失敗して保存を確認できない。
- GitがWorktreeをロックしている、merge・rebase等が進行中、submoduleを含む。
- assume-unchangedやskip-worktreeにより変更が隠れる可能性がある。
- 作成未完了、パス・所有情報・Git登録に不一致がある。

未送信コミットは通常のGitで保存してから再実行してください。リモートでsquashやrebaseされた場合、内容が反映済みでも元のコミットを確認できず停止することがあります。不要な無視対象ファイルも、内容を確認して処分してから再実行してください。強制削除オプションはありません。

削除中の一部失敗は `PARTIAL_FAILURE`、状態照会では `removing: true` を返します。原因を解消して同じremoveを再実行すると、Gitの登録・パス・保持したブランチを照合して残りを処理します。この間のcreateは `REMOVAL_IN_PROGRESS` で拒否します。異常終了時にロックが残った場合は、前節のロックの扱いに従ってください。

成功時は `changed: true`、既に登録がなければ `changed: false` です。結果の `retainedBranches` が残したブランチです。Bare Repositoryとリモートのブランチは削除しません。タスク直下にメモ等があればその親ディレクトリを保持し、`parentRetained: true` を返します。同じタスクIDを新規作成する際は、保持したブランチ名との競合を避けるため新しい `--branch` を指定してください。

管理対象のパスやGit保存領域にあるシンボリックリンクは拒否します。通常のソースコード中のシンボリックリンクは対象外です。CLIのプロジェクト選択やロックは、別のOSユーザーやCLIを介さない書き込みを隔離するものではありません。必要なアクセス制御は実行環境で設定してください。
