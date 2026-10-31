# Issue #23: スキル構成の整理

この文書は2026-10-30に16スキルを削除した時点の記録。続く全スキル削除と配布先の整理は[2026-10-31の記録](issue-23-packaging-reset.md)を参照する。

2026-10-30。Memory・Tasks・Workspaceの統合ワークスペース構想を基準に、管理・記録を直接の責務としないスキルを配布対象から外す。ユーザーが先に削除したbroに続き、指定された12スキルと、追加指定のhow・why・teachを削除する。

## 削除対象

bro、explain-before-shorten、natural-japanese、yomiyasu、technical-writing、unslop、blast-radius、interrogate、tdd、create-verification-skill、maintain-verification-skill、reflect、automate-me、how、why、teachの計16スキル。

正本のディレクトリを削除し、Codex形式・Claude形式の配布物とproject用マニフェストを再生成する。削除スキル専用のPython実行テスト、CIでのuv準備・Pythonツール起動、原版の末尾空行を保持するための.gitattributesも外す。

過去の取込記録・設計や検証の記録はdocsに保持する。削除済みの資料への履歴用リンクは、削除前のコミットを参照する。

## 残す構成

| 役割 | スキル |
| --- | --- |
| 知識管理・知識の利用 | okf-agent-memory、use-principles、system-blueprint、no-comments |
| タスク管理・記録・再開 | orch、show-me-your-work、checkpoint-safely、recall |
| 工程の進行・導入 | devlow、setup |

計10スキル。devlowは削除した専門スキルへの参照を外し、既存の検証・レビュー工程を維持する。独立レビューはreview工程へ接続し、不具合修正前後の確認はimplement工程で扱う。専用スキルを削除したことを理由に、既存の完了条件を緩めない。system-blueprint・recall・no-commentsは、必要なコードや資料を直接調べる手順へ変更した。

Memory・Tasksの別リポジトリ化、新しいプロジェクト階層、Workspace CLIの実装は今回の変更に含めない。既存の保存先とCLIを維持し、版数は0.1.8のままとする。導入済みプラグインの更新・コミット・公開は、この削除作業とは別の操作として扱う。

## 検証

- `bun run build`: 240ファイルを生成。
- `bun run build:check`: 正本と生成済み配布物が一致。
- `bun run typecheck`: 成功。
- `bun run test`: 186件成功・2件スキップ・失敗0件、1,546 assertions。スキップは既存のGo版との比較2件。
- 正本とCodex・Claude形式の配布物は、いずれも上記10スキルで一致。残すスキル・製品別定義・共通知識・配布物・テスト・CI・READMEに、削除対象への参照がないことを確認。
- READMEとdocsの計40文書で、ローカルリンクの参照先が存在することを確認。
- `git diff --check`: 成功。

既存の結合テストで、開発リポジトリ外への導入、残すCLIの実行、共通原則のstrict/drift検証、プロジェクト移動後の実行と更新、利用先の独自ファイルの保護を確認した。削除スキルの機能検証は対象から外し、更新テストの対象はbroから残存するrecallへ変更した。
