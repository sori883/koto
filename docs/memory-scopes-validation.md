# Memoryのscope分類と検証記録

## 配布元の分類

2026-11-01、23文書の適用条件と本文を確認した。従来の「開発原則」タグや配置名だけでは分類せず、scopeのみを追加し、本文と既存属性は保持した。共有9件、開発14件。運用だけに限定される文書はなかったため、ops専用の文書はこの移行では増やさない。これは利用先のデータ移行ではない。

| principleのID末尾 | scope | 判断理由 |
| --- | --- | --- |
| attack-the-premise | dev | 修正・設計の前提と実装上の処理主体を見直す |
| boundary-discipline | dev | システム境界での解析・型・内部ロジックを設計する |
| build-the-lever | shared | 開発の編集と運用の移行・分析・検証に再実行可能な道具を使う |
| encode-lessons-in-structure | dev | 型・lint・共通処理などの仕組みを変更して再発を防ぐ |
| exhaust-the-design-space | dev | 製品やUI、構造の設計案を具体化して比較する |
| experience-first | dev | 製品・UX・機能範囲を設計する |
| fix-root-causes | shared | 不具合修正と運用障害の調査で原因を観測し、再起動・永続状態も確かめる |
| foundational-thinking | dev | 型・データ構造・基盤の実装順序を定める |
| guard-the-context-window | shared | 開発・運用ともに調査と再開に必要な情報を保つ |
| laziness-protocol | dev | リファクタリングとコードの複雑さを評価する |
| make-operations-idempotent | shared | 実装する操作と運用時の再実行・部分失敗の両方に適用する |
| migrate-callers-then-delete-legacy-apis | dev | 内部APIと呼び出し側を移行する |
| minimize-reader-load | dev | コードの層・状態・レビューの負担を減らす |
| model-the-domain | dev | データ構造・型・状態機械を設計する |
| never-block-on-the-human | shared | 両フローで既存の依頼・承認を引き継ぎ、必要な判断だけを確認する |
| outcome-oriented-execution | shared | 開発の書き換えと運用の移行で検証可能な完了地点を守る |
| prove-it-works | shared | 両フローで実物と実状態を完了の根拠にする |
| redesign-from-first-principles | dev | 新要件に対する設計・型・呼び出し元を見直す |
| separate-before-serializing-shared-state | shared | 開発時の共有状態と運用の並行したファイル・ブランチ操作の競合を扱う |
| sequence-verifiable-units | shared | 両フローで変更・移行を検証可能な単位へ分ける |
| subtract-before-you-add | dev | 機能追加・リファクタリング・指示設計の構造を整理する |
| test-behavior-not-implementation | dev | 自動テストを設計・評価する |
| type-system-discipline | dev | 型・境界解析・網羅的分岐で実装の不整合を防ぐ |

## 第1段階の検証

追加した8テストは実装前に全件失敗し、実装後は8件・92 assertionsが成功した。全5分類のscope入力、共有を含む検索、完全一致の棚卸し、上限適用前の選別、未分類読取・明示移行とハッシュ競合、検証警告、関連付け・削除、JSON入力・利用記録、project境界を実CLIと公開APIで確認した。

既存の書き込みテストはscopeを指定する入力へ更新し、以前の保存形式を読むテストは未分類のまま残した。旧形式をsharedへ補完する互換処理は追加していない。Tasksには属性・状態・保存形式の変更を加えていない。

全293テスト、型検査、196ファイルの生成物照合と変更した5スキルの形式検証が成功した。両製品の配布Memoryだけで用途指定・共有の参照・記録を確認した。[PR #27](https://github.com/sori883/koto/pull/27)を履歴を残してdevelopへ統合し、マージコミット31ae211の[CI](https://github.com/sori883/koto/actions/runs/41262211376)も成功した。Opsフローの実行確認は後述する。

## 第2段階の検証

opsflowの入口、実行・中断・再開の参照資料、利用先で埋めるprocedureのひな形を追加した。devlowとrecallの引き継ぎ、Memoryの呼び出し元、利用先のAGENTS.md/CLAUDE.mdの案内を接続した。Tasksの属性・状態機械は変更していない。

配布元を取り除いた後の指示生成でopsflowの実在するリンクを要求するテストを先に追加し、実装前は1件失敗した。実装後は配布・指示更新の22テスト、584 assertionsが成功した。全293テスト・2142 assertions、型検査、202ファイルの生成物照合、変更した4スキルの形式検査も成功した。両製品それぞれ9スキルとなり、配布内リンクと既存の著作権表示も検査した。

[模擬運用の実行スクリプト](verification/opsflow-smoke.py)は、両製品の配布物をそれぞれ一時フォルダへコピーし、実際のMemory・Tasks CLIを外部フォルダから呼び出す。`bun run build`後に`python3 docs/verification/opsflow-smoke.py`で再実行できる。対象は一時JSONのカウンターで、本番サービスやユーザーのデータは操作しない。一時フォルダは終了時に削除する。

| シナリオ | 両製品で確認した結果 |
| --- | --- |
| 共有・開発・運用の知識と運用手順を準備してops検索 | 共有と運用だけを取得。調査時にTasksを作らず、全ファイルの内容ハッシュは不変。利用ログも0件 |
| 状態変更前にタスク登録・開始 | 説明へ作業の種類・継続先・手順ハッシュ・完了条件を保存。Tasksにscopeはない |
| 操作を1回実行し、結果確認前にcheckpointとpausedを記録 | 結果の確認前は未完了。再開時に実状態count=1を観測し、操作を再送しない |
| 純粋な運用の完了 | 確認結果を成果物として登録してcomplete。PRなし、count=1のまま |
| 明示した模擬再試行で手順を変更 | 以前のハッシュとの差を検出。以前の完了を今回へ流用しない |
| 開発への引き継ぎ | 同じtask_idの説明とcheckpointへdevlowと残る運用条件を記録。コード変更・PRは実施せずwaitingとして保持 |
| Memoryの利用ログ | opsflowとtask_idの付いた本文参照1件だけを記録。状況確認時の追加記録なし |

これは手順に沿ってCLIを組み合わせたスクリプト検証であり、製品内のAIによる自動スキル選択・自律的な判断の確認ではない。実際の運用環境に固有の手順・権限・復旧は利用先で確認する。Macの導入済みプラグイン、main、版数、利用先の実データには変更を加えていない。
