# ローカル変更の反映とプラグイン更新

2026-10-30。Issue #23の整理とは分け、既存の未コミット変更を検証して保存し、このMacに導入済みのCodexプラグインへ反映する。

## 対象

- natural-japaneseを独自TypeScript版から原版のPython版へ置換する。
- yomiyasuと、原版の資料・検査スクリプト・ライセンスを追加する。
- setupに全スキルのプロジェクト導入と、配置済みsetupからの更新を追加する。
- 関連するテスト・CI・説明文書・製品別配布物を含め、版数を0.1.8にそろえる。
- 既存のSerena設定変更は、製品の変更と分けてコミットする。

既存の取込記録にある0.1.5やテスト件数は、2026-10-13時点の記録として保持する。current-state.mdに残っていた「共通原則がstrict検証で不合格」という記述は、既存の修正と今回のテスト結果に合わせて訂正した。

## 差分量の調査

開始時の差分は190ファイル（変更78・削除43・新規69）。112ファイルは生成済みのdist配下、78ファイルはそれ以外だった。新規ファイルのうちテキストは合計31,173改行分あり、主な要因はnatural-japaneseとyomiyasuのPythonコード、および全スキルを列挙するproject用マニフェストである。バイナリはyomiyasuの画像の正本と配布コピーの3ファイル。

スキルは正本とCodex・Claude形式の配布物の計3か所へ保存する設計のため、Pythonコードも3組含まれる。node_modules・__pycache__・.venvやnode.jsonというファイルはコミット対象に含まれていない。開発時の依存パッケージとPythonキャッシュはGitの除外対象である。

## 検証

- `bun run test`: 190件成功・2件スキップ・失敗0件、1,930 assertions。スキップは既存のGo版との比較2件。
- `bun run typecheck`: 成功。
- `bun run build:check`: 配布物と正本の一致を確認。
- `git diff --check`: 成功。
- 0.1.8への版数更新後、`bun run build`で396ファイルを生成し、`build:check`も成功した。`bun test tests/distribution`は12件成功・失敗0件、972 assertions。

ステージ後の`git diff --cached --check`で、これまで未追跡だった原版のlint.py・outline.py・terms.pyの末尾空行を検出した。原版との一致を保つため、既存のmemo.mdと同様に、この3ファイルと製品別コピーだけ`.gitattributes`で`blank-at-eof`を除外した。他の空白検査は保持し、変更後のステージ済み差分検査は成功した。

テストには、リポジトリ外での各CLIの実行、Codex・Claude Codeへのプロジェクト導入、配置後の移動・更新、通常のプラグイン導入、共通原則のstrict/drift検証を含む。

## ローカルのプラグイン

導入済みの対象はCodexの`koto@koto`（更新前0.1.7）。Claude Codeの登録情報にはkotoの導入がなかった。Codexの既存登録はGitHubのmainを参照しているため、インストール時だけローカルのマーケットプレイスを指定し、検証済み配布物を導入した。

- `codex plugin add`はversion 0.1.8を返した。通常の`codex plugin list --marketplace koto --json`でも0.1.8・installed・enabledを確認した。
- 導入先は`~/.codex/plugins/cache/koto/koto/0.1.8`。初回実行前の196ファイルがCodex配布物とバイト単位で一致し、26スキルを含む。
- 導入済みのOKF・orch・setup・natural-japanese・yomiyasuのCLI起動を、リポジトリ外の一時ディレクトリから確認した。
- `~/.codex/config.toml`は更新前とバイト単位で同一。GitHub mainの配布元設定と有効化設定を保持した。

更新には[公式CLIのプラグイン操作](https://learn.chatgpt.com/docs/developer-commands#codex-plugin)を使用した。既存の会話が読み込んだスキル一覧は今回の確認に含めず、新しい会話で更新版を利用する。

この作業ではGitHubへのpushやIssue #23の更新を行わない。モデルによるスキル選択やエージェント起動は、ファイル内容とCLI実行の確認から区別する。
