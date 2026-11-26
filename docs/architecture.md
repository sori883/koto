# kotoの目的と配布設計

koto（コト）は **Knowledge-Oriented Task Orchestration** の略であり、知識の継承と、タスクの分割・管理を名前の軸とする。

kotoは、Claude Codeで開発するときの作業スタイル（作業の進め方、原則、委任の仕方、検証の仕方）を、Claude Codeプラグインとして配布するためのリポジトリである。

この文書を、何を作るか・どこに置くか・どう配布するかを判断するための設計方針の正本とする。以下は目標の構成であり、すべてが実装済みという意味ではない。

## 作り方の方針

**[pstack](https://github.com/cursor/plugins/tree/main/pstack)を参照元として土台を作り、その上にkoto独自の概念を載せる。**

1. 土台：pstackの構成（入口となる中核スキル、作業種別ごとのプレイブック、原則、委任用エージェント、単体で使えるスキル）を参照し、Claude Code向けに書き起こす。
2. koto独自の概念：土台ができてから、Memory（知識の継承）とTasks（タスクの分割・管理）を順に載せる。載せ方は各段階で設計し、この文書へ追記する。

pstackは取り込まず、参照して書き起こす。

- pstackはCursor向けに書かれており、Cursor固有の機能・ツール名・作者個人のやり方を前提にした部分が多い。kotoはClaude Codeのツール名と機能で最初から書く。Cursorの名前を読み替える仕組み（pstackの`docs/harness/claude-code.md`に相当するもの）は作らない。
- 中核スキルとプレイブックは、Memory・Tasksを組み込む前提で書き直すため、上流との差分追従を目的にしない。
- ほぼそのまま使え、koto独自の概念とほとんど関わらないスキルに限り、個別にコピーして調整してよい。その場合は、pstackのMIT Licenseの著作権表示と許諾表示を配布物に含める。

参照したpstackの版と、スキルごとの採否は[pstack参照記録](pstack/reference.md)に置く。

## 対象製品

対象はClaude Codeだけとする。Codex・GitHub Copilot・Cursor向けの配布物は作らない。

配布物では、Claude Codeが提供するツール・機能を名前のまま使う（`Agent`、`AskUserQuestion`、`Skill`、タスクリスト、`isolation: "worktree"`など）。Claude Codeにない機能を前提にした手順は作らない。

## 製品と開発環境を区別する

このリポジトリで開発するのは、別のプロジェクトへ配布して使う道具である。開発リポジトリ内だけで動くことを完成条件にしない。配布元への絶対パス、配布物に含まれないファイルへのリンクに依存させない。

リポジトリ内のスキル・エージェント定義・原則は開発対象であり、その指示をこのリポジトリでの作業ルールとして適用しない。開発時の指示はルートの[AGENTS.md](../AGENTS.md)とユーザーの指示に従う。ルートの`AGENTS.md`・`.agents/`・`.codex/`・`.claude/`・`.serena/`・`.vscode/`は、このリポジトリで作業するためのハーネスであり、配布物ではない。

配布物には、その配布物を保守する人向けの記述を一切含めない。配布するスキル本文・参照資料・エージェント定義等には、利用者または利用先で実行するAIに必要な内容だけを記載する。保守方針、pstackとの差分、変更経緯、開発時の検証記録などは、配布対象外の`docs/`で管理する。

配布物の本文は日本語で書く。ツール名・コマンド・ファイル名などの識別子は原語のままにする。

## 配置

| 場所 | 役割 |
| --- | --- |
| `.claude-plugin/marketplace.json` | このリポジトリをClaude Codeのマーケットプレイスとして公開する定義。`plugin/`を`koto`プラグインとして載せる |
| `plugin/` | 配布するプラグインの正本。ここにあるファイルだけが利用先へ届く |
| `plugin/.claude-plugin/plugin.json` | プラグインの名前・版・説明 |
| `plugin/skills/<name>/SKILL.md` | スキル。スキル専用の参照資料は同じフォルダの`references/`、実行コードは`scripts/`に置く |
| `plugin/agents/<name>.md` | 委任用のサブエージェント定義 |
| `docs/` | 設計・参照記録・検証記録など、保守者向けの資料。配布しない |
| `tests/` | 配布するスクリプトのテスト。保守者向けであり、配布しない |

正式名称、プラグイン名、マーケットプレイス名は`koto`とする。GitHubの参照先は`sori883/koto`とする。

利用者は次の手順で導入する。

```bash
/plugin marketplace add sori883/koto
/plugin install koto@koto
```

## 土台の構成

pstackの構成を参照し、次の層で組み立てる。

| 層 | 役割 | pstackでの対応 |
| --- | --- | --- |
| 中核スキル（`koto-mode`） | 作業の入口。依頼をプレイブックに対応付け、手順をタスクリストへ写し、必要なスキル・原則・委任を呼び出す | `poteto-mode` |
| プレイブック | 作業種別（調査、不具合修正、機能追加、リファクタリング、PR作成など）ごとの手順。中核スキルの`playbooks/`に置く | `poteto-mode/playbooks/` |
| 原則 | 一つの原則を一つのスキルにまとめる。中核スキルは原則の索引を持ち、適用する原則の本文を読む | `principle-*` |
| 委任用エージェント | 中核スキルが作業を任せるサブエージェント。作業前に中核スキルを読む | `poteto-agent` |
| 単体スキル | 中核スキルから呼ばれ、利用者が直接使うこともできるスキル（how、why、interrogate、tddなど） | その他のスキル |

すべてのスキルは、モデルがSkillツールで呼び出せる通常のスキルとし、frontmatterに`disable-model-invocation: false`を書く。pstackはほぼすべてのスキルを`true`にしているが、Claude Codeでは`true`のスキルをモデルがSkillツールで呼べず、中核スキルから他のスキルや原則へ進めなくなるため、kotoでは採らない。中核スキルのfrontmatterには`name: koto-mode`を書く。プラグインのスキルの正式な呼び名は`/koto:koto-mode`である。`name`を書くと、同じ名前の他のコマンドがない限り`/koto-mode`でも呼べる。

スキルが使うスクリプトは、Bunで動くTypeScriptで書き、シェルスクリプトは使わない。外部パッケージに依存せず、`bun <スクリプトのパス>`だけで動くようにする。外部パッケージが要るときは、初回の実行時に依存を入れる仕組み（`koto-mode/scripts/bootstrap.ts`）に従う。スクリプトのテストは`tests/`に置き、配布物に含めない。

スキルには、できるだけ自由に進める働き方を書く。MCPツールの利用や外部への操作をスキルの本文で制限しない。止めるべき操作は、権限設定、組織の管理設定、MCPを接続しないことなど、プラグインの外で止める。

モデルの選択は、Claude Codeの`Agent`ツールが受け付ける`model`・`effort`で、役割ごとに指定する。役割と既定の値は中核スキルの「サブエージェント」の節に書く。委任用エージェントの既定は、エージェント定義のfrontmatterの`model`・`effort`に書く。役割ごとのモデル設定を書き出すセットアップスキル（pstackの`setup-pstack`）は中核に含めない。利用先の保存領域を作る`setup`スキルはこれとは別のものである（「利用先の保存領域」の節）。作るかどうかは後で判断する。

## 利用先の保存領域（`.space/`）

kotoが利用先のプロジェクトに残すファイルは、プロジェクトのルートの`.space/`にまとめる。セッションや作業ツリーより長く残す記録の置き場所であり、`/tmp`や作業フォルダの直下には置かない。

`.space/`は`setup`スキルが作る。`setup`は何度実行しても同じ結果になり、既存のファイルを上書き・削除しない。プロジェクトのルートは、Gitリポジトリならその最上位、そうでなければ利用者が指定したフォルダとする。

```text
{project}/.space/
  tickets/
    <ticket-id>/
      ticket.md        チケット本体
      decisions.tsv    このチケットの判断ログ（show-me-your-work）
```

- `tickets/`は、`ticket.md`も`decisions.tsv`もコミットする。チケットと判断の経緯は、利用者やチームが共有し、後からレビューする情報である。
- `setup`は`.gitignore`を作らない。

## Tickets

Tickets（チケットの管理）は、セッションをまたいで残る仕事の単位を扱う。名前の由来の「Task」とは別に、機能の名前はTicketsとし、Claude Codeのタスクリスト（セッション内の手順）と呼び分ける。

| 記録 | 答える問い | 置き場所 |
| --- | --- | --- |
| チケット | 何を、なぜ、どこまでやれば終わりか。いまどの状態か。中断したならどこから再開するか | `.space/tickets/<ticket-id>/ticket.md` |
| 判断ログ | どう進め、何を選び、何を根拠にしたか | `.space/tickets/<ticket-id>/decisions.tsv` |
| タスクリスト | このセッションでどの手順まで進んだか | Claude Codeのタスクリスト |

チケットは目的、終了条件、状態、依存関係、成果物への参照、checkpoint（現在地と次の操作）を持ち、判断の履歴は持たない。形式はMarkdownとし、`ticket.md`を正本とする。AIも人も本文を直接編集する。`ticket`スキルの補助スクリプト（`scripts/ticket.ts`）は、チケットの作成、frontmatterを読んだ一覧、状態と`updated`の書き換えだけを行い、ファイルの外に台帳や状態を持たない。

状態は`pending`、`running`、`paused`、`done`、`cancelled`の5つとする。子チケットは`parent`で親を指し、フォルダは入れ子にしない。依存先が`done`でなければ`running`にできず、子チケットが終わっていなければ親を`done`にできない。

チケットの形式と操作手順は`ticket`スキルに書く。チケットを作るかどうかは、koto-modeのプレイブックごとに決める。チケットを作らないプレイブックには、チケットについて何も書かない。

| 区分 | プレイブック | チケットの扱い |
| --- | --- | --- |
| 作る | Bug fix、Feature、Refactoring、Perf issue、Visual parity、Hillclimb、Autonomous run、Multi-phase plan、Autopilot-full、Autopilot-stack | 手順の中でチケットを作るか、同じ仕事の既存のチケットを使う。目的と終了条件を書く。Visual parity・Multi-phase plan・Autopilotは、全体を親、担当やPRごとを子にする |
| 使う | Pause safely、Session pickup、Opening a PR | 作業のチケットがあれば読み書きする。checkpointの更新、`paused`・`running`への変更。Opening a PRは、PRのURLを書いてチケットを`done`にする |
| 関わらない | Babysit、Shipping、Investigation、Runtime forensics、Trace forensics、Prototype、Worktree cleanup、Authoring a skill、Eval | 何も書かない |

PRで出す仕事のチケットは、PRを開いた時点で`done`にし、その更新をPRに含める。チケットは作業ブランチ上のファイルなので、マージ後に閉じようとすると`main`へ直接コミットすることになるからである。PRを開いた後のレビュー対応やマージではチケットに触れず、差し戻されて作業し直すときは`pending`に戻す。

show-me-your-workとHillclimbは、判断ログをチケットのフォルダの`decisions.tsv`に、show-me-your-workの列で書く。

## 検証

配布物の完成条件は、利用先のClaude Codeでプラグインとして読み込めて、スキル・エージェントが意図どおりに動くことである。

- 構文：`claude plugin validate`でマーケットプレイスとプラグインの定義を検証する。
- スクリプト：`bun test tests`で、配布するスクリプトのテストを実行する。
- 読み込み：`claude --plugin-dir plugin`で起動し、スキル・エージェントが一覧に出ることを確認する。
- 振る舞い：中核スキルとプレイブックは、実際の依頼で意図した手順を踏むかを確認する。

## 変更時の判断

現行実装と、この文書の設計の差は、未実装・移行事項として扱う。現状だけを根拠に設計を変えない。ユーザーから設計方針を変更する指示があった場合は、この文書を更新する。
