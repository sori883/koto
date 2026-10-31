# 配布物の生成と検証

対応する配布形式はCodexとClaude Codeの2つ。現在の配布物はmonorepo・Tasks CLI、それぞれの利用手順のスキル、プラグイン定義、共通知識で構成する。以前のsetupによるプラグイン導入・更新機能は復元せず、各CLIのsetupは自身の管理領域を準備する。

## 正本と生成先

| 正本 | 生成先 |
| --- | --- |
| `packaging/codex/plugin.json` | `dist/codex/koto/.codex-plugin/plugin.json` |
| `packaging/codex/marketplace.json` | `.agents/plugins/marketplace.json` |
| `packaging/claude-code/plugin.json` | `dist/claude-code/koto/.claude-plugin/plugin.json` |
| `packaging/claude-code/marketplace.json` | `.claude-plugin/marketplace.json` |
| `space/default/` | 両製品の`dist/<製品>/koto/space/default/` |
| `cli/monorepo/` | 両製品の`dist/<製品>/koto/cli/monorepo/` |
| `skills/monorepo/` | 両製品の`dist/<製品>/koto/skills/monorepo/` |
| `cli/tasks/` | 両製品の`dist/<製品>/koto/cli/tasks/` |
| `skills/tasks/` | 両製品の`dist/<製品>/koto/skills/tasks/` |

ルートの`package.json`のversionを両製品と同梱CLIのパッケージ定義へ反映する。生成先はGitで管理し、手編集しない。カタログはそれぞれ同じリポジトリの製品別配布物を指す。CLIは入口・lib・パッケージ定義・利用手順だけを配布し、入口へ実行権限を付ける。

`skills/`がない状態でも生成できる。スキルがない場合は、存在しないディレクトリをプラグインの`skills`項目に指定しない。今後スキルを追加した場合は、既存の生成処理が`SKILL.md`を持つディレクトリと配布対象の付属ファイルを取り込む。

## 開発時の操作

Bun 1.4.2以上を用意し、リポジトリのルートで実行する。

```sh
bun install --frozen-lockfile --ignore-scripts
bun run typecheck
bun run test
bun run build
bun run build:check
```

buildは配布対象だけを選び、開発資料・テスト・利用先の`.space/`・`node_modules/`・実行時キャッシュを含めない。シンボリックリンクと参照先のないMarkdownリンクは出力前に拒否する。再生成時には、正本から削除されたファイルをdistから取り除く。

build:checkは期待する全ファイルを組み立て、内容の変更、不足、未追跡を含む余分なファイルを検出する。CIでも型検査・テスト・生成物照合を行う。生成途中の異常終了時は、書き手の停止を確認してから`.build.lock`と一時領域を調べ、再生成する。

## 検証と公開を区別する

ローカルの生成・形式確認と、クライアントによる読込・実行は別の確認対象とする。両製品のCLIを開発リポジトリ外で実行するテストを行う。Codexのapp-serverによるローカル配布物の読込と、Claude Codeのセッション限定の読込でmonorepoスキルの認識を確認した。詳細は[片付けと導入経路の検証](monorepo-cleanup-design.md#検証結果)を参照する。

別の一時フォルダの`.agents/`へCodex配布物をコピーし、Codex CLIへの自然言語依頼からスキル選択・CLI操作までを確認した。作業場所の準備、未保存ファイルの保護、片付けの結果は[実モデルの検証記録](monorepo-codex-verification.md)に記載する。導入済みキャッシュの更新、Codexデスクトップ画面の操作、Claude Codeモデルへの自然言語依頼は未確認。

monorepoはユーザーの指示により`main`から作った`develop`へ履歴を残して統合した。Tasksも`develop`から作業ブランチを切り、同じ方法で統合する。開発ブランチをGitHubへ反映することと、プラグインを正式リリースすることは区別する。版数の変更と導入済みプラグインの更新は今回の範囲に含めない。公開済みの版との違いは[現状資料](current-state.md)に記録する。
