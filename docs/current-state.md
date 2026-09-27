# agent-gearの現状

agent-gearは、開発作業のフロー、タスク台帳、知識管理、プロジェクトへの導入をCodex・Claude Code・GitHub Copilot in VS Codeへ配布するプラグインである。CopilotはClaude形式の配布物を共用する。目的と配置方針の正本は[architecture.md](architecture.md)、導入・生成方法は[distribution.md](distribution.md)に置く。

2026-09-26時点の作業ツリーを対象とする。以下はローカル実装の状態であり、最新変更のmainへの公開やリモートCIの成功を意味しない。詳細な検証結果は[配布の実装記録](distribution-implementation.md)、[Copilot対応記録](copilot-support.md)、[Babel統合の記録](babel-distribution.md)、[pstackスキルの採用記録](skills/pstack-adoption.md)を参照する。

## 提供するもの

| 構成物 | 役割・入口 |
| --- | --- |
| devlow | [全体フロー](../skills/devlow/references/workflow.md)。依頼整理・調査・設計・計画・実装・検証・レビュー・引き渡しを規模と依頼種別から選ぶ |
| orch | [スキル](../skills/orch/SKILL.md)と専用CLI。unitの進行、確認結果、親の受け入れを分離して管理する |
| okf-agent-memory | [スキル](../skills/okf-agent-memory/SKILL.md)と専用CLI。Markdownの知識を検索・保存・更新・関連付け・検証する |
| setup | [スキル](../skills/setup/SKILL.md)と専用CLI。同梱文書と指示を既存のプロジェクトへ導入・更新する |
| system-blueprint / how / why | システムの構成文書、動作の調査、設計理由の調査を担当する |
| use-principles / checkpoint-safely | 原則の選択・適用と、中断・引き継ぎの保存を担当する |
| blast-radius / interrogate | 影響経路と安全性の前提を確認し、独立レビューの指摘を照合する |
| create-verification-skill / maintain-verification-skill / tdd | 利用先のアプリ専用検証スキルを作成・更新し、局所テストで不具合を再現して修正する |
| teach / recall | 仕組みと理由を説明し、既存記録と実状態から現在地を再構成する |
| show-me-your-work / no-comments | 判断の追記・訂正・照合と、コメントの知識をcode_refs付きOKFへ保存してから削除する手順 |
| technical-writing / unslop / bro | 技術文書の構成、意味を保つ推敲、直前の回答の言い換え |
| natural-japanese | 日本語の執筆・推敲・診断と、kuromojiを使うBun CLIによる文章検査・読解負荷・構成・用語の抽出。意味モデル検査は含まない |
| reflect / automate-me | 作業の学び・本人の作業方針からスキル案を作り、人間の承認後に反映する |
| 共通知識 | [space/babel](../space/babel/index.md)の23原則。実体は利用先の`.space/babel/`へ配置する |

計24スキルと2役のエージェントを二つの形式の配布物へ同梱し、三製品で利用する。`devlow-worker`はdevlowで担当単位を実行し、`comment-curator`はコメントを整理する。Codexではsetupが `.codex/agents/`へTOMLを配置し、Claude形式ではプラグインの `agents/`に同梱する。各クライアントでの起動・実行は未確認。リポジトリの`.agents/skills/`と`.codex/agents/`は開発環境用であり、製品のエージェント定義として配布しない。hooksは追加していない。

## 正本と実行場所

| 場所 | 内容 |
| --- | --- |
| `skills/` | 配布するスキル・参照資料・CLIの正本。testsは開発用 |
| `space/babel/` | 共通知識の配布用正本 |
| `packaging/codex/`・`packaging/claude-code/` | 製品別manifest・指示テンプレート・エージェント定義 |
| `packaging/copilot/` | 共用配布物へ組み込むCopilot用指示テンプレート |
| `dist/` | buildで生成しGit管理する配布物。テスト・docs・node_modulesを含めない |
| `.agents/plugins/marketplace.json`・`.claude-plugin/marketplace.json` | それぞれのdistを参照する生成済みカタログ |
| `docs/` | 開発者向けの設計・検証記録。配布しない |

四つのCLIはそれぞれの`skills/<skill>/scripts/`で起動する。OKFのMiniSearch 7.2.0とnatural-japaneseのkuromoji 0.1.2は、それぞれのscripts内のpackage.json・bun.lockで固定し、bootstrapが必要時に導入する。orchとsetupの外部依存は空であり、定義の確認だけを行う。利用先のpackage.jsonやlockへ依存を混ぜない。natural-japaneseの採用範囲と検証は[実装記録](skills/natural-japanese/implementation.md)を参照する。

旧`templates/AGENTS.md`と開発リポジトリの`.space/babel/`は既存資料として残すが、buildの入力にはしない。指示テンプレートの配布用正本はpackaging配下、共通知識の正本はspace配下である。

## 作業記録と知識を分ける

標準・大規模の依頼にはtask.mdを作る。大規模な依頼は同じ作業単位をorchのunitとして登録し、各担当が自身の進捗・確認記録・提出を更新する。親は提出の証拠を照合して受け入れる。JSONが台帳の正本であり、TSVとMarkdownはexportした一覧である。小規模な会話中の依頼には新規task.mdを必須にしない。

作業中の依頼、計画、仮説、試行結果は`.space/tasks/`へ保存する。OKFの`.space/babel/`には、システムの構成、採用した設計と理由、重要な変遷を残す。原則として引き渡し工程が保存要否と重複を確認し、保存と検証を行う。配布元の共通知識も同じ`.space/babel/`から検索する。setupが配置した文書の更新はハッシュで管理し、プロジェクト固有の文書や編集を上書きしない。

OKFのconceptはfrontmatter付きMarkdown一件、bundleはその集合を指す。typeはrule・principle・knowledge・procedure・decision。index.mdは目次、log.mdは文書操作の履歴であり、システムの歴史や作業ログの代わりにはならない。

コメント由来の理由・制約はno-commentsが削除前に保存・内容照合する。パス・globを `code_refs`に置き、シンボル・範囲・版は本文へ記す。調査と変更の入口から関連知識を検索できるよう、how・whyと導入時の指示にも接続した。show-me-your-workの訂正は元の行を残す追記であり、orchの状態更新やOKFの履歴を置き換えない。

## 動作と制約

- setupは前回配置した内容を照合し、既存の独自文書や指示の管理ブロック外を保持する。衝突時には適用前に停止し、途中終了はpending記録から再開する。
- Copilot用setupは`--product copilot`で同梱manifestを選択し、`.github/copilot-instructions.md`へ配置する。省略時のCodex・Claude Codeの既定動作は維持する。
- orchはローカルJSONを排他・原子的置換で更新する。再送を操作IDで識別し、古い試行・置き換え済みの証拠・失効した提出を現在の合格として扱わない。
- OKFは内容と根拠の正しさを判定しない。エージェントが記録の価値と本文を判断し、CLIが検索・形式検証・ファイル操作を行う。複数ファイル全体の自動巻き戻しはない。
- 異常終了後のロックは自動で奪わない。各CLIの資料に従い、書き手の停止を確認して復旧する。
- 共通知識23件は形式・リンク・目次の整合性を満たすが、concept同士のリンクを持たないためstrict検証では孤立文書として不合格になる。配布できたこととstrict合格を混同しない。

日月単位の運用、他OS、ネットワーク共有、電源断はローカルの短時間試験で確認済みにしない。orchの保持・切り替えと測定範囲は[運用資料](skills/orch/operations.md)、OKFの依存配置は[移行記録](skills/okf-agent-memory/runtime-migration.md)、setupは[実装記録](skills/setup/implementation.md)に記録する。
