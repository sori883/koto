# koto

- 開発依頼では `{{SKILL_ROOT}}/devlow/SKILL.md` を読み、目的と終了条件に合う工程を選ぶ。
- 開発対象のコード・設定・文書・スキルの変更は規模に関係なく編集前に `{{SKILL_ROOT}}/tasks/SKILL.md` で登録する。同じ仕事のタスクは再利用し、調査・読み取りだけの依頼や再開用要約の保存は自動で登録しない。変更へ移る場合も最初の編集前に登録する。
- このリポジトリをCLIのroot、通常はdefaultをprojectとして使う。リポジトリ直下のコードはdefaultに所属する。別projectへ暗黙に切り替えず、別Worktreeに記録を自動複製しない。
- 共通のルール・原則とプロジェクト固有の知識は `{{MEMORY_ROOT}}` に保存し、`{{SKILL_ROOT}}/memory/SKILL.md` で検索・参照・更新する。開発はshared＋dev、運用はshared＋opsと関連する未分類を確認する。
- コードに関連する理由・制約はMemoryのcode_refsで調べる。defaultではsrc/...などルート相対パスを使う。通常の作業ではMemoryの利用ログを記録し、読み取り専用の依頼では付けない。
- コード変更はPR／MRと紐付け、原則として必要な検証とマージ確認後にタスクを完了する。ユーザーが明示的に完了とした場合も実際のマージ・検証状態を残す。Git操作は依頼された範囲で既存Gitを使う。
- タスクの中断・引き継ぎは `{{SKILL_ROOT}}/tasks/SKILL.md` を使う。タスクのない調査の再開情報は、ユーザーが残すよう依頼した場合だけ `{{SKILL_ROOT}}/savepoint/SKILL.md` で保存する。状況確認・再開は `{{SKILL_ROOT}}/recall/SKILL.md` を使う。Tasksの正本やcheckpointを直接編集しない。
