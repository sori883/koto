# howの参照元と日本語化

以下は削除前の取込記録。2026-10-30の削除と現在の構成は[スキル整理の記録](../../issue-23-skill-pruning.md)を参照する。

確認日：2026-09-21

Cursorのpstack、コミット `6ed0f7a9504f577d7529064103cecce9be7dfc5e` のhowを、日本語の独立した配布スキルとして収録する。

- [原文のSKILL.md](https://github.com/cursor/plugins/blob/6ed0f7a9504f577d7529064103cecce9be7dfc5e/pstack/skills/how/SKILL.md)
- [原文の調査担当プロンプト](https://github.com/cursor/plugins/blob/6ed0f7a9504f577d7529064103cecce9be7dfc5e/pstack/skills/how/references/explorer-prompt.md)
- [原文の説明担当プロンプト](https://github.com/cursor/plugins/blob/6ed0f7a9504f577d7529064103cecce9be7dfc5e/pstack/skills/how/references/explainer-prompt.md)
- [原文のMITライセンス](https://github.com/cursor/plugins/blob/6ed0f7a9504f577d7529064103cecce9be7dfc5e/pstack/LICENSE)

配布物は [SKILL.md](https://github.com/sori883/koto/blob/77b4d4f87a4c575ccb4b243f2a62acd17cd446a2/skills/how/SKILL.md)、`references/` の2ファイル、原文を保持した [LICENSE](https://github.com/sori883/koto/blob/77b4d4f87a4c575ccb4b243f2a62acd17cd446a2/skills/how/LICENSE)。この保守資料は配布スキルの実行時依存にしない。

## 翻訳の範囲

description、本文、見出し、プロンプト、説明文を日本語化する。スキル名、ファイル名、役割名、差し込み項目は維持する。実行環境に依存する指示は、以下の配布先への対応に従う。

次の動作を保持する。

- 単純な質問は説明担当1人、複雑な質問は2〜4の調査担当から説明担当へ渡す。
- 入口、処理とデータ、抽象、境界、非自明な点を実装から追う。
- 調査結果には構成要素、処理、読んだファイル、境界、注意点、未解明事項を含める。
- 説明は概要、主要概念、仕組み、配置、注意点から必要な節を選ぶ。
- 読み取り専用の調査とし、説明担当の結果を大幅に書き直さない。
- 原文の図の選択（Mermaidまたは単純なASCII図）を保持する。system-blueprintのOKF成果物に対するMermaid指定は、呼び出し側の出力条件として扱う。

## Codex・Claude Codeへの対応

2026-09-21のユーザー指定に基づき、Cursorを配布対象から外し、Codex・Claude Codeで共通に使う本文へ変更した。翻訳以外の差分は次のとおり。

1. Task API・`generalPurpose`・`readonly` の指定を、利用環境のサブエージェント機能と読み取り専用の調査指示に置き換える。役割分担と並行調査は維持する。
2. 固定の既定モデルを除き、利用環境の役割設定または親からの継承に従う。事前に専用エージェントを定義していない場合は、汎用サブエージェントへプロンプトを渡す。
3. Read・Grep・Globというツール名を、ファイル読み取り・文字列検索・ファイル検索という能力の指定に置き換える。
4. 自動選択を制限しない。原文の `disable-model-invocation: true` を除き、Codexの `allow_implicit_invocation` も設定しない。

[配布方針](../system-blueprint/upstream.md#buildtsの配布方針)に従い、本文と参照資料を共通の配布元として管理する。実際のサブエージェント実行を、形式検証だけで確認済みとは扱わない。

## 検証方針

原文3ファイルと訳文の構成・差し込み項目・保持する動作を照合し、参照先とライセンスを確認する。quick_validateで形式を検証する。実行環境への対応と以下のOKF連携は意図的な差分として管理し、調査の実行結果とは区別する。

## OKFによる既存知識の参照

ユーザーの明示的な依頼により、OKFスキルで構成・動作の既存知識を検索・参照し、現在のコード・設定と照合する指示を追加した。CLIの手順はOKFスキルを正本とし、実行例を複製しない。

調査担当・説明担当の `{EXISTING_KNOWLEDGE}` に対象bundle、concept IDと根拠箇所、検索範囲、不足を渡す。単純な質問の経路にも適用し、確認済みの範囲は引き継ぐ。bundleの不在・結果ゼロ・取得不能を区別して伝え、知識の保存・更新・bundleの初期化は行わない。

OKF参照の受け渡しを明確にするため、起動元が担当プロンプトの実際の配置から相対リンクを解決し、実行時の絶対パスを `{OKF_SKILL_PATH}` に渡す。配布ソースの相対リンクは保持し、利用先の作業ディレクトリに依存させない。これは受け渡し方法の明文化であり、実行試験で発見した障害の修正ではない。原版からの単独調査プロンプトの前提は変更しない。

受け渡しの確認では、スキルを開発リポジトリ外へコピーし、別の利用先ディレクトリから、調査担当・単独説明担当・統合説明担当の3経路を確認した。差し込み済みの本文だけを受け取る別プロセスがOKFスキルを読み取れ、作業ディレクトリが変わらないことを確認した。既存の本文と相対リンクも変更前と照合した。これはパスの解決・受け渡しの確認であり、モデルによる調査実行やCLI操作の試験ではない。
