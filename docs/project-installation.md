# プロジェクトへの実ファイル導入

2026-10-13。CodexとClaude Codeで全スキルをプロジェクトへ配置する依頼に対応する。特定スキルの選択・除外は対象外。設計方針の正本は[architecture.md](architecture.md)、利用手順は[distribution.md](distribution.md)に置く。

## 採用した構成

既存setupに`--scope project`を追加し、同じ製品別配布物のsetup-manifest.project.jsonに列挙したファイルを配置する。新しいインストーラーを作る案と比較し、パス検証、衝突検出、共有目次の統合、排他、pendingからの再開を共用できる既存setupの拡張を選んだ。プラグイン登録済みかどうかは配置処理に影響しない。

Codexは`.agents/skills/`・`.codex/agents/`、Claude Codeは`.claude/skills/`・`.claude/agents/`を使う。スキル本体・CLI・資料は全て実ファイルで配置する。正本と製品別配布物は従来の二形式を維持し、独自の第三形式や共通トップレベルCLIは追加しない。共通知識と指示は既存の配置先へ統合する。

プロジェクトの移動やGitでの共有を可能にするため、project scopeの管理ブロックはスキルとBabelをプロジェクトルートからの相対パスで参照する。通常のCLI実行には配布元を必要としない。配置済みsetupで更新・比較するときは`--source`で取得した配布物を指定する。新版自身のsetupからも更新できる。

製品別の既存管理記録に`scope: project`を保存する。既存plugin scopeからはローカル編集を照合して移行できる。project scopeへ移行後にscopeを省略すると停止し、指示がプラグイン参照へ戻るのを防ぐ。逆方向への自動移行や古いファイルの自動削除は対象外。

## 確認する境界

- 両製品のスキル・エージェントと、共有Babel・製品別指示の配置。
- 初回planの読み取り専用動作、再実行、配布元更新、利用先編集との衝突、既存スキルの保護。
- 開発リポジトリ外への導入、プロジェクトと配布元の移動後のOKF・orch実行、コピー済みsetupによる比較と更新。
- 利用先のpackage.json・lock・ルートnode_modulesを変更しないこと。
- 既存のplugin scopeとCopilot向けsetupの回帰確認。

クライアントがプロジェクトスキルを読む配置は[Codexの公式資料](https://learn.chatgpt.com/docs/build-skills#where-to-save-skills)と[Claude Codeの公式資料](https://code.claude.com/docs/en/skills#choose-where-skills-load)で確認した。実際の新規クライアントセッションでの一覧表示・モデルによる選択・エージェント起動は、この検証とは区別する。mainへの公開は行わない。

## 検証結果

- `bun test skills/setup/tests tests/distribution`: 54件成功、失敗0件。初回の新規テストではスキルが配置されないことを確認し、実装後に成功した。
- `bun run typecheck`: 成功。
- `bun run build`: 394ファイルを生成。
- `bun run build:check`: 正本と生成済み配布物の一致を確認。

新しい結合テストは、開発リポジトリ外の一つの利用先へ両製品を導入し、全スキルの全ファイルを配布物とバイト単位で照合した。プロジェクトと配布元をそれぞれ移動した後、配置済みOKFで原則を検索し、orchで台帳を初期化し、配置済みsetupに移動後の配布元を指定して比較・更新した。利用先のpackage.jsonを保持し、利用先ルートにnode_modules・bun.lockを作らないことも確認した。

通常のプラグイン方式はCodex・Claude Code・Copilotの既存結合テストで確認した。ソースの検証と自動テストまでの完了であり、クライアントのスキル一覧、自動選択、エージェント起動の確認やリモート公開は未実施。
