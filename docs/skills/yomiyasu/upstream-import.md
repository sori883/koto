# yomiyasuの取込記録

この文書は構成整理前の開発・検証記録です。現在の配布構成は[現状資料](../../current-state.md)を参照してください。

2026-10-13のユーザー依頼により、[nanaism/yomiyasu](https://github.com/nanaism/yomiyasu)をkotoへ追加する。natural-japaneseに続く原版スキルの取り込みとして扱い、TypeScriptへの移植や本文の書き換えは行わない。

## 出典と取込範囲

- 参照コミット: [`60bf877acebc86651e0b67d70112a66245f87758`](https://github.com/nanaism/yomiyasu/tree/60bf877acebc86651e0b67d70112a66245f87758)。取込時のmain先頭。原版マニフェストの版数は1.1.2。
- 原版の`skills/yomiyasu/`から、`SKILL.md`、referencesの5文書、assetsの画像、scriptsの3ファイル、MIT LICENSEとUNICODE-LICENSE.txtを内容を変えずに取り込む。計12ファイル。
- 原版の単独プラグイン用`.claude-plugin/`は取り込まない。kotoの製品別マニフェストとカタログで配布する。
- 原版ルートの重複コピー、README、tests、evals、コーパス生成・測定ツールは配布対象にしない。出典と検証記録はこの文書に置き、スキル本文へ追加しない。

## 実行と配布

`yomiyasu_lint.py`は日本語の表現とMarkdownを検査し、`yomiyasu_diff.py`は推敲前後の語句・文末・構造・文の種類の変化を検査する。両方が共有する`markdown_visibility.py`も同梱する。Python標準ライブラリだけで動き、追加のパッケージ導入やモデル取得は不要。

検出結果は見直し候補であり、読みやすさや意味の保持を自動で保証するものではない。原版の他の日本語校正スキルとの併用に関する注意もそのまま保持する。

Unicode由来データに必要な著作権・許諾通知を落とさないよう、buildの配布対象へ`UNICODE-LICENSE.txt`を追加する。Codex形式・Claude形式を生成し、CopilotはClaude形式を共用する。Pythonの実行キャッシュは既存の除外規則で配布しない。kotoの版数は0.1.5を維持する。

## 検証

- 正本・Codex形式・Claude形式の12ファイルが、上記コミットの原版とバイト単位で一致した。MIT LICENSEとUNICODE-LICENSE.txtの同梱と、単独プラグイン用マニフェストが含まれないことも確認した。
- Codex・Claude Code・Copilot用の配布物をリポジトリ外へコピーし、Python 3.13でlintとdiffを実行した。「時間を溶かす」の検出と、「原因は設定ミスだとされる。」から「原因は設定ミスだ。」への変更で伝聞が失われたことの検出を確認した。入力ファイルは変更されなかった。
- `bun run test`: 182件成功、既存のGo比較2件スキップ、失敗なし。1,209 assertions。buildのUnicodeライセンス同梱検査と、三製品での実行検査を既存テストに追加した。
- `bun run typecheck`、`bun run build`（392ファイル）、`bun run build:check`、`git diff --check`は成功した。更新した文書の相対リンクも解決できた。スキル数は25件。

各クライアントでAIがスキルを選択して文章を推敲する操作と、原版の全回帰テスト・コーパス評価は実施していない。今回の確認範囲は配布内容の一致と付属ツールの実行である。
