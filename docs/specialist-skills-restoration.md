# 専門スキルの再導入

2026-11-01。ユーザーは、専用の11スキルと、基本手順をdevlowへ取り込んでいた5スキルの復元を依頼した。developのe0fb596からcodex/restore-specialist-skillsを作り、現在のCLI・プロジェクト境界へ接続する。実装の依頼を受けた範囲で進め、検証後に履歴を残してdevelopへ統合する。

## 対象と所有範囲

- 専用の11個：bro、how、why、teach、technical-writing、unslop、natural-japanese、yomiyasu、explain-before-shorten、automate-me、reflect。
- 専門手順の5個：show-me-your-work、no-comments、system-blueprint、create-verification-skill、maintain-verification-skill。
- 正本は各skillsディレクトリ。devlowの工程資料から必要な専門手順へ接続し、既存の9スキルと合わせて25スキルとする。
- 配布は既存buildによるCodex・Claude Codeの2形式。CLIの処理、保存形式、版数、公開済みmain、Macの導入済みプラグインは変更しない。
- use-principles、checkpoint-safely、okf-agent-memory、orch、setupの旧5スキル・CLIは復元しない。

## 再利用元と表示

復元元はmainの77b4d4f87a4c575ccb4b243f2a62acd17cd446a2。ファイルごとのSHA-256を[specialist-restoration-source.json](specialist-restoration-source.json)へ記録した。上流の新しい版を取得したという意味ではない。既存のdocs/skills配下にある出典記録も保持する。

15スキルのMIT LICENSE、およびyomiyasuのUNICODE-LICENSE.txtはバイト単位で保持する。explain-before-shortenは、ユーザーが「出典だけ明記すれば使って良い」と指示した条件に従い、本文末尾へKazuki Otaと公開元の記事へのリンクを付ける。MITへの変更や、公開元にライセンス表記があるという主張は行わない。この出典表示はユーザーが明示的に求めた配布内容であり、保守記録は含めない。

## 現在の構成への適合

how・whyはMemoryの管理ルート・project・用途を引き継ぎ、読み取り専用の調査を維持する。Memoryの利用ログも書き込まない。固定モデルを使わず、利用先で委譲が許可されない場合は同じ観点で直接調査する。

system-blueprint・no-commentsは現在のMemory CLIへ保存し、scope・content_hash・管理ルート相対のcode_refsを使う。対象外projectへ探索を広げない。文書作成だけならTasksへ自動登録せず、コード変更へ進む場合は現在のdevlowの条件を使う。

show-me-your-workの既定ログは.space/<project>/tasks/<task-id>/decisions.tsvとし、Tasksの状態と判断ログを二重管理しない。タスクのない調査にログ目的のタスクを新設しない。

専門手順は必要な工程だけで使う。推敲スキルの一律連続実行、通常の完了報告からの自動reflect、独立スキル呼び出しだけを理由にしたタスク登録は追加しない。

natural-japaneseの開発用校正スクリプト・fixture、校正の変更経緯や配布先にないcorpus資料への参照は配布対象から除く。元の注釈と測定記録は上記固定コミットの各ファイルで追跡できる。実行スクリプトの計算処理は保持し、利用者向けの操作説明と保守者向けの注釈を分ける。通常のlintに必要なuv・Python・Sudachiは元の構成を使用し、semanticの大型モデルは任意利用とする。

## 検証計画

- skill-creatorの形式検査、配布内リンクと正本・生成物の照合。
- 同梱する著作権・許諾表示と復元元ハッシュの一致。
- Pythonの実行コードの比較、および両配布物を作業ツリー外へ出した後の日本語診断・差分の実行。
- Memoryの文書モデルに沿った保存・検索・更新と、Tasksの成果物参照を一時プロジェクトで確認。
- 全テスト・型検査・GitHubのPRおよびdevelopマージ結果のCI。

形式検査やCLIの成功は、AIによる自動選択や全スキルの意味上の動作検証とは区別する。semanticのモデルダウンロードと推論は今回の検証対象外。

## 検証結果

ローカルで次を確認した。

- `bun run test`：300テスト、2373 assertions、失敗0。
- `bun run typecheck`：成功。`bun run build`：358ファイルを生成。`bun run build:check`：正本と配布物が一致。
- skill-creatorの形式検査：25スキルすべて成功。
- 専門スキルの配布テスト：3テスト・118 assertions。両製品で許諾文のハッシュ、出典表示、除外対象を確認。配布元のソースを除いた一時フォルダで、日本語の診断・構成抽出・用語抽出・差分確認、入力ファイル不在時の失敗、入力文書の保持を確認。
- natural-japaneseの5つのPythonファイルは、docstringと4つの利用者向け診断文を除いて元のASTと一致。検出処理と閾値を変更していない。
- 配布済みMemory・Tasks CLIを別の一時プロジェクトで13回実行。全体像から詳細・運用手順へのリンク、shared・dev・ops、ハッシュ照合付き更新、strict・drift検証、Tasksからの成果物参照、コード参照による検索を確認。読み取り専用のsearch・showで内容と更新時刻が変わらず、利用ログも作られないことを確認。

Memoryの最初の確認用データでは運用手順が孤立し、strict検証が失敗した。全体像から実際に参照するリンクを追加して再実行し、成功を確認した。CLIの判定を緩める変更は行っていない。

GitHubのPRとdevelop統合後のCIは、対象コミットを指定して別途確認する。AIによる全25スキルの自動選択、semanticの大型モデル推論、Macの導入済みプラグインの更新はこの検証結果に含めない。
