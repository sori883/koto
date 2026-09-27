# natural-japaneseのBun対応

2026-09-26。ユーザーはPythonを依存に含めず、通常検査をkuromojiとBunへ移し、意味モデルによるsemanticを除く案を承認した。

配布版数は0.1.4。ルートpackage.jsonから製品別マニフェストとカタログを再生成し、スキルの正本と同じ変更に含める。

## 出典と採用設計

- 原版: [coji/natural-japanese](https://github.com/coji/natural-japanese/tree/9a78a42964096da509b8f3e011f0085a5f080151)、参照コミット `9a78a42964096da509b8f3e011f0085a5f080151`。MIT LICENSEをスキルに同梱する。
- 比較したSudachi WASMは原版と同系統の解析器だが、事前試行では約160MBの展開容量と約1.1GBのRSSを要した。kuromoji 0.1.2は約40MB、約340MBであり、ユーザーが選んだ後者を採用する。これらはこのMacとBun 1.4.2での参考測定で、配布先の性能保証ではない。
- Python・uv・PyTorch・外部モデル・ネイティブビルドを要求しない。実行依存はスキル自身のscriptsに固定し、既存CLIのbootstrap方式を使う。
- lintの通常検出器、読解負荷の独立出力、baseline比較、ジャンル指定、構造抽出、用語抽出、診断、執筆・推敲と文体プロファイルを採用する。静的な実験検出器は明示オプションに残し、semanticとコーパス校正用calibrateは配布しない。
- 辞書、分割、品詞体系が変わるため、原版と同一の検出結果・校正精度とは扱わない。kuromojiの助詞「連体化」の「の」を読解負荷の対象にし、基本形・読み・固有名詞を利用する。変更の説明と検証記録はこの文書に置く。

## 実装・検証計画

担当範囲は新しいskills/natural-japanese、両製品の生成物、README・現状資料、ルートのテスト対象とCIの起動確認。既存スキルの動作と配布設計は変更しない。

入力保護・行番号、形態素判定、短文の統計抑制、読解負荷とスコアの分離、重複baselineの対応、outlineとtermsの抽出を振る舞いテストで確認する。リポジトリ外でBunだけをPATHに置き、初回・再起動・lock変更後の起動、利用先のファイルを変更しないことを確認する。全体の型検査・テスト・配布生成照合を実行する。

## 検証結果

`bun run test`は186件成功・2件スキップ・失敗なし（1,168 assertions）。スキップはGo実行環境がないための既存OKF比較テストである。

`bun run typecheck`、Markdownのリンク検査を含む`bun run build`、`bun run build:check`、`git diff --check`も成功した。生成ファイルは両製品合計378件で、配布物と正本が一致している。

- 新しい解析テスト12件で、保護領域と行番号、絵文字を含む位置、形態素判定、短文・本文なしのスコア抑制、読解負荷の分離、ジャンル差、baselineの重複対応、構造と用語の抽出を確認した。原版のnatural / ai-smelly例文も検査し、前者では通常・実験検出の指摘なし、後者では定型句等を検出した。
- CLIテスト4件で、BunだけをPATHに置いた初回導入・再起動・lock変更後の起動と、不正入力・凍結lock不一致・祖先workspaceへの混入防止を確認した。利用先の文書、package.json、lock、node_modulesを変更しない。
- Codex・Claude Code・Copilot用の配布物をリポジトリ外へコピーする既存試験にもlintを追加し、辞書の自動導入と利用先の保護を確認した。
- frontmatterの形式、Pythonファイルを配布しないこと、原版MIT LICENSEとの一致をBunで検査した。

Markdownの保護領域はlint・outline・termsで共通に扱い、URLやコードを統計と用語抽出に混ぜない。本文が100文字未満ならscoreはnullとする。読解負荷は別の出力で、base scoreに加減算しない。full手順の独立レビューは実行環境に応じて逐次でも進められ、主観評価を任意の点数に達するまで反復させない。

原版のPython実装を実行した比較と、多数の文章を用いたkuromoji向け閾値の再校正は行っていない。例文の検査成功は検出精度や原版との互換性の保証ではない。semantic用の意味モデル、実験用コーパス、校正CLIは含めない。
