# 導入・更新と配布物の生成

kotoはCodex・Claude Code・GitHub Copilot in VS Code用のプラグインとして導入できる。Codex・Claude Codeでは、プラグインを登録せずプロジェクトへ全スキルを実ファイルで配置する方式も選べる。OKF・orch・setupの実行にはBun 1.4.2以上、natural-japaneseの検査スクリプトにはuvとPython 3.10以上が必要。yomiyasuの検査スクリプトはPython 3の標準ライブラリで動作する。プラグインのインストールと、プロジェクトへの共通知識・指示の配置は別の操作である。

## 全スキルをプロジェクトへ直接導入する

配布物を含むリポジトリを取得する。以下の`/path/to/koto`は取得先、`/path/to/project`は導入先に置き換える。プラグインの登録は不要。ローカル開発版を使う場合は、先に配布元で`bun run build`を実行する。

```sh
git clone --branch main https://github.com/sori883/koto.git /path/to/koto
```

Codex向けの導入は次の順で行う。planのconflictsが空であることを確認してapplyする。

```sh
bun /path/to/koto/dist/codex/koto/skills/setup/scripts/setup.ts plan --project /path/to/project --scope project --json
bun /path/to/koto/dist/codex/koto/skills/setup/scripts/setup.ts apply --project /path/to/project --scope project --json
bun /path/to/koto/dist/codex/koto/skills/setup/scripts/setup.ts status --project /path/to/project --scope project --json
```

Claude Codeでは配布元の`dist/codex/koto`を`dist/claude-code/koto`に読み替える。全スキルの配置先はCodexが`.agents/skills/`、Claude Codeが`.claude/skills/`。エージェントはそれぞれ`.codex/agents/`・`.claude/agents/`へ、共通知識は共通の`.space/babel/`へ配置する。指示はAGENTS.md・CLAUDE.mdの管理ブロックに入る。同じプロジェクトに両製品を導入できる。

導入後は対象プロジェクトで新しい会話を開く。スキル・CLI・資料はプロジェクト内で完結し、指示の参照先は相対パスになる。配布元のコピーは通常のCLI実行には不要。更新時は新版の製品別配布物を取得し、同じplan・apply・statusを実行する。コピー済みsetupから比較・更新する場合は`--source /path/to/koto/dist/codex/koto`等を追加する。

スキルの選択・除外、Copilotへのプロジェクト導入、プラグインの自動無効化は行わない。既存ファイルが異なる場合やローカル編集がある場合は衝突として止める。初期配置済みのプロジェクトでは`--scope project`を毎回指定する。[setupの手順](../skills/setup/references/setup.md#全スキルをプロジェクトへ配置する)に更新・重複時の扱いを記載した。

## ローカルのプラグインを導入する

先にこのリポジトリで`bun run build`を実行し、カタログと配布物を揃える。以下の`/path/to/koto`はチェックアウトしたリポジトリの絶対パスへ置き換える。

```sh
codex plugin marketplace add /path/to/koto
codex plugin add koto@koto
```

```sh
claude plugin marketplace add /path/to/koto --scope user
claude plugin install koto@koto --scope user
```

新しいタスク・セッションで導入したスキルを利用する。既に開いている会話のスキル一覧が自動で更新されたとは扱わない。共有・公開するときは、ソース・dist・カタログを同じ変更でmainへ反映してから、利用者にリポジトリを登録してもらう。ローカルで生成しただけでは公開されない。

## VS CodeのGitHub Copilotへ導入する

VS CodeのAgent Pluginsで、Claude Codeと同じカタログ・配布物を利用する。プラグイン対応が有効なVS Codeを使い、`chat.plugins.enabled`を確認する。[公式の導入手順](https://code.visualstudio.com/docs/agent-customization/agent-plugins)も参照する。

ローカルの生成済み配布物を試す場合は、VS Codeのユーザー設定（settings.json）の既存内容に次を統合する。パスはチェックアウト先の絶対パスへ置き換える。

```json
{
  "chat.pluginLocations": {
    "/path/to/koto/dist/claude-code/koto": true
  }
}
```

Copilot対応版をmainへ反映した後、Gitリポジトリから導入する場合は、既存のmarketplace一覧に次のリポジトリを追加する。

```json
{
  "chat.plugins.marketplaces": ["sori883/koto"]
}
```

拡張機能ビューで`@agentPlugins`を検索し、`koto`をインストールする。共用カタログはリポジトリ直下、プラグイン本体はdist配下にあるため、リポジトリ全体を単一プラグインとして指定せずmarketplaceから選択する。`Chat: Open Customizations`でプラグインと[同梱スキル](current-state.md#提供するもの)を確認し、新しいCopilotの会話で利用する。

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

OKF・orchはそれぞれ`skills/okf-agent-memory/scripts/okf.ts`、`skills/orch/scripts/task.ts`をBunで実行する。初回の依存準備はスキル自身のscripts内で行うため、書き込み権限が必要。OKFの初回はネットワークまたはBunキャッシュも必要になる。利用先のworkspaceに含まれる場所ではOKFの依存準備を拒否する。プロジェクト導入では`.agents/skills/`または`.claude/skills/`がworkspaceの対象にならないようにする。通常の`packages/*`構成には含まれない。実行時にできるnode_modules・Pythonキャッシュ等はGit管理から除外する。

natural-japaneseは原版のPythonスクリプトをuvで実行する。`lint.py`・`outline.py`・`terms.py`は入力ファイルを読み取り、結果を標準出力に返す。スクリプト内の依存定義に従ってuvが実行環境を準備するため、初回はネットワークまたはuvキャッシュが必要。診断のscoreは[スキルの手順](../skills/natural-japanese/references/diagnose.md)として実行する。任意の`semantic.py`は追加の依存とモデルの取得を伴う。詳しくは[スキル本文](../skills/natural-japanese/SKILL.md)を参照する。

```sh
uv run /path/to/installed/plugin/skills/natural-japanese/scripts/lint.py /path/to/draft.md --json
uv run /path/to/installed/plugin/skills/natural-japanese/scripts/outline.py /path/to/draft.md --json
uv run /path/to/installed/plugin/skills/natural-japanese/scripts/terms.py /path/to/draft.md --json
```

yomiyasuは文章の表現・Markdownを`yomiyasu_lint.py`で、推敲前後の語句・文末・構造の変化を`yomiyasu_diff.py`で確認する。どちらも入力を読み取り、結果を標準出力に返す。意味を保持したかの最終判断は[スキル本文](../skills/yomiyasu/SKILL.md)に従って行う。

```sh
python3 /path/to/installed/plugin/skills/yomiyasu/scripts/yomiyasu_lint.py /path/to/draft.md --json
python3 /path/to/installed/plugin/skills/yomiyasu/scripts/yomiyasu_diff.py /path/to/before.md /path/to/after.md --json
```

## 旧名で導入済みの場合

`agent-gear`のプラグイン登録と、各プロジェクトのsetup管理は別に切り替える。旧プラグインを無効にし、新しい配布元`sori883/koto`から`koto@koto`を導入して、新しい会話でsetupのplan・apply・statusを実行する。旧名の管理記録・指示の引き継ぎと、衝突時の扱いは[setupの切り替え手順](../skills/setup/references/setup.md#agent-gearからの切り替え)を参照する。

ローカルパスで登録している場合は、新しいclone先を登録する。cloneだけでは各製品の登録先や他プロジェクトのsetup参照は更新されない。既存の知識やタスク記録は残す。リポジトリ自身の改名・cloneの順序は[改名記録](rename-koto.md)を参照する。

## 開発時の生成と検証

```sh
bun install --frozen-lockfile --ignore-scripts
bun skills/okf-agent-memory/scripts/okf.ts version --json
uv run skills/natural-japanese/scripts/lint.py --help
python3 skills/yomiyasu/scripts/yomiyasu_lint.py --help
bun run typecheck
bun run test
bun run build
bun run build:check
```

root package.jsonのversionが全製品の配布版数を決める。正本はskills・space・packaging。distとカタログは生成結果としてGit管理し、手編集しない。Copilot用テンプレートはpackaging/copilotからClaude形式の配布物へ組み込む。buildは配布対象だけを選び、docs・kotoのテスト・利用先の.space・node_modules・__pycache__・.venvを含めない。natural-japaneseは原版の校正スクリプトとfixturesも同梱する。Markdownの参照先を確認してから出力する。

build:checkはソースから期待する全ファイルを組み立て、内容の変更だけでなく、未追跡の追加ファイル・不足ファイルも検出する。CIでも同じ検査を行う。生成途中に異常終了した場合は、書き手の停止を確認してから`.build.lock`と一時領域を調べ、正本から再生成する。

以前のtemplates/AGENTS.mdは配布元として使わない。製品別の指示テンプレートはpackaging配下で更新する。リポジトリの.codex/agentsは開発用であり、そのまま配布物へコピーしない。
