# 開発フローの参照元と採用範囲

この文書は構成整理前の開発・検証記録です。現在の配布構成は[現状資料](../../current-state.md)を参照してください。

2026-09-23。ユーザーがpstackのarchitectにある「構造の異なる複数案を探索して統合する手順」への対応を指定したため、devlowの設計工程へ取り込んだ。8工程全体をpstackのplaybookへ置き換える変更ではない。

## 参照元

比較対象はcursor/pluginsの固定コミット `032be146865d973682535de75f2287da438550bf`。最新版への追随を確認したという意味ではない。

- [architect](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/architect/SKILL.md)：現状把握、構造の異なる最低2案、利用例から骨組みを導くこと、統合案に沿った実装、構造の再設計。
- [arena](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/arena/SKILL.md)：同じ課題からの独立探索、共通基準での比較、土台の選択と他候補の有効部分の取り込み、統合後の確認。
- [設計上の問題](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/architect/references/design-red-flags.md)：公開面と隠す複雑さの釣り合い、情報漏出、実行順だけの分割、価値を加えない転送層。
- [設計理由のひな形](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/architect/references/rationale-template.md)、[候補担当への指示](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/architect/references/runner-prompt.md)：利用側の例、型・データ所有・境界、採否・統合理由を成果物に含める構成。

## 配布用ソースへの対応

| 原版の要素 | 配置と今回の扱い |
| --- | --- |
| Ground | [design.md](https://github.com/sori883/koto/blob/77b4d4f87a4c575ccb4b243f2a62acd17cd446a2/skills/devlow/references/design.md)の手順1。調査済みモデルは対象・版を照合して再利用し、不足をhow、責務・層構造の理由の不足をwhyへ渡す |
| Sketch | 手順2。必要な新規設計では構造の異なる最低2案。利用例を先に書き、型・シグネチャ・境界を導く。文書・スキルなら対応する構成を示す |
| 候補比較・統合 | 手順3〜4。全候補の本文を同じ基準で評価し、利用側へ露出する複雑さと設計上の問題を確認。土台・取り込み・見送りと理由を記録し、統合後に再確認 |
| Agree | 手順5。実装前に確認するというユーザー指定がある場合だけ待つ。既存の依頼・承認を引き継ぎ、設計のみの依頼に実装を追加しない |
| Implement / Scrap | 設計の受け渡し・失敗時の戻り先と[全体フロー](https://github.com/sori883/koto/blob/77b4d4f87a4c575ccb4b243f2a62acd17cd446a2/skills/devlow/references/workflow.md)、[実装工程](https://github.com/sori883/koto/blob/77b4d4f87a4c575ccb4b243f2a62acd17cd446a2/skills/devlow/references/implement.md)に接続。同じ形の構造上の問題が繰り返されたら再調査・再探索する |
| 設計の成果物 | [設計ひな形](https://github.com/sori883/koto/blob/77b4d4f87a4c575ccb4b243f2a62acd17cd446a2/skills/devlow/assets/design-template.md)に利用例、骨組み、候補比較、統合理由、統合後の確認を追加 |

## 意図的に調整した点

- architectとarenaを別スキルとして丸ごと移植せず、設計に必要な手順をdesign.mdに同梱する。未導入スキルやCursor固有のモデル設定を実行時依存にしない。
- 新しい構造の判断には最低2案を求めるが、既知の局所変更と適合する既存設計の再利用は全体フローの軽量化を維持する。親の共通設計を子が毎回探索し直さない。統合という工程選択で新規設計の探索を免除することはしない。
- 原版の既定モデル群と常時の並行実行は固定しない。許可された子エージェントが使える場合は並行探索する。使えない場合は異なる構造を順に作り、独立性の限界を記録する。原版と同等の実行形態とは表現しない。
- 原版arenaの独立した比較担当は、環境の許可と利用可能性に応じて使う。未実施を自己評価と区別し、全体フローで必須の独立レビューを満たしたことにはしない。
- 候補担当の失敗時にも、architect由来の最低2構造という条件を優先する。単独候補や同じ構造だけで比較完了にしない。
- 実装は既存のplan・implement工程へ渡す。設計だけの依頼で実コードを未実装の骨組みに差し替えたり、コミットや実装前の承認待ちを一律に追加したりしない。
- 候補ファイルはタスク側の `design-candidates/<round-id>/<candidate-id>.md`。比較と統合結果はtask.mdまたはdesign.mdにまとめ、OKFには確定した設計・統合理由を残す。途中の候補を一式登録しない。

配布用本文には、この採用経緯・原版との差・開発時の検証記録を含めない。既存のdevlowのMIT LICENSEを保持する。確認結果と運用上の未検証事項は[実装記録](implementation.md)に残す。

## 計画工程の参照元と採用範囲

2026-09-23。設計工程の次として計画工程を具体化するユーザー指示により、同じ固定コミットの [Multi-phase or multi-PR plan](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/poteto-mode/playbooks/multi-phase-plan.md) と [Feature](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/poteto-mode/playbooks/feature.md) を照合した。

| 参照した考え方 | 今回の対応 |
| --- | --- |
| 証拠に基づき単位ごとに作業する | [plan.md](https://github.com/sori883/koto/blob/77b4d4f87a4c575ccb4b243f2a62acd17cd446a2/skills/devlow/references/plan.md)で作業結果・受け入れ条件・方法・合否条件・証拠を対応付ける。計画作成と作業完了を区別する |
| ファイル、依存、担当、実際の利用結果を明示 | 各単位に変更範囲、着手前に必要な成果物と条件を置く。局所確認だけでなく、変更対象に合う実経路・統合後の確認を計画する |
| Featureの四つの分割観点 | 先行する作業、独立して進める範囲、共有する書き込み先、分割の大きさを計画内で確認。再開用checkpointとは別の内容として扱う |
| 計画の前提を試作で確かめる | 調査・設計で得た根拠を再利用。実現性や順序を左右する不足は該当工程へ戻す。後続だけに影響する未決事項は依存先と解決方法を示す |
| 計画と実行を分ける | 計画のみの依頼では引き渡して終了。実装も依頼済みなら着手条件の成立後に継続。ユーザーが指定した確認地点は保つ |

原版はPR単位の固定構造、すべてのPRへのunit・live・perfの確認、10本のlive検証、固定モデル・制御スキル、check-plan.mjsと自動監査等を含む。今回は原版全体の移植ではなく、合意した小・標準・大の規模と実行環境に合わせて次を調整した。

- 小規模は会話、標準はtask.mdまたは独立したplan.md、大規模の親はplan.mdとする。保存先は既存資料を優先し、新規なら `.space/tasks/<task-id>/`。agent storeのdocsを既定先にしない。
- [計画ひな形](https://github.com/sori883/koto/blob/77b4d4f87a4c575ccb4b243f2a62acd17cd446a2/skills/devlow/assets/plan-template.md)は必要な節だけ使う。単位をPR・子タスクへ一律に対応させず、固定の見出し一式や一PRごとの10本の検証を要求しない。
- 実経路の確認は対象の挙動に合わせて選び、性能測定は性能改善・性能条件がある場合に具体化する。変更前の基準、同条件の比較、新規処理の絶対基準を区別し、無関係な検証を追加しない。
- 自動的なgoal・定期実行・外部操作、固定のモデル・ツール・PR方式は導入しない。未導入のpstackスクリプトで計画を検証できるとは扱わない。
- 進捗の更新・親の受け入れ確認・CLIなしの管理は、既存の全体フローを参照する。計画工程でCLIの保存形式やTSVファイル名は決めない。

計画の形式検査だけで実行可能性・設計品質を証明したことにはしない。計画追加時点で未実装だった後続4工程は、以下の追加で具体化した。タスクCLI、配布生成は引き続き別の実装対象である。

## 実装・検証・レビュー・引き渡しの参照元と採用範囲

2026-09-23。「引き渡しまで実装」というユーザー指示により、同じ固定コミットから次の手順を照合した。独立したreviewという名前のplaybookを移植したものではない。

- [Bug fix](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/poteto-mode/playbooks/bug-fix.md)：再現と原因に基づく変更、同じ経路での再確認、局所テストが有効な場合の失敗から成功への証拠。
- [Opening a PR](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/poteto-mode/playbooks/opening-a-pr.md)：差分の整理と、意図・影響・検証を中心にした引き渡しの説明。作業ログ全文を納品説明へ転記しない。
- [Bugbot triage](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/poteto-mode/references/bugbot-triage.md)、[Babysit](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/poteto-mode/playbooks/babysit.md)：指摘を現在の根拠と照合し、修正・見送り・確認を分ける。失敗原因を確かめてから再試行する。
- [Shipping](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/poteto-mode/playbooks/shipping.md)：検証対象と現在の差分を照合すること、依存する納品の順序、操作要求と実際の完了を区別すること。

| 配布用の工程 | 採用した内容 |
| --- | --- |
| [implement.md](https://github.com/sori883/koto/blob/77b4d4f87a4c575ccb4b243f2a62acd17cd446a2/skills/devlow/references/implement.md) | 実状態と所有範囲の確認、採用した骨組みへの具体化、原因と対応する小さな変更、差分・局所結果を検証へ渡す |
| [verify.md](https://github.com/sori883/koto/blob/77b4d4f87a4c575ccb4b243f2a62acd17cd446a2/skills/devlow/references/verify.md) | 対象の版・差分・環境と証拠の対応、実経路の確認、合格・不合格・未確認・対象外の区別、影響する結果の再検証 |
| [review.md](https://github.com/sori883/koto/blob/77b4d4f87a4c575ccb4b243f2a62acd17cd446a2/skills/devlow/references/review.md) | 独立性の明示、成果物と根拠に基づく指摘、修正・見送り・確認の区別、修正と再検証を確認した判定 |
| [deliver.md](https://github.com/sori883/koto/blob/77b4d4f87a4c575ccb4b243f2a62acd17cd446a2/skills/devlow/references/deliver.md) | 依頼の終了地点の確認、具体的な納品の準備、許可された操作の実結果確認、確定した知識の保存、状態と報告の更新 |

既存の規模・承認・記録方針に合わせ、原版から次を調整した。

- 固定モデル・常時の委譲・クラウド環境・専用controlスキルを前提にしない。独立レビューが必須な場合に利用できなければ、不足を明示し、自己確認を代用にしない。
- 再現できない場合は未確認とし、強制的な再現や外部操作を依頼範囲の外へ広げない。再試行は新しい根拠や条件修正に基づき、一律の回数や継続監視を要求しない。
- 原版のGit状態のリセット、自動的なコミット・PR作成、非draftの固定、PRスタックの操作・マージ監視は移植しない。利用先の変更を保護し、納品操作と外部への送信は今回の依頼・承認に従う。
- 原版のpatch-idによるPRスタック運用は追加せず、現在の版・差分・環境との対応を成果物全般の確認条件とする。CI成功やコメント解決だけを、必要な検証・レビューの代わりにしない。
- 検証・レビューだけの依頼は、不合格や指摘を成果物として返せる。依頼の回答が終わったことと、対象の合格・承認・修正完了を分ける。
- システムを単位とするOKF保存、現在の構成のsystem-blueprintへの接続、checkpoint-safelyによる再開情報の扱いは、このプロジェクトで合意した統合である。途中のログやタスク目標を丸ごと知識化しない。

8工程の手順がそろったことと、実エージェントによる運用検証、タスクCLI、配布生成の完成は区別する。検証記録はimplementation.mdに残す。
