# 導入・更新と配布物の生成

agent-gearはCodex・Claude Code・GitHub Copilot in VS Code用のプラグインとして導入する。CLIの実行にはBun 1.4.2以上が必要。プラグインのインストールと、プロジェクトへの共通知識・指示の配置は別の操作である。

## ローカルのプラグインを導入する

先にこのリポジトリで`bun run build`を実行し、カタログと配布物を揃える。以下の`/path/to/agent-gear`はチェックアウトしたリポジトリの絶対パスへ置き換える。

```sh
codex plugin marketplace add /path/to/agent-gear
codex plugin add agent-gear@agent-gear
```

```sh
claude plugin marketplace add /path/to/agent-gear --scope user
claude plugin install agent-gear@agent-gear --scope user
```

新しいタスク・セッションで導入したスキルを利用する。既に開いている会話のスキル一覧が自動で更新されたとは扱わない。共有・公開するときは、ソース・dist・カタログを同じ変更でmainへ反映してから、利用者にリポジトリを登録してもらう。ローカルで生成しただけでは公開されない。

## VS CodeのGitHub Copilotへ導入する

VS CodeのAgent Pluginsで、Claude Codeと同じカタログ・配布物を利用する。プラグイン対応が有効なVS Codeを使い、`chat.plugins.enabled`を確認する。[公式の導入手順](https://code.visualstudio.com/docs/agent-customization/agent-plugins)も参照する。

ローカルの生成済み配布物を試す場合は、VS Codeのユーザー設定（settings.json）の既存内容に次を統合する。パスはチェックアウト先の絶対パスへ置き換える。

```json
{
  "chat.pluginLocations": {
    "/path/to/agent-gear/dist/claude-code/agent-gear": true
  }
}
```

Copilot対応版をmainへ反映した後、Gitリポジトリから導入する場合は、既存のmarketplace一覧に次のリポジトリを追加する。

```json
{
  "chat.plugins.marketplaces": ["sori883/agent-gear"]
}
```

拡張機能ビューで`@agentPlugins`を検索し、`agent-gear`をインストールする。共用カタログはリポジトリ直下、プラグイン本体はdist配下にあるため、リポジトリ全体を単一プラグインとして指定せずmarketplaceから選択する。`Chat: Open Customizations`でプラグインと[同梱スキル](current-state.md#提供するもの)を確認し、新しいCopilotの会話で利用する。

Copilotでsetupを実行するときは、インストール先のスキルを基準に、毎回`--product copilot`を指定する。

```sh
bun /path/to/installed/plugin/skills/setup/scripts/setup.ts plan --project /path/to/project --product copilot --json
bun /path/to/installed/plugin/skills/setup/scripts/setup.ts apply --project /path/to/project --product copilot --json
bun /path/to/installed/plugin/skills/setup/scripts/setup.ts status --project /path/to/project --product copilot --json
```

指示は`.github/copilot-instructions.md`の管理ブロックへ配置する。既存内容を保持し、`CLAUDE.md`や`AGENTS.md`を新たに作成しない。Copilotで「このプロジェクトへsetupを使って導入して」と依頼する場合も、setupスキルはCopilot用の製品指定を使う。

BunはCLIを実行する環境で必要になる。WSL・Dev Container・SSH環境では、その環境からプラグインとBunへアクセスできることを確認する。スキル認識、ターミナルでのCLI実行、モデルによる自動選択は別々に確認する。今回の実機確認範囲は[Copilot対応記録](copilot-support.md)を参照する。

## プロジェクトへ配置する

導入済みの`setup`スキルに対象プロジェクトを指定する。実際のプラグインの位置を基準に、次のCLIを実行する。

```sh
bun /path/to/installed/plugin/skills/setup/scripts/setup.ts plan --project /path/to/project --json
bun /path/to/installed/plugin/skills/setup/scripts/setup.ts apply --project /path/to/project --json
```

共通知識は`.space/babel/`直下のtype別ディレクトリへ、指示はCodexならAGENTS.md、Claude CodeならCLAUDE.md、Copilotなら.github/copilot-instructions.mdの管理ブロックへ入る。Copilotは上記の通り`--product copilot`を指定する。既存の指示や独自知識、目次、履歴は保持する。プラグインを更新した後もplan・applyで利用先への変更を反映する。旧vendorからの更新方法、衝突・中断時の扱いは[setupの資料](../skills/setup/references/setup.md)を参照する。

OKF・orchはそれぞれ`skills/okf-agent-memory/scripts/okf.ts`、`skills/orch/scripts/task.ts`をBunで実行する。初回の依存準備はスキル自身のscripts内で行うため、書き込み権限が必要。OKFとnatural-japaneseの初回はネットワークまたはBunキャッシュも必要になる。利用先のworkspaceに含まれる場所ではOKFとnatural-japaneseの依存準備を拒否するため、通常のプラグインキャッシュ等、workspace外の配置を使う。

natural-japaneseは`skills/natural-japanese/scripts/japanese.ts`をBunで実行する。`lint`・`outline`・`terms`・`score`は入力ファイルを読み取り、結果を標準出力に返す。使えるオプションは[CLIの資料](../skills/natural-japanese/references/cli.md)を参照する。

## 開発時の生成と検証

```sh
bun install --frozen-lockfile --ignore-scripts
bun skills/okf-agent-memory/scripts/okf.ts version --json
bun skills/natural-japanese/scripts/japanese.ts --help
bun run typecheck
bun run test
bun run build
bun run build:check
```

root package.jsonのversionが全製品の配布版数を決める。正本はskills・space・packaging。distとカタログは生成結果としてGit管理し、手編集しない。Copilot用テンプレートはpackaging/copilotからClaude形式の配布物へ組み込む。buildは配布対象だけを選び、docs・テスト・利用先の.space・node_modulesを含めない。Markdownの参照先を確認してから出力する。

build:checkはソースから期待する全ファイルを組み立て、内容の変更だけでなく、未追跡の追加ファイル・不足ファイルも検出する。CIでも同じ検査を行う。生成途中に異常終了した場合は、書き手の停止を確認してから`.build.lock`と一時領域を調べ、正本から再生成する。

以前のtemplates/AGENTS.mdは配布元として使わない。製品別の指示テンプレートはpackaging配下で更新する。リポジトリの.codex/agentsは開発用であり、そのまま配布物へコピーしない。
