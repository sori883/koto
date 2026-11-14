# 標準配布をコア7スキルに絞る

2026-11-14。ユーザーの「補助全部消す」という指示により、標準配布をdevlaw・tasks・memory・use-principles・savepoint・recall・setupの7個に絞る。no-commentsも削除対象とする。設計の正本は[architecture.md](../architecture.md#標準スキルと外部スキル)。

## 削除するもの

| 対象 | 外す専門機能 |
| --- | --- |
| how・why・teach | 構成と採用理由の専門調査、理解を助ける説明 |
| blast-radius・interrogate | 影響範囲の専門調査、複数担当によるレビューの専用手順 |
| tdd | 失敗テストから修正する専用手順 |
| create-verification-skill・maintain-verification-skill | 利用先専用の検証スキルの作成・保守 |
| system-blueprint | 構成・動作・設計背景を文書群へ整理する専用手順 |
| no-comments・comment-curator | コメントの知識を先に保存し、照合してから削除する専用手順と担当 |
| show-me-your-work | 判断ログの追記・訂正・照合の専用手順 |

11スキルのソースと両製品の生成物、comment-curatorの両形式を削除する。旧名の案内や別の保管用スキルは作らない。過去の取込・評価記録はdocsに保持し、削除されるソースへの参照は削除前のコミット `af3d041b20c4294011dbf1fd1eed26958b084086` に固定する。

## 残る工程と接続

devlawの調査・実装・検証・レビュー・引き渡しは維持し、削除したスキルへの呼び出しを除く。独立レビューの条件と時点は変えず、担当へ渡す基準と成果物別の確認観点を既存のレビュー工程にまとめる。専門スキルの本文全体や、ブループリントの専用文書モデル・コメント整理・TSVログの手順をdevlawへ移さない。

Tasks・MemoryのCLIと保存形式、共通知識は変更しない。作業状態はTasks、長く使う知識はMemory、タスクのない調査の明示的な保存はsavepoint、現在地の復元はrecallが引き続き担当する。

READMEには標準7スキルと用途を記し、必要に応じて選べるpstackの調査・検証・説明等を紹介する。[pstackのREADME](https://github.com/cursor/plugins/blob/main/pstack/README.md)で同名スキルの掲載を確認した。koto独自のsystem-blueprintに同じ配布元があるとは案内しない。外部スキルの振る舞いをkoto版と同一とは扱わず、知識の保存と結果の照合はkoto側で扱う。

既存の利用先にある知識・タスク・作業ログは削除しない。setupは配布元から消えたファイルを自動削除しないため、プロジェクトへ実ファイルで導入済みの補助スキル・エージェントは今回の更新だけでは除去されない。利用先の一括削除やCLIの変更は今回の範囲に含めない。

## 確認結果

Bun 1.4.2で以下を確認した。

- `bun run build`：208ファイルを生成。配布Markdown内の相対リンクとアンカーも確認した。
- `bun run test`：325件成功、失敗0件、2274 assertions。リポジトリ外での三製品の導入、Codex・Claude Codeのプロジェクト配置と更新、既存データの保護を含む。
- `bun run typecheck`・`bun run build:check`・`git diff --check HEAD`：成功。
- 配布スキルの一覧を7個に更新し、同梱エージェントは両形式ともdevlaw-workerだけであることを配布テストで確認した。

今回の検証は配布・CLI・手順の静的な照合までであり、変更したdevlawをAIに実行させる行動試験や各クライアントUIでの起動試験は含まない。過去のsavepointの実行評価は当時のスナップショットに対する記録として保持する。
