# explain-before-shortenの取込記録

2026-10-29のユーザー指示により、記事で公開されたスキルを原文のままkotoへ同梱する。

## 出典と取込範囲

- 著者: Kazuki Ota。
- 出典: [AI の謎な説明文を直すスキル](https://zenn.dev/microsoft/articles/explain-before-shorten)。記事の公開日は2026-10-26、取得時点の更新日は2026-10-29。
- 取得日: 2026-10-29（日本時間）。公開HTML内の`SKILL.md`コードブロックを抽出し、HTMLエンティティを復号した文字列をUTF-8で保存した。本文・空白・末尾改行は変更していない。
- 保存先: `skills/explain-before-shorten/SKILL.md`。8,841バイト。
- SHA-256: `bb96bfb03fad06636c2977f3bc3792c733afe4bbf486bc96af2b0cbfbc77f19e`。

記事の説明文、コメント欄、広告は取り込まない。既存のunslop・natural-japanese・yomiyasuは変更せず、独立したスキルとして追加する。スキル本文へ出典説明・保守手順・検証記録を追記しない。

原文にある`slide-review`・`markdstage`・`markdstage-local`への言及も保持する。これらの関連スキルは今回の同梱範囲に含めない。付属CLI・外部パッケージはない。

取得した記事とスキルのコードブロックにはライセンスの指定がない。取り込みの依頼を著作者による許諾の確認とは扱わず、MIT等のライセンス表記を追加しない。

## 取り込み時の検証（元の作業ツリー）

既存のbuildでCodex形式・Claude形式を生成し、CopilotはClaude形式を共用する。プロジェクト導入用manifestにも既存の生成処理で追加する。build・setupのコードと版数0.1.5は変更しない。

- 記事から抽出したコードブロック、正本、Codex形式、Claude形式の`SKILL.md`がバイト単位で一致した。上記SHA-256とも一致した。
- 両製品の`setup-manifest.project.json`に、Codexは`.agents/skills/explain-before-shorten/SKILL.md`、Claude Codeは`.claude/skills/explain-before-shorten/SKILL.md`へのコピーを確認した。
- `bun test tests/distribution/build.test.ts tests/distribution/project.test.ts`: 4件成功、失敗なし、711 assertions。リポジトリ外への全スキルの実ファイル導入と内容一致、配置後の移動・更新を既存のテストで確認した。
- `bun run typecheck`、`bun run build`（396ファイル）、`bun run build:check`、`git diff --check`は成功した。スキル数は26件。
- 配布物に`docs/`が含まれず、新しいスキルの配布ディレクトリには原文の`SKILL.md`だけが存在することを確認した。作業開始時のハッシュと比較し、既存スキル・CLI・製品別定義を変更していないことも確認した。

各クライアントでAIがスキルを選択して文章を修正する操作は実施していない。今回の確認範囲は原文の保持、配布生成、プロジェクト導入であり、リモートへの公開は行っていない。

## 0.1.7の公開対象

公開済みmainの`c73e6b6`を起点に、今回のスキル・説明・取込記録だけを取り込み、版数を0.1.7へ更新して配布物を再生成する。元の作業ツリーにあるnatural-japaneseのPython版への置換、yomiyasu、プロジェクト導入機能は別の未公開変更として保持し、この公開には含めない。公開対象のスキル数は25件。上記のプロジェクト導入テストは元の作業ツリーに対する結果であり、0.1.7の提供機能ではない。

- Bun 1.4.4で`bun run test`: 194件成功、既存のGo比較2件スキップ、失敗なし、1,255 assertions。三製品の配布物をリポジトリ外へコピーした導入・CLI実行検査を含む。
- `bun run typecheck`、`bun run build`（380ファイル）、`bun run build:check`、`git diff --check`は成功した。
- 正本・両形式の配布物のSHA-256が上記の原文と一致し、製品別manifestの版数が0.1.7であることを確認した。
- 最初の全テストでは作業環境のPATHがBun 1.3.14を選んでいたため、最小要件1.4.2を満たさず失敗した。Bun 1.4.4を子プロセスにも使うようPATHを指定して再実行した。テストを通すためのソース変更はない。
