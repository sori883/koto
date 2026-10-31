# natural-japaneseの原版への置換

この文書は構成整理前の開発・検証記録です。現在の配布構成は[現状資料](../../current-state.md)を参照してください。

2026-10-13のユーザー指示「リンク先の原版をそのまま取り込む」により、独自のTypeScript版を原版へ置き換える。旧移植の背景と検証は[過去の記録](implementation.md)に保持する。

## 取込元と範囲

- 取込元: [coji/natural-japanese](https://github.com/coji/natural-japanese)
- 参照コミット: [`9a78a42964096da509b8f3e011f0085a5f080151`](https://github.com/coji/natural-japanese/tree/9a78a42964096da509b8f3e011f0085a5f080151)。取込時のmain先頭と一致する。
- 原版の`skills/natural-japanese/`をファイル内容を変えずに取り込み、原版ルートのMIT LICENSEをスキル直下へ同梱する。
- `SKILL.md`・references・assets・Pythonスクリプト・fixturesを保持する。semanticとcalibrateも原版に含まれるため同梱する。原版ルートの開発用dev・corpus・evalsは取り込まない。
- koto独自のjapanese.ts・bootstrap・kuromojiの依存定義・CLI資料・移植版のテストを削除する。kotoでの回帰・配布検証は`tests/distribution/`に置く。

原版を保持する今回の指示を優先し、原版内の説明やコメントも編集しない。koto側の保守説明・変更経緯・検証記録は配布物へ追加しない。設計方針の例外を[architecture.md](../../architecture.md)へ反映する。

## 実行と配布

通常のlint・outline・termsはPython 3.10以上とuvを使い、Sudachiと辞書を含む依存をスクリプトのインライン定義から準備する。Bunのbootstrapは使わない。scoreは原版の診断手順に従う。

semanticは任意の意味モデル検査で、torch・sentence-transformers等とモデルの取得を伴う。calibrateは原版のcorpusを使う開発用ツールのため、同梱したスキルだけで校正用データを提供するものではない。

Codex形式とClaude形式を既存のbuildで再生成し、CopilotはClaude形式を共用する。Pythonの実行で生じる`__pycache__/`と`.venv/`を生成対象から除外する。CIはuvを準備し、原版CLIを起動する。配布版数は0.1.5を維持する。

原版の`references/doctypes/memo.md`には末尾の空行がある。原版との一致を保つため削除せず、このファイルと生成コピーだけ`.gitattributes`で`blank-at-eof`検査の対象外とする。他の空白検査は維持する。

## 検証

- 原版のスキル全26ファイルとMIT LICENSEについて、正本・Codex形式・Claude形式の内容がバイト単位で一致した。実行時キャッシュを除き、スキル内に原版とLICENSE以外のファイルがないことも確認した。
- 原版の`dev/check-fixtures.sh`に記載された期待値と一致した。ai-smellyは通常25件・experimental指定33件、naturalは両方0件。入力ファイルは変更されなかった。
- Codex・Claude Code・Copilot用の配布物をリポジトリ外へコピーし、uvでlint・outline・termsを実行した。定型句の検出・見出しの抽出・APIという用語の抽出を確認し、入力文書と利用先のpackage.jsonを保持した。利用先にbun.lock・uv.lock・.venvを作成しないことも確認した。
- `bun run test`: 182件成功、既存のGo比較2件スキップ、失敗なし。1,177 assertions。Pythonのキャッシュと仮想環境を配布しない検査も含む。
- `bun run typecheck`、`bun run build`（368ファイル）、`bun run build:check`、`git diff --check`は成功した。初回の型検査では開発依存とOKFの実行依存が未導入だったため、既存のCIと同じ準備手順を実施してから再検査した。

semanticのモデル取得・推論、calibrateのコーパス校正、各クライアントでAIがスキルを選択する操作は実施していない。原版の取り込みと通常の三スクリプトの実行確認を、これらの検証済みという意味には扱わない。
