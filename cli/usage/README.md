# koto-usage

Tasks・MemoryのCLI利用、recallの実行報告、savepointの保存件数をプロジェクトごとに確認します。Bun 1.4.2以上で動き、実行時の外部依存はありません。入口はこのREADMEと同じディレクトリの `usage.ts` です。

## 計測を始める

```sh
bun /path/to/cli/usage/usage.ts enable --root /path/to/repository --project default --json
bun /path/to/cli/usage/usage.ts stats --root /path/to/repository --json
bun /path/to/cli/usage/usage.ts list --root /path/to/repository --component recall --json
bun /path/to/cli/usage/usage.ts disable --root /path/to/repository --json
```

`--root`は必須、`--project`の既定値はdefaultです。有効化はそのrootとprojectだけに適用します。Tasks・Memoryの初期化やsetupの実行は不要です。無効化しても過去の履歴は消しません。`stats`と`list`は読み取り専用で、未初期化の対象にファイルを作りません。

有効化後はTasks・MemoryのCLI呼び出しを終了時に自動記録します。記録を省く呼び出しには `--no-activity`（JSON入力では `noActivity: true`）を付けます。読み取り専用・書き込み禁止の依頼ではこの指定を使い、Memoryの `--record-usage` も省いてください。`--no-activity`はCLI本来の更新操作や、明示的な `--record-usage` の保存を禁止する指定ではありません。

## 何が分かるか

| 対象 | 集計するもの | 数字の意味 |
| --- | --- | --- |
| Tasks | 操作別の呼び出し数・成功・失敗・replays | 再試行も1呼び出し。replaysは既存の操作結果を返した回数で、新たな更新ではない |
| Memory | 操作別の呼び出し数・成功・失敗、検索・本文取得・空の検索、知識ID別の取得数 | search_resultsは検索結果への出現、showsは本文の取得。成功したCLI呼び出しだけを取得数に含める |
| recall | 日時・任意の既存タスクID・結果の自己申告 | スキルを実行したAIが記録した履歴。実行環境が検出した起動数ではない |
| savepoint | `.space/<project>/savepoint/` 以下に現在ある `.md` ファイル数 | 保存回数ではない。更新は増えず、削除で減る。指定フォルダ外のファイルや会話だけの記録は含まない |

setupスキルとdevlaw自体の起動数は集計しません。Tasksの `setup` とMemoryの `init` は、それぞれのCLI操作として数えます。知識の取得は、読解・判断への採用・成果の改善を証明しません。0件は「記録された利用が0件」であり、未使用とは限りません。

Memoryの従来の `usage list/stats` は、`--record-usage`を指定した検索・本文取得の詳細記録です。保存先も別で、この集計には合算しません。同じ呼び出しを両方で記録しても、この集計では1回です。実行者・呼び出し元・本文ハッシュが必要な場合は従来の記録も使えます。

## 期間と履歴

```sh
bun /path/to/cli/usage/usage.ts stats --root /path/to/repository --since 2026-11-01T00:00:00+09:00 --until 2026-12-01T00:00:00+09:00 --json
bun /path/to/cli/usage/usage.ts list --root /path/to/repository --component memory --limit 50 --json
```

`--since`はその時点を含み、`--until`は含みません。タイムゾーン付きのISO日時を使います。`--component`はtasks・memory・recallから選びます。listは新しい順で既定20件、`--limit`は最大100件、`--all`なら全件です。totalは絞り込み後、件数制限前の数です。

期間とcomponentの条件はイベントに適用します。savepointの件数は常に現在のファイル数です。存在しないフォルダは `exists: false`、シンボリックリンクは辿らず `skipped_symlinks` に件数を示します。既定フォルダ以外の保存先は探索しません。

## recallを記録する

recallを実行したAIは、結果を返す前に1回記録します。UUID v4を新しく生成し、同じ実行の記録を再試行する場合は同じIDと入力を使います。

```sh
bun /path/to/cli/usage/usage.ts record recall --id <UUID-v4> --root /path/to/repository --project default --outcome success --json
```

復元できずに終えた場合は `--outcome failure`。既存タスクが分かる場合だけ `--task-id`を付けます。successは復元結果を返したという申告であり、その内容の正しさを保証しません。有効化していない場合は `recorded: false` を返し、ファイルを作りません。計測のためのタスク作成、Memoryの初期化、自動有効化は不要です。明示的な書き込み禁止・記録不要の依頼では記録コマンドを実行しません。

## 保存範囲と限界

設定は `.space/<project>/usage/config.json`、イベントは同じusage配下の `events/<UUID>.json` へ保存します。記録するのは日時、project、対象CLI・操作、成否、必要なタスクID・知識ID・再試行の有無です。検索文、本文、タスク名、コマンド引数、エラー本文は複製せず、外部への送信もしません。

help、version、利用履歴の照会、引数の解析や対象の確定に至らない失敗、直接のファイル参照、CLIを通さないAPI呼び出しは記録しません。終了前の強制停止やログ保存の失敗でも欠落します。CLIの成否は保存全体の原子性を表さず、失敗時の一部保存やdry-run・変更なしの区別は元のCLI応答で確認してください。

計測の保存に失敗した場合、Tasks・Memoryの応答と終了コードを保ち、標準エラーへ警告します。履歴の照会時に壊れたイベントを見つけた場合はエラーにし、0件や完全な集計として返しません。書き込み中または中断で残った一時ファイルは `pending_files` として示し、イベント数に含めません。設定のupdated_atは最後に有効・無効を変更した日時で、欠落のない計測期間を意味しません。
