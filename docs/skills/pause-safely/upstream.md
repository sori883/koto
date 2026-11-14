# checkpoint-safelyの参照元とローカライズ

確認日：2026-09-20

2026-11-14に役割を分離した。タスクの中断・引き継ぎは[tasks](../../../skills/tasks/SKILL.md#中断と引き継ぎ)へ統合し、タスクのない調査・読み取りの再開情報は[savepoint](../../../skills/savepoint/SKILL.md)へ変更した。savepointはユーザーが残すよう依頼した場合だけ使い、会話または指定ファイルに記録する。従来のcheckpoint-safelyとその案内用スキルは配布しない。継承した手順のライセンスはtasksとsavepointへ同梱する。

以下は導入当時の記録であり、現在の保存先・操作手順は[設計正本](../../architecture.md)と各スキルを参照する。

Cursorのpstackにある [Pause safely](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/poteto-mode/playbooks/pause-safely.md) を、日本語の独立した `checkpoint-safely` スキルとして導入する。参照コミットは `032be146865d973682535de75f2287da438550bf`。

元の [MITライセンス](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/LICENSE) は、配布対象の [LICENSE](https://github.com/sori883/koto/blob/16670c6aa50e6e5b08ce2ac21d9024755dbf7dee/skills/checkpoint-safely/LICENSE) に同梱する。スキル本体は [SKILL.md](https://github.com/sori883/koto/blob/16670c6aa50e6e5b08ce2ac21d9024755dbf7dee/skills/checkpoint-safely/SKILL.md)。この文書は開発者向けの保守資料として配布対象から分離する。

## 継承した動作

- 明示的な中断依頼で動作し、作業継続の指示では中断しない。
- 新しい作業を始めず、安全な区切りで停止し、進行中の委譲作業も収める。
- 現在のブランチでWIPコミットを作り、再開に必要な状態を保存する。
- 目的、進捗、検証結果、現在の状態、次の手順、関連ファイル、注意点を記録する。
- 既存の判断ログは参照し、重複転記しない。
- 保存先、コミット、作業ツリーの状態、再開時の最初の操作を報告する。

## このプロジェクトに合わせた差分

| 項目 | 変更内容 |
| --- | --- |
| 配置・言語 | playbookの一節を `skills/checkpoint-safely/SKILL.md` に独立させ、日本語で起動条件と手順を記述する |
| 保存先 | `/tmp/<slug>-resume.md` の例を、プロジェクト内の `.space/checkpoint/<slug>-resume.md` に変更する。タスク単位のMarkdownとしてGitで永続化し、OKFの検索・検証対象から分ける |
| 手順の順序 | checkpointも同じWIPコミットへ含めるため、記録の作成をコミットより先に行う。記録にはコミット前のHEADを残し、作成したコミットIDは保存後の報告に含める |
| 保存と中断 | 「保存して続けて」やコンテキスト縮約に備えた記録では、中断を推定せず、保存後に作業を継続する |
| 未コミット変更 | 他者・別タスクの変更と既存のステージ内容を保護する。分離が難しい場合はディスク上に保持し、コミットできなかった範囲を報告する |
| 失敗・制約 | Git未使用、コミット禁止、保存失敗、既知の不整合、停止未確認の処理を明記する。検証済み・停止済み・保存済みという事実を捏造しない |
| 外部操作 | 原文の既存PRに関する例外を権限の根拠にはしない。中断依頼だけでpushやPR作成などの外部操作を追加しない |
| 依存関係 | poteto-modeやshow-me-your-workの導入を必須にしない。既存の判断ログがあれば、その保存形式にかかわらず参照する |

## 検証

`skill-creator` に付属する `scripts/quick_validate.py` でスキル形式を確認し、Markdownの内部リンクと `git diff --check` を確認する。実行コードの追加はないため、CLI・OKFのテスト対象は増やさない。

手順のレビューでは、明示的な中断、継続の指示、保存後の継続、未検証の変更、他者の変更が混在する場合を確認する。形式検証は実際のエージェント動作を保証するものではなく、実運用で得た問題はこのスキルの範囲で修正する。
