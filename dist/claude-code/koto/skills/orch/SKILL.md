---
name: orch
description: タスクの分割・依存・進捗管理をTasksへ引き継ぐ。orchを指定された場合に、同じ仕事のタスクと現在の開発フローを確認する。
---

# タスクを管理する

[Tasks](../tasks/SKILL.md)のCLIと手順を使う。開発全体の進め方は[devlow](../devlow/SKILL.md)を読む。

既存の同じ仕事を再利用し、依存関係・成果物・checkpointをTasksに記録する。複数担当への分担と成果の受け入れは、[複数タスクの管理](../devlow/references/orchestrate.md)に従う。Tasksのcompletedだけで親の受け入れを済ませたと判断しない。

旧unit台帳が渡された場合は読み取り専用で内容と実態を確認し、移行する対象を明示してから新しいタスクへ記録する。旧CLIを起動せず、旧台帳を新形式として読み込ませたり削除したりしない。旧操作ID・状態・承認の意味を機械的に置き換えない。
