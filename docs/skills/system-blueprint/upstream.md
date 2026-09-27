# system-blueprintの設計根拠と参照元

確認日：2026-09-21

主責務は、既存のコードや資料から、対象システムの構成・動作・設計背景を理解できるブループリントを作成・更新すること。対象範囲の判断、調査、concept分割、保存、検証は、その目的を達成するために行う。

## この会話で確定した仕様

- 配布するスキルを開発する。koto自体のブループリントを生成する作業ではない。
- スキルと付属資料は日本語にする。
- 成果物は利用先の `.space/babel/` をbundleとして、OKF CLIで作成・更新する。新規の構成・動作の説明は `knowledge/systems/<system>/`、設計判断は `decisions/systems/<system>/` に保存し、全体像は `knowledge/systems/<system>/blueprint.md` とする。
- 単一システムでも `<system>` を省略しない。既存の同じ対象・責務の文書は元のIDで更新・参照し、標準配置に合わせるためだけに移動・複製しない。保存先は文章とconcept IDの表で示し、ディレクトリ図は設けない。
- 大小ではなく、独立して検索・参照・更新する意味の単位で分割する。固定の文書数を要求しない。
- ブループリントは文書群全体で、`blueprint.md` は全体像と入口を担う。
- howとwhyは単独利用もできる別スキルとして管理する。原則pstackの日本語化とし、変更はユーザーに確認する。
- whyの外部サービス向け手順6件は、ユーザー指定の配布制約により除外する。呼び出し時は配布しているwhyの調査範囲に従い、原版のカテゴリ網羅を要求しない。
- 配布対象はCodex・Claude Code。Cursor固有の実行指示を環境共通の指示に置き換え、自動選択を制限する設定は追加しない。
- 重要な構成判断の理由を扱う。確認できた事実、推論、仮説、不明点を区別し、理由を捏造しない。
- 全理由の解明ではなく、確認できた範囲と限界を根拠付きで示し、文書群として保存・検証することを完了条件とする。

## 参照元

| 参照元 | 採用する考え方 |
| --- | --- |
| [pstack how](https://github.com/cursor/plugins/blob/6ed0f7a9504f577d7529064103cecce9be7dfc5e/pstack/skills/how/SKILL.md) | 実装の入口、処理、構成要素、境界を調べる。別スキルを使い、ここへ調査手順を複製しない |
| [pstack why](https://github.com/cursor/plugins/blob/6ed0f7a9504f577d7529064103cecce9be7dfc5e/pstack/skills/why/SKILL.md) | 採用理由を根拠から調べ、確度を区別する。別スキルを使う |
| [acquire-codebase-knowledge](https://github.com/github/awesome-copilot/blob/4f4796f0bf30e105700f97ed8408c12b6aa95e06/skills/acquire-codebase-knowledge/SKILL.md) | 全体把握、項目別の調査、文書化、根拠の検証、既存資料の意図と実装の差の確認 |
| [調査項目](https://github.com/github/awesome-copilot/blob/4f4796f0bf30e105700f97ed8408c12b6aa95e06/skills/acquire-codebase-knowledge/references/inquiry-checkpoints.md) | 入口、依存、データフロー、バックグラウンド処理、外部連携などの確認観点 |
| [OKF Agent Memory](../../../skills/okf-agent-memory/SKILL.md) | knowledge・decisionの分類、検索してから更新すること、CLIでの保存・関連付け・検証 |

acquire-codebase-knowledgeはそのまま翻訳する対象ではない。今回の目的に合わせ、7文書の固定出力、全依存の一覧、コーディング規約・テスト環境・技術的負債の網羅的な文書化、専用スキャンスクリプトは引き継がない。システム構成の理解に必要な根拠として関連する箇所を調べる。

同スキルの参照元はGitHub, Inc.のMITライセンスであり、原文の[LICENSE](https://github.com/github/awesome-copilot/blob/4f4796f0bf30e105700f97ed8408c12b6aa95e06/LICENSE)を、配布物の [LICENSE](../../../skills/system-blueprint/LICENSE) に保持する。pstackを日本語化したスキルと原文のライセンスはhow・whyの配布物に含める。

## 配布構成

- [SKILL.md](../../../skills/system-blueprint/SKILL.md)：作成・更新の入口と完了条件。
- [文書モデル](../../../skills/system-blueprint/references/document-model.md)：conceptの責務、分割、根拠、不明点、更新。
- [本文ひな形](../../../skills/system-blueprint/assets/blueprint-template.md)：全体像の文書に使う本文。frontmatterはOKF CLIへのメタデータとして別に渡す。
- 同じ親ディレクトリにhow・why・okf-agent-memoryを配置する。開発用 `.agents/skills/` やこの保守資料を利用先の実行依存にしない。

## build.tsの配布方針

`skills/` を共通の配布元とし、`build.ts` は対象環境向けの配布アセットを組み立てる。これは今後のビルド実装に対する方針であり、今回 `build.ts` を実装したものではない。

- `SKILL.md` の本文を製品別に分岐・文字列置換せず、スキルのディレクトリ構造、参照資料、ひな形、ライセンスを保つ。
- system-blueprintの配布にはhow・why・okf-agent-memoryを含め、兄弟ディレクトリへの相対リンクを保つ。how・whyはそれぞれのディレクトリ単位でも配布できる。
- okf-agent-memoryが必要とするCLIと実行時依存も含める。配布後の配置からCLIを実行できることをビルド側で確認する。
- 製品固有のマニフェストやUIメタデータが必要になった場合だけ、ビルド側で追加する。モデルIDや自動選択の制限は現時点では追加しない。
- 出力先のアセットでfrontmatter、参照先、必須ファイルを検証する。配布元だけの検証で完了にしない。

ディレクトリ配布の場合、プロジェクトへの配置先は次のとおり。これらはスキルの配置先であり、生成するブループリントの保存先 `.space/babel/` とは別である。

| 配布先 | プロジェクト内の配置先 | 根拠 |
| --- | --- | --- |
| Codex | `.agents/skills/<skill-name>/` | [公式の配置仕様](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills) |
| Claude Code | `.claude/skills/<skill-name>/` | [公式の配置仕様](https://code.claude.com/docs/en/skills#choose-where-skills-load) |

プラグイン配布を選ぶ場合は、その製品のマニフェストで同じ `skills/` を束ねる。配布形式を変えても調査手順を二重管理しない。

## 検証

形式検証、配布物の参照先確認、[評価ケース](evaluation-cases.md)による内容確認を分ける。OKFへの保存経路は一時的な検証用プロジェクトとbundleで確かめ、kotoの実際の `.space/babel/` へサンプル文書を保存しない。PR取得や実際のhow・whyのモデル実行は、別途確認していない限り検証済みとしない。
