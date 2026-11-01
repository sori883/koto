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

全293テスト、型検査、196ファイルの生成物照合と変更した5スキルの形式検証が成功した。両製品の配布Memoryだけで用途指定・共有の参照・記録を確認した。GitHub CIとOpsフローの実行確認は、実施後に結果を追記する。
