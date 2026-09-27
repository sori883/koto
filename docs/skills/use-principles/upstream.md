# 開発原則と運用ルールの参照元

確認日：2026-09-21。原則の移植記録は2026-09-20、全体フローの責務分離は2026-09-21。

Cursorのpstack、参照コミット `032be146865d973682535de75f2287da438550bf` の[23原則](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/docs/guide/08-principles.md)と[poteto-mode](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/poteto-mode/SKILL.md)を基に、日本語の開発規約として配布する。

## 配置と責務

- `.space/babel/principles/` に原則を1件ずつ、計23件保存する。IDは原文の `principle-` を除いた名前に揃える。
- 各原則は `type: principle`、`governance: context` とし、原文への固定リンクを `sources` に残す。descriptionに参照する場面と判断の指針を記し、本文には詳細な適用条件と例外を保持する。
- `.space/babel/rules/` に追加するルールは `type: rule`、`governance: constraint` を明示する。具体的に守る行動・禁止事項・承認条件を記し、原則の本文を複製しない。
- 各原則はtype検索とdescriptionから選んで参照する。適用手順を重複して記すルール文書や、場面と参照先の対応表は同梱しない。
- [原則参照スキル](../../../skills/use-principles/SKILL.md)に、候補の検索、本文の確認、適用結果の受け渡しを置く。作業の進行・委譲・検証・記録・報告は[全体フロー](../../../skills/devlow/references/workflow.md)へ分離した。
- [配布用AGENTS.md](../../../templates/AGENTS.md)を利用先の入口とする。kotoのルートにある開発用 `AGENTS.md` へ配布ルールを追加しない。`okf-agent-memory` 自体は分野に依存しない記憶管理のままにする。
- 原著の[MITライセンス](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/LICENSE)を、OKF bundleと原則参照スキルそれぞれの `LICENSE` に同梱する。進行手順を移したdevlowにも同じLICENSEを保持する。

## ローカライズの判断

2026-09-20のユーザー指示により、23原則すべてを `context` の判断指針として採用し、ルールは `constraint` とする。原則は該当するものを引き続き検索・参照し、作業の目的や制約、他の原則との釣り合いを考えて使う。原則の手順を一律の義務にはせず、必須にする具体的な条件はルールに記す。

この区分は同梱する開発文書の運用方針であり、OKF全体でtypeとgovernanceを固定対応させる仕様ではない。CLIのgovernance省略時の扱いは、typeにかかわらず `context` のまま。作成主体はCLIが記録し、人間による内容確認を行ったという `verified` は付けない。

| 対象 | 配布物での扱い |
| --- | --- |
| 起動と参照 | 利用先の配布用AGENTS.mdからdevlowを読み、必要な原則参照をuse-principlesへ渡す。ルールと原則の全候補のdescriptionを確認し、作業に合致する文書や適用判断が曖昧な文書の本文を読む。CLIの操作手順はOKFスキルに置く |
| 原則の日本語化 | 単なる一行の標語にせず、適用条件、実行上の判断、例外を残す。具体例は必要な範囲で要約する |
| 自律性と承認 | 可逆性だけで外部操作の権限を推定しない。ユーザーの依頼範囲と既存承認を使い、同じ確認を繰り返さない |
| コミット・rebase・PR | 原文の自動コミット、作業前rebase、各手順後のPR作成を一律の義務にしない。現在のユーザー指示を優先する |
| 共有状態の分離 | worktreeを必須にしない。利用場所の指定に従い、所有ファイルの分離や単一書き込み担当も使う |
| 委譲とモデル | 専用エージェント名・固定モデル・常時並列実行は移植しない。利用環境で許可された手段と設定を使う |
| スキルの振り分け | 未導入のhow・architect・interrogate・unslop・deslop等は必須にせず、それぞれの目的を運用手順と利用可能な既存スキルで満たす |
| 作業手順 | poteto-modeの主要な作業分類と判断・検証の流れをまとめる。23のplaybook本体やCursor固有の自動化ツール一式は同梱しない |
| 文章 | 簡潔さ、根拠、利用者への影響、非自明な理由を説明するコメントを継承する。英語のダッシュ・コロンに固有の禁止は日本語の文章規則に持ち込まない |
| 入力検証と型 | 境界で保証済みの条件の重複検証を避ける。新しい外部I/Oや信頼境界での検証まで禁止しない |
| 冪等性とロック | 安全な再実行という意図を保持する。稼働中か判定できない既存ロックを自動解除する指示にはしない |
| テスト | 振る舞いを観測する原則を継承する。原文のアサーション分類は機械的な禁止表にせず、対象が壊れたときに検出できるかで判断する |
| 記録 | 作業中の記録はタスク成果物、再開情報はcheckpoint、整理した最終結果・判断はOKFへ残す。自動的なTSV作成や別PR作成を必須にしない |

## 配布用AGENTS.mdの配置

`templates/AGENTS.md` は利用先プロジェクトのルートへ配置するためのひな形であり、保存場所の `templates/` を作業するエージェントへの開発指示ではない。利用先に既存の `AGENTS.md` がある場合は、内容を上書きせず「開発ルール」の節を統合する。koto固有の `work/` に関する指示は配布しない。

ひな形の入口は利用先ルートの `skills/devlow/` とする。同じ親ディレクトリに、全体フローが参照するuse-principles・okf-agent-memory・checkpoint-safely・how・why・system-blueprintを配置する。23原則を含むbundleは `.space/babel/` を前提とする。既存bundleへ追加する場合はOKF CLIで検索して重複を確認し、既存の文書・目次・履歴を上書きしない。OKF CLIの依存の準備はOKF Agent Memoryの手順に従う。異なる配置にする場合は、ひな形のスキルパスとbundleパスも合わせる。

運用スキルの必須参照は同梱するスキルとOKF文書に限定する。kotoの開発用 `.agents/skills/` は配布先の必須依存にしない。

## 保守時の確認

原則・ルールの追加・変更はOKF Agent MemoryのCLIで行い、`show` で本文とメタデータを読み返す。`search --type rule --all` で承認ルールの草案1件を取得し、`show` で `governance: constraint`、`status: draft` と本文のTODOコメントを確認する。草案を確定済みのルールとして扱わない。`search --type principle --all` で全23件のID、`type: principle`、`governance: context` とdescriptionを確認し、各本文の適用条件・参照元を確かめる。

`validate --strict --drift` で形式・目次・リンク・孤立文書を検証する。同梱bundleでは、23原則と承認ルールの草案1件がconcept間のリンクを持たないため、現行のstrict検証は孤立文書24件で不合格になる。エラー・警告・リンク切れが0件であることと区別して報告し、検証を通すためだけの関連リンクは追加しない。運用スキルはskill-creatorの `quick_validate.py` と参照先の存在確認を行う。形式検証は実際のエージェントの行動を保証しないため、適用条件や権限境界は代表的な依頼に照らして見直す。
