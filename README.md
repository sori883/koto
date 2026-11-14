# koto

**koto ( Knowledge-Oriented Task Orchestration )**

**AIと開発を進めるための手順と、作業・知識の管理機能をまとめた、Codex・Claude Code・GitHub Copilot in VS Code向けプラグインです。**

「何を作るかを整理する」「実装して確かめる」「なぜその設計にしたかを残す」といった作業を支援します。途中で会話や担当が変わっても、記録を手がかりに続きを進められます。

機能は「スキル」として提供します。スキルは、AIが作業するときに読む手順書です。利用者は日本語で依頼し、AIが必要な手順や付属のコマンドを使います。

## できること

| やりたいこと | 機能 |
| --- | --- |
| 機能追加や修正を、依頼の整理から完了報告まで進めたい | **devlaw**：開発の原則と進め方を定め、調査・設計・実装・検証などを進める |
| 大きな仕事を分け、進捗を把握したい | **tasks**：タスク、依存関係、進捗、成果物参照、中断・引き継ぎのcheckpointを管理する |
| 既存のコードを理解したい | **how / why**：「どう動くか」「なぜこの設計にしたか」を根拠とともに調べる |
| システムの説明資料を作りたい | **system-blueprint**：コードや設定から、構成と動作を説明する文書を作る |
| 設計や判断理由を、次の開発でも参照したい | **memory（OKF）**：知識をMarkdownで保存・検索・更新する |
| タスク化していない調査の続きを残したい | **savepoint**：「ここまで残して」と頼んだときに、分かったこと・未確認事項・次の操作を残す |
| 作業の現在地を取り戻し、仕組みを理解したい | **recall / teach**：記録と現在の状態を照合し、仕組みと理由をつなげて説明する |
| 変更の影響や見落としを確認したい | **blast-radius / interrogate**：影響経路と安全性の前提を確かめ、独立した指摘を照合する |
| 不具合を再現し、検証を繰り返せるようにしたい | **tdd / create-verification-skill / maintain-verification-skill**：失敗テストから修正し、アプリ専用の検証手順を作成・更新する |
| 判断の経緯を追いたい | **show-me-your-work**：判断ログを追記・訂正し、証拠と照合する |
| コードコメントにある理由や制約を知識として残したい | **no-comments**：必要な知識をOKFへ保存し、`code_refs`でコードと結び付けてからコメントを整理する |

たとえばdevlawでは、次の工程から依頼に必要なものを選びます。

```text
依頼整理 → 調査 → 設計 → 計画 → 実装 → 検証 → レビュー → 引き渡し
```

小さな修正では工程をまとめ、大きな変更では設計や計画を分けます。「設計まで」「レビューだけ」という依頼にも対応し、レビューだけなら指摘を報告して終了します。目的や条件に重要な不明点があれば、AIが質問して確認します。

分担が必要なときの担当として、開発作業を進める **devlaw-worker** と、コメントの知識を保存して整理する **comment-curator** を同梱しています。担当へ渡す範囲と、参照するスキル・既存の判断をそろえて使います。

## 必要に応じて組み合わせる外部スキル

文章の推敲や個人向けの作業支援には、次の外部スキルを選べます。利用する環境への導入方法と必要な実行環境は、各配布元の案内を確認してください。

| やりたいこと | スキル | 配布元・紹介記事 |
| --- | --- | --- |
| AIが生成した日本語を、意味や条件を保って推敲したい | yomiyasu | [nanaism/yomiyasu](https://github.com/nanaism/yomiyasu) |
| 日本語の文書を書き、表現や構成を見直したい | natural-japanese | [coji/natural-japanese](https://github.com/coji/natural-japanese) |
| 提案書などの主張・根拠・前提を点検したい | critical-thinking | [coji/natural-japanese](https://github.com/coji/natural-japanese) |
| 説明を組み立ててから、意味を保って短くしたい | explain-before-shorten | [Kazuki Otaの紹介記事](https://zenn.dev/microsoft/articles/explain-before-shorten) |
| 技術文書を構成し、文章や会話の説明を整えたい | technical-writing / unslop / bro | [pstack](https://github.com/cursor/plugins/tree/main/pstack) |
| 作業経験や自分の進め方をスキルにしたい | reflect / automate-me | [pstack](https://github.com/cursor/plugins/tree/main/pstack) |

kotoの開発フローは標準スキルだけで実行できます。外部スキルを使う場合は、対象の文書や作業記録、目的、守る条件を渡し、返された結果を元の根拠と照合します。

## 使い始める

Codex・Claude Codeでは、プラグイン方式のほかに、**プロジェクトへ全スキルを実ファイルで配置する方式**も選べます。Codexは`.agents/skills/`、Claude Codeは`.claude/skills/`へ配置し、チームでGit管理できます。プラグインの登録は不要です。[プロジェクトへ直接導入する手順](docs/distribution.md#全スキルをプロジェクトへ直接導入する)を参照してください。以下はプラグイン方式の手順です。

### 1. プラグインをインストールする

使う製品と、付属ツールを動かすための **Bun 1.4.2以上**を用意してください。Codex・Claude Codeの以下のコマンドは、それぞれのCLIを用意してターミナルで実行します。1行目は配布元の登録、2行目はプラグインのインストールです。

**Codexの場合**

```sh
codex plugin marketplace add sori883/koto --ref main
codex plugin add koto@koto
```

**Claude Codeの場合**

```sh
claude plugin marketplace add sori883/koto --scope user
claude plugin install koto@koto --scope user
```

**VS CodeのGitHub Copilotの場合**

Agent Pluginsに対応したVS Codeで、ユーザー設定（settings.json）の配布元一覧にこのリポジトリを追加します。既存の一覧がある場合は、その項目を残して追加してください。

```json
{
  "chat.plugins.marketplaces": ["sori883/koto"]
}
```

拡張機能ビューで`@agentPlugins`を検索し、`koto`をインストールします。Claude Codeと同じ配布物を利用できます。表示されない場合は`chat.plugins.enabled`を確認してください。[ローカル配布物からの導入と詳しい手順](docs/distribution.md#vs-codeのgithub-copilotへ導入する)も用意しています。

インストール後は、作業したいプロジェクトで新しい会話を開きます。

### 2. プロジェクトを初期設定する

AIに次のように依頼します。

```text
kotoのsetupを使って、今開いているこのプロジェクトに初期設定を適用してください。
```

setupは共通の開発原則を`.space/default/memory/principles/`へ、共通知識をMemory内の対応する分類へ配置し、AIがスキルを使うための指示を追加します。既存の指示・知識・目次・履歴を保持し、変更が衝突する場合は適用前に知らせます。初期設定は、kotoを使うプロジェクトごとに行います。

Copilotでは「GitHub Copilot向けに、setupの`--product copilot`を使って初期設定してください」と伝えます。指示は`.github/copilot-instructions.md`に配置されます。更新・状態確認でも同じ製品指定を使います。

### 3. やりたいことを依頼する

目的と、どこまで進めてほしいかを伝えます。たとえば機能追加なら、次のように依頼できます。

```text
devlawを使って、商品一覧に名前で検索する機能を追加してください。
既存の画面構成を保ち、実装とテストまで進めてください。
```

調査や文書作成だけでも使えます。

```text
system-blueprintを使って、このプロジェクトの構成と主要な処理の流れを、
初めて参加する人向けの資料にしてください。
```

通常はAIが必要なコマンドを実行するため、利用者が各CLIの操作を覚える必要はありません。プラグイン更新後にプロジェクト内の共通文書も更新したい場合は、もう一度setupに依頼します。

## 作業の記録はどこに残る？

TasksとMemoryの記録は、作業しているプロジェクトの `.space/` に保存します。

| 保存先 | 残すもの |
| --- | --- |
| `.space/default/tasks/state.json` | タスクの目的・状態・依存関係・成果物参照と操作履歴 |
| `.space/default/tasks/<task-id>/` | 必要に応じたtask.md、設計案・計画・検証結果 |
| `.space/default/memory/` | 共通の開発原則と、OKFで管理するシステムの構成・採用した設計と理由・重要な変更の歴史 |
| `.space/default/checkpoint/` | タスクの中断・引き継ぎ時に、どこから再開するかを伝える記録 |

開発対象のコード・設定・文書・スキルを変更する仕事は、規模に関係なく編集前にTasksへ登録します。task.mdなどの詳しい文書は必要な場合だけ作成し、調査・読み取りだけの仕事は自動でタスク化しません。コード変更は原則として必要な検証とPR／MRのマージ確認後に完了とし、ユーザーが明示的に完了した場合も実際の状態を残します。

savepointは、タスクのない調査について「ここまで残して」「あとで続けるために保存して」と頼んだときだけ使います。調べていたこと、分かったことと根拠、未確認事項、次の操作を、会話または指定したファイルに残します。調査の区切りや中断だけでは自動保存しません。

作業中の試行や途中の結果はtasks側に置き、後からシステムを理解するために必要な結論をOKFへ残します。たとえば「テストを何回実行したか」は作業記録、「なぜこのデータ構造を採用したか」は設計の知識として整理します。

## 詳しく知りたいとき

- [開発作業の全体フロー](skills/devlaw/references/workflow.md)：工程の選び方と成果物
- [導入・更新の詳細](docs/distribution.md)：ローカルからの導入やCLIの実行方法
- [目的と配布設計](docs/architecture.md)：koto自体を開発する人向けの設計方針

## TasksとMemoryを直接使う

kotoリポジトリを取得した場所では、次のように実行できます。プラグインから使う場合の入口は、配布物内のcli/tasks/tasks.ts・cli/memory/memory.tsです。

```sh
bun run tasks -- setup --root /path/to/repository --json
bun run tasks -- task add task-001 --title "APIを修正する" --operation-id add-task-001 --root /path/to/repository --json
bun run memory -- setup --root /path/to/repository --json
bun run memory -- search --for-path src/api.ts --root /path/to/repository --json
```

両CLIはBunだけで動き、実行時の外部依存を持ちません。既存リポジトリのソースを移動せず、defaultプロジェクトからルート相対で参照できます。知識の用途はshared・dev・ops、利用ログはMemoryのusage list/statsで確認できます。

旧Babelがある利用先は、[setupの移行手順](skills/setup/references/setup.md#既存の知識を移行する)を確認してください。旧orch台帳は新Tasksと形式が異なるため自動変換しません。[今回の取り込み範囲](docs/main-tasks-memory-port.md)、[Tasksの手順](cli/tasks/README.md)、[Memoryの手順](cli/memory/README.md)を参照してください。
