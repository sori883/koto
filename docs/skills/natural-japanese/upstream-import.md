# natural-japanese・critical-thinkingの取り込み

## v2.0.0への更新（2026-11-11）

ユーザーの更新依頼により、[coji/natural-japanese v2.0.0](https://github.com/coji/natural-japanese/releases/tag/v2.0.0)を取り込む。koto内の従来版は、原版のプラグイン情報ではv1.5.0だった。

- 対象タグ: `v2.0.0`。公開日は2026-11-05。
- タグが指すコミット: [`1fb57128a2f0d160e61320154226fdc86343ee2a`](https://github.com/coji/natural-japanese/tree/1fb57128a2f0d160e61320154226fdc86343ee2a)。確認時のmain先頭`840bd400cbcb64c8b64d492a144da54fc05776c5`ではなく、リリースの内容を固定した。
- `skills/natural-japanese/`の20ファイルを原版どおり更新し、廃止された参照資料9ファイルを削除する。原版のMIT LICENSEを追加する配置は維持する。
- `skills/critical-thinking/`の5ファイルと同じMIT LICENSEを新規に同梱する。natural-japaneseからの論旨検査の案内と、critical-thinkingから日本語を推敲する案内が、同じ配布物内で成立する。
- 原版リポジトリの開発用`dev/`・`corpus/`・`evals/`・`release-notes/`、プラグイン設定、READMEは配布対象に加えない。取り込みの経緯や検証記録もスキルへ追記しない。
- kotoの配布バージョンは`0.1.12`とし、Codex・Claude Code形式とカタログを生成する。CopilotはClaude Code形式を共用する。

### 主な変更と実行条件

natural-japaneseは、意味や確信の度合いを変えない推敲手順と、段落単位の確認を更新した。`paragraphs.py`で段落の一覧、`calques.py`で分野の呼び名から外れた表現の候補、`newfacts.py`で元の文書にない数値・固有名詞等を取得できる。Python 3.10以上とuvを使い、外部依存は原版のインライン定義を維持する。

critical-thinkingは、論理構造の抽出、前提の検査、確認を経た改稿・短縮・構成の見直しを扱う。`coverage.py`はPython 3.11以上とPyYAMLを使い、文書の非空行が分析結果の行番号に対応しているかを点検する。自然言語の検査・改稿はAIが行い、このスクリプトだけで論旨の正しさを判定するものではない。

### 検証

2026-11-12（日本時間）に、Bun 1.4.2とuv 0.13.4で以下を確認した。

- natural-japaneseはLICENSEを含む21ファイル、critical-thinkingは同6ファイルについて、正本・Codex形式・Claude Code形式が原版v2.0.0とバイト単位で一致した。ファイル集合も一致し、旧参照資料の残存がないことを確認した。
- 原版`dev/check-fixtures.sh`の期待件数と一致した。ai-smellyは通常22件・experimental指定29件、naturalは両方0件。fixtures内のコメントには以前の25・33件が残っているが、原版のファイル内容は変更していない。
- Codex・Claude Code・Copilot用の配布物をリポジトリ外へコピーし、従来のlint・outline・termsに加えてparagraphs・calques・newfactsを実行した。段落の抽出、不自然な表現の候補、原文にない数値の検出と入力文書の保持を確認した。
- 同じ外部配置でcritical-thinkingのcoverageを実行し、分析結果にない本文の行を検出して終了コード1を返す場合と、対応を補って終了コード0・OKになる場合を確認した。本文と分析結果は変更されず、利用先のpackage.jsonやlock、仮想環境にも変更を加えていない。
- 全329テスト・2,780 assertionsが成功した。型検査、配布物の生成と全ファイル照合、変更済み・新規ファイルの空白検査も成功した。
- 配布物はCodex 193ファイル・Claude Code 195ファイル、カタログを含めて390ファイル。開発資料のディレクトリ、依存パッケージ、Pythonの実行キャッシュを含まないことを確認した。

最初の全体テストでは、ルートだけ0.1.12にしたことでMemory CLIのバージョン照合が1件失敗した。Memory・Tasksの正本package.jsonも0.1.12にそろえ、全体テストを再実行して成功した。

公開前の追跡ファイル確認で、既存の`.gitignore`の`coverage.*`が新しい`coverage.py`にも一致していた。正本と両製品の当該ファイルを明示的に除外ルールの対象外とし、Gitで管理する。

semanticのモデル取得・推論、calibrateのコーパス校正、AIによる文書改稿の品質評価は実施していない。以上は公開前のローカル検証結果。GitHubへの公開とこのMacへの導入結果は以下に記録する。

### 0.1.12の公開とMacへの導入（2026-11-12）

ユーザーからmainへの公開とこのMacへの反映を依頼された。Gitに記録した内容だけを一時ディレクトリへ展開し、配布関連12テスト・992 assertionsと生成物照合が成功した。GitHub連携のPR作成は権限不足のため、Macに設定済みのGitHub CLIで公開操作を行った。

- [PR #35](https://github.com/sori883/koto/pull/35)をmainへマージした。マージコミットは`0076dd33b86cee6f88a7f9f8441bc901b43fd9a3`。
- [PRのCI](https://github.com/sori883/koto/actions/runs/43047810544)と[マージ後のmainのCI](https://github.com/sori883/koto/actions/runs/43048013216)が成功した。テスト・型検査・生成物照合・空白検査を含む。
- [公式CLIのプラグイン操作](https://learn.chatgpt.com/docs/developer-commands#codex-plugin)で既存のkotoマーケットプレイスを更新し、`koto@koto`を再導入した。取得したマーケットプレイスのコミットは上記マージコミットと一致した。
- 導入先は`~/.codex/plugins/cache/koto/koto/0.1.12`。version 0.1.12、installed・enabled、29スキルを確認した。実行前の全193ファイルがmainのCodex配布物とバイト単位で一致した。
- 導入済みのnatural-japaneseで、不自然な名詞表現の検出、段落の一覧、表現の候補、原文にない数値の検出を確認した。critical-thinkingのcoverageは、不足行の検出と全行対応時の成功を確認した。入力文書と分析結果は保持され、利用先への仮想環境・lockファイルの作成はなかった。
- Memory CLIのバージョン0.1.12と、更新前後の`~/.codex/config.toml`のハッシュ一致を確認した。

この会話が開始時に読み込んだスキル一覧の更新や、モデルによる自動選択は確認対象に含めない。更新したスキルを使う際は新しい会話を開く。

## 初回の原版への置換（2026-10-13）

2026-10-13のユーザー指示「リンク先の原版をそのまま取り込む」により、独自のTypeScript版を原版へ置き換える。旧移植の背景と検証は[過去の記録](implementation.md)に保持する。

### 取込元と範囲

- 取込元: [coji/natural-japanese](https://github.com/coji/natural-japanese)
- 参照コミット: [`9a78a42964096da509b8f3e011f0085a5f080151`](https://github.com/coji/natural-japanese/tree/9a78a42964096da509b8f3e011f0085a5f080151)。取込時のmain先頭と一致する。
- 原版の`skills/natural-japanese/`をファイル内容を変えずに取り込み、原版ルートのMIT LICENSEをスキル直下へ同梱する。
- `SKILL.md`・references・assets・Pythonスクリプト・fixturesを保持する。semanticとcalibrateも原版に含まれるため同梱する。原版ルートの開発用dev・corpus・evalsは取り込まない。
- koto独自のjapanese.ts・bootstrap・kuromojiの依存定義・CLI資料・移植版のテストを削除する。kotoでの回帰・配布検証は`tests/distribution/`に置く。

原版を保持する今回の指示を優先し、原版内の説明やコメントも編集しない。koto側の保守説明・変更経緯・検証記録は配布物へ追加しない。設計方針の例外を[architecture.md](../../architecture.md)へ反映する。

### 実行と配布

通常のlint・outline・termsはPython 3.10以上とuvを使い、Sudachiと辞書を含む依存をスクリプトのインライン定義から準備する。Bunのbootstrapは使わない。scoreは原版の診断手順に従う。

semanticは任意の意味モデル検査で、torch・sentence-transformers等とモデルの取得を伴う。calibrateは原版のcorpusを使う開発用ツールのため、同梱したスキルだけで校正用データを提供するものではない。

Codex形式とClaude形式を既存のbuildで再生成し、CopilotはClaude形式を共用する。Pythonの実行で生じる`__pycache__/`と`.venv/`を生成対象から除外する。CIはuvを準備し、原版CLIを起動する。配布版数は0.1.5を維持する。

原版の`references/doctypes/memo.md`には末尾の空行がある。原版との一致を保つため削除せず、このファイルと生成コピーだけ`.gitattributes`で`blank-at-eof`検査の対象外とする。他の空白検査は維持する。

### 検証

- 原版のスキル全26ファイルとMIT LICENSEについて、正本・Codex形式・Claude形式の内容がバイト単位で一致した。実行時キャッシュを除き、スキル内に原版とLICENSE以外のファイルがないことも確認した。
- 原版の`dev/check-fixtures.sh`に記載された期待値と一致した。ai-smellyは通常25件・experimental指定33件、naturalは両方0件。入力ファイルは変更されなかった。
- Codex・Claude Code・Copilot用の配布物をリポジトリ外へコピーし、uvでlint・outline・termsを実行した。定型句の検出・見出しの抽出・APIという用語の抽出を確認し、入力文書と利用先のpackage.jsonを保持した。利用先にbun.lock・uv.lock・.venvを作成しないことも確認した。
- `bun run test`: 182件成功、既存のGo比較2件スキップ、失敗なし。1,177 assertions。Pythonのキャッシュと仮想環境を配布しない検査も含む。
- `bun run typecheck`、`bun run build`（368ファイル）、`bun run build:check`、`git diff --check`は成功した。初回の型検査では開発依存とOKFの実行依存が未導入だったため、既存のCIと同じ準備手順を実施してから再検査した。

semanticのモデル取得・推論、calibrateのコーパス校正、各クライアントでAIがスキルを選択する操作は実施していない。原版の取り込みと通常の三スクリプトの実行確認を、これらの検証済みという意味には扱わない。
