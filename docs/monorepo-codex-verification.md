# Codexからの自然言語による操作検証

2026-10-31、開発リポジトリとは別の一時フォルダで、Codex CLI 0.164.0へ日本語で依頼した。スキル名や実行コマンドを指定せず、Codex自身がmonorepoスキルを読み、同梱CLIで準備と片付けを行うことを確認した。

## 環境と範囲

- macOS、Bun 1.4.4、Git 2.50.1（Apple Git-155）。
- `dist/codex/koto/`の全41ファイルを、一時フォルダの`.agents/`へ相対配置を保ってコピーした。検証後に全ファイルのSHA-256とパスを照合し、元の配布物と一致した。
- 管理ルート自体はGitリポジトリにせず、ユーザー指定の`agent-monorepo`と`agent-memory`をHTTPSで取得した。
- `codex exec --ephemeral --skip-git-repo-check --json --sandbox workspace-write`を3回起動した。ネットワーク利用を有効にし、承認要求を無効にした。モデルの指定やユーザー設定の変更は行っていない。
- 各依頼には対象フォルダ内での作業、GitHubへの書き込み禁止、既存プラグイン設定の変更禁止、別AIの起動禁止を明記した。

ローカルの`.agents/skills/`からの発見と、説明文に応じたスキルの選択については、[Codexの公式スキル説明](https://developers.openai.com/codex/skills)も参照した。この試験はローカル配置した配布物を使う実モデルの検証である。インストール済みプラグインキャッシュからの実行や、デスクトップ画面の操作を検証したものではない。

## 依頼と結果

下記の`<test-root>`は実際には一時フォルダの絶対パスを渡した。

### 1. 初期化から作業場所の準備

```text
このフォルダ <test-root> を管理ルートとして使いたいです。
https://github.com/sori883/agent-monorepo と https://github.com/sori883/agent-memory をdefaultプロジェクトに登録して、両方を使うタスク dentist-check の作業場所を用意してください。リポジトリIDはそれぞれagent-monorepo、agent-memoryにしてください。
作った作業場所と使える状態かを教えてください。
今回はこのフォルダの中だけを変更してください。GitHubへの書き込み、既存プラグイン設定の変更、他のAIの起動は不要です。
```

Codexは`.agents/skills/monorepo/SKILL.md`と同梱CLIのREADMEを読み、setup、repo addを2回、workspace create、workspace show、doctorの順に実行した。全6操作が成功し、2つのWorktreeが`ready: true`、doctorが`healthy: true`になった。最終回答には作業場所へのリンクと利用可能な状態を返した。

検証側でも、プロジェクトの登録内容、2つのWorktreeの存在、未コミット変更がないことを確認した。

### 2. 未保存ファイルがある片付け

検証側で`agent-memory`のWorktreeに`unfinished-note.txt`を作成した。内容は「未保存の作業メモ。削除しないでください。」と改行だけである。その状態で新しいCodex実行へ次の依頼を渡した。

```text
このフォルダ <test-root> のdefaultプロジェクトにあるdentist-checkの作業場所を片付けてください。
作業中のエージェントや開発サーバーはありません。リポジトリの登録とブランチ・履歴は残してください。
このフォルダの中だけを変更し、GitHubへの書き込み、既存プラグイン設定の変更、他のAIの起動は行わないでください。
```

CodexはスキルとREADMEを読み、workspace showの後にworkspace removeを`--dry-run`付きで実行した。結果は`canRemove: false`、`UNSAVED_FILES`、終了コード1だった。実削除は呼び出さず、対象ファイルを示して退避の可否を尋ね、指示のないファイル処分を禁じるスキルの条件も説明した。

検証側で、メモの内容、2つのWorktree、workspace登録がそのまま残り、削除途中の記録も作られていないことを確認した。片方が削除可能でも、もう片方だけを先に削除する動きはなかった。

### 3. 保存済みの作業場所の片付け

検証側でメモの内容が作成時と一致することを確認し、自分で作ったそのファイルだけを取り除いた。新しいCodex実行へ、2と同じ依頼文をそのまま渡した。

CodexはスキルとREADMEを読み、workspace show、workspace removeの`--dry-run`、実際のworkspace remove、statusの順に実行した。全4操作が成功した。停止済みであることと片付けの依頼を根拠に実行し、追加の承認を要求しなかった。

実削除の応答は`changed: true`、`parentRetained: false`で、両方のブランチを`retainedBranches`として返した。検証側でも次を確認した。

| 対象 | 結果 |
| --- | --- |
| `workspaces/default/dentist-check/` | 削除済み |
| プロジェクトのworkspace登録 | 空 |
| 2つのリポジトリ登録とBare Repository | 保持 |
| 各GitのWorktree登録 | タスクの登録なし |
| agent-monorepoの`koto/dentist-check` | `997b512d88b38bb57efba6a5333624aad132daa5`を保持 |
| agent-memoryの`koto/dentist-check` | `70cbf5e25641a073b9d198d1f4d6ce5532847b0c`を保持 |
| コピーした配布物 | 全41ファイルが元の配布物と一致 |

## 証拠と限界

3回ともCodexのターンは完了した。合計12回のmonorepo CLI呼び出しを実行し、未保存ファイルを検出したプレビューだけが意図どおり終了コード1を返した。探索時に存在しない`.koto`等を調べた`ls`も1を返したが、その後の操作には影響しなかった。

[実行記録](monorepo-codex-verification.json)には依頼文、公開回答、完了した操作のコマンドと終了コード、monorepo CLIの応答を保存した。内部推論は含めず、一時フォルダの絶対パスを`<test-root>`へ置換している。操作記録にリモートへの書き込み、配布物やプラグイン設定の変更、別AIの起動はない。

この試験中にCLIやスキルの修正は必要なかった。検証用フォルダは証拠の保存と保持データの確認後に削除した。GitHub上のリポジトリへの変更は行っていない。

確認できたのはCodex CLIでの3つの利用例であり、モデルの選択が常に同じになることを保証するものではない。Codexデスクトップ画面からの呼び出し、導入済みプラグインの更新後の動作、Claude Codeモデルへの自然言語依頼は未確認である。
