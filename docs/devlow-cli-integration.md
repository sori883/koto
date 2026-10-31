# 開発スキルと3つのCLIの連携

## 依頼と範囲

ユーザーは、monorepo・Tasks・Memoryをどう組み合わせるかをdevlowで定義し、工程の専門手法を個別スキルへ分ける方針を示した。既存資産のライセンスを確認した後、MITの著作権表示と許諾文を保持して再利用することを了承した。

追加するのはdevlow・recall・tdd・blast-radius・interrogateの5つ。既存のmonorepo・tasks・memoryと合わせて8スキルとなる。CLIの実装と保存形式、外部依存、製品の版数は変更しない。旧orch・OKF CLI、固定エージェント、その他の旧スキル、プラグイン導入用setupは復元しない。

開発ブランチはdevelopから作った`codex/devlow-skills`。検証後は履歴を残すマージコミットでdevelopへ統合する。mainへの統合、版数更新、NPM公開、Macの導入済みプラグイン更新は含めない。

## 正本と再利用元

再利用元はkotoのmainコミット[`77b4d4f87a4c575ccb4b243f2a62acd17cd446a2`](https://github.com/sori883/koto/tree/77b4d4f87a4c575ccb4b243f2a62acd17cd446a2/skills)。当該コミットの5ディレクトリから本文・資料・ひな形・LICENSEを取得した。変更前の全ファイルのSHA-256を[再利用元の記録](devlow-restoration-source.json)へ保存している。

5つのLICENSEはいずれもMITで、`Copyright (c) 2026 Lauren Tan`の表示を含む。LICENSEはバイト単位で保持し、Codex・Claude Codeの各配布ディレクトリにも同梱する。TDD本文も再利用元と同一。ほかの本文は現在のCLI・配置・責務へ合わせて更新した。ルートのライセンスだけで個別スキルの表示を置き換えない。

上流の追跡情報は既存の[devlowの出典](skills/devlow/upstream.md)と[pstack採用記録](skills/pstack-adoption.md)を参照する。今回直接復元した対象は上記kotoコミットであり、その中に含まれる工程資料も再利用対象とする。新たに上流の最新内容を取り込んだという意味ではない。

配布本文には利用者・実行AI向けの手順だけを置き、出典の追跡、原版からの変更、開発時の検証はこのdocs側で管理する。

## 役割と変更点

| スキル | 役割・接続 |
| --- | --- |
| devlow | 工程と終了条件を選び、3つのCLIの操作結果を受け渡す。工程資料は必要な時だけ読む |
| recall | 最新Tasks、checkpointの保存時点、Worktree・Gitの実態、関連Memoryを照合して現在地・残件・再開条件を返す |
| tdd | 局所的な失敗の再現、最小修正、再確認。CLI連携を持たない既存の専門手順 |
| blast-radius | 影響先と安全性の前提を調べ、必要なMemoryを選択project内で検索する |
| interrogate | 許可され利用可能な独立担当へ同じ対象と条件を渡し、根拠を照合する |

devlowの入口には全資料を埋め込まず、工程選択を`workflow.md`、CLI間の操作を`tools.md`へ分けた。工程資料は入力・成果物・通過条件・失敗時の戻り先を持ち、専門手法を必要な箇所から呼ぶ。

旧スキルやCLIへのリンクは現在の3スキルへ置き換えるか、工程に必要な説明へまとめた。保存先は`.space/<project>/tasks/<task-id>/`にそろえた。タスクの最新状態・依存・成果物参照はTasksを正本とし、Markdownに第二の状態管理を作らない。小規模ならTasksのdescription・resultで足り、task.mdを必須にしない。

複数タスクの計画はTasksの同一project内の依存を使う。親子・担当・承認は現在のCLIのフィールドと誤認させず、必要な計画やdescriptionに明記する。専門エージェントの名前・モデルを固定せず、環境の権限と実際に使える委任手段に従う。

## 操作の境界

- 同じroot・project・task・repoの識別子を渡し、各CLIの管理ファイルを直接編集しない。
- workspace linkは参照登録なので、実際の作業場所を準備・確認してから記録する。
- Tasksのpausedは実プロセスの停止ではない。checkpointは保存時点のスナップショットであり、最新状態でもコードのバックアップでもない。
- 再開時は依存先の版を照合し、入力が変わっていれば実作業を止めてreopenから新しい試行を始める。
- 読み取り専用のrecallは初期化・状態更新・Memory復旧をしない。monorepoの削除プレビューも更新取得を伴うため実行しない。
- 完了記録、成果の合格、Gitへの保存・公開、Worktreeの片付けを別々に確認する。
- 部分成功した作業場所・知識保存を巻き戻さず、操作ID・version・content_hashと各CLIの復旧手順で未完了の操作を続ける。

## 検証

2026-11-01のローカル確認：

| 確認 | 結果 |
| --- | --- |
| 型検査 | `bun run typecheck`成功 |
| 配布テスト | `bun test tests/distribution`：9件成功、282 assertions |
| 生成物 | `bun run build`で188ファイルを生成、`bun run build:check`一致 |
| スキル形式 | host skill-creatorのquick_validate.pyで追加5件すべて成功 |
| LICENSE | 再利用元ハッシュと一致。両製品のコピーが正本と一致。TDD本文も元ハッシュと一致 |
| Codex 0.164.0 | app-serverのplugin/readで配布先の8スキルすべてenabled |
| Claude Code 2.1.307 | セッション限定のplugin detailsで8スキル、追加agents/hooks/MCPなし |

配布テストは現物の8スキルと3CLIを隔離した生成用fixtureへコピーし、リンク解決、LICENSE保持、生成物照合を行う。文面や見出しの文字列を固定するテストは追加していない。

host skill-creatorの独立した試行手順に従い、配布物をリポジトリ外へコピーした。評価担当には利用者の依頼・対象スキル・生のfixtureだけを渡し、スキルへの修正案や評価の期待回答は渡していない。外部通信・追加担当・koto本体への編集を許可しない範囲で、次の2件を試した。

| 依頼 | 実結果と照合 |
| --- | --- |
| `greet(name)`が契約のHelloではなくHiを返すため、タスク作成・修正・テスト・結果記録まで進める | Tasks作成、Memoryの契約参照、monorepoでWorktree準備とlink、start、TDD、3成果物参照、complete。修正前2失敗、修正後2成功。コードとテストの差分、Tasksのversion 7・completed・completionCurrentを親側で読戻し確認。commit・push・片付けなし |
| default/greetingの現在地を確認する。再開やファイル更新はしない | checkpointのrunning/version 4と最新paused/version 5、記録にはないHelloへの未コミット修正、依存contractのversion 3から6への変化を区別。テストの実行証拠なしと説明し、reopen後の再確認を提案。確認前後の全65ファイルのSHA-256が一致 |

独立担当の一時フォルダではBun 1.3.14が選択された。要求下限1.4.2未満だったため、その試行を必要版での確認と混同しない。親の開発環境はBun 1.4.4で、配布テストと型検査を実施した。修正後のfixtureの2テストも1.4.4の絶対パス指定で実行し、成功した。独立担当の当初の記録は書き換えていない。

この試行はdevlow・recallの操作判断と生成された実記録を確認するもので、製品デスクトップ画面やClaude Codeモデルからの自然言語依頼の確認ではない。blast-radius・interrogateの全実行経路や、すべての失敗・中断・再開パターンを実モデルで網羅したものでもない。CLI自体の保護条件・再実行は既存の各CLIテストで扱う。
