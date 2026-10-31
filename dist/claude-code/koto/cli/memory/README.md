# @koto/memory

プロジェクトごとの知識・経験・手順・設計判断をOKF v0.2のMarkdownで保存するCLIです。実行名は `koto-memory`。Bun 1.4.2以上が必要です。Git、Tasks、monorepo CLI、外部サービスへの接続は必要ありません。

このディレクトリの `memory.ts` をBunで実行します。コマンド登録済みなら `koto-memory` でも実行できます。

```sh
bun /path/to/plugin/cli/memory/memory.ts setup --root /path/to/workspace --json
bun /path/to/plugin/cli/memory/memory.ts create knowledge/auth --root /path/to/workspace --type knowledge --title "認証方式" --desc "トークンを検証する理由" --body "判断と根拠を記録する。" --actor agent:codex --json
bun /path/to/plugin/cli/memory/memory.ts search "認証" --root /path/to/workspace --json
bun /path/to/plugin/cli/memory/memory.ts show knowledge/auth --root /path/to/workspace --json
```

`--root` は既存の管理ルートを明示します。現在位置からの自動探索は行いません。プロジェクト省略時は `default`、保存先は `.space/<project>/memory/` です。プロジェクトIDは先頭が小文字英数字の1〜64文字で、小文字英数字・`-`・`_`を使えます。`constructor`・`prototype`は予約名です。明示した未知のプロジェクトや未初期化のMemoryは、通常操作ではエラーになります。初期化したい場合に限り `setup` / `init` を使います。

## 操作

| コマンド | 内容 |
| --- | --- |
| `setup` / `init` | Memoryと各分類の目次・ログを準備。既存の内容を保持して再実行可能 |
| `create <id>` | 新しい知識を保存し、目次と変更ログを更新 |
| `show <id>` | メタデータ・本文・元のMarkdown・内容のハッシュを取得 |
| `search [query]` | 日本語・英語の語句検索、分類・属性・コード参照で絞り込み |
| `update <id>` | 指定した属性・本文を更新。省略項目と未知の属性を保持 |
| `relate <source> <target>` | sourceの本文へ同一プロジェクト内の関連リンクを追加 |
| `delete <id> --dry-run` | 削除対象、参照元の変更、孤立する知識を確認 |
| `delete <id>` | 対象と管理リンクを削除し、削除ログを記録 |
| `validate` | 形式、リンク、検証記録、有効期限を点検 |
| `recover --dry-run` / `recover` | 中断した書き込みの残りを確認・再開 |

分類は `rule`・`principle`・`knowledge`・`procedure`・`decision`。IDは `rules/安全な名前`・`principles/...`・`knowledge/...`・`procedures/...`・`decisions/...` のように分類に対応するディレクトリから始め、末尾の`.md`は付けません。`knowledge/auth/token`のような階層を使えます。隠しディレクトリ、`..`、目次・ログ用の名前は指定できません。

## 知識の形式

各ファイルはYAML frontmatterとMarkdown本文を持ちます。必須属性は `type`・`title`・`description` です。

- `tags`: 重複のない文字列配列。
- `status`: `draft`・`stable`・`deprecated`。省略時はstableとして検索。
- `governance`: `context`・`constraint`・`hold`。省略時はcontext。分類検索やコード参照検索ではhold、constraint、contextの順。
- `generated`: CLIが更新者と日時を設定。`--actor agent:codex` などで更新者を明示。
- `verified`: 人間による確認記録の配列。各要素は `{"by":"human:alice","at":"2026-10-31T10:00:00+09:00"}`。実際の確認を根拠に記録し、自動的に確認済みとはしません。
- `stale_after`: 見直し期限をタイムゾーン付き日時で指定。
- `sources`: 根拠の配列。各要素の `resource` は必須。`id`・`title`・`author`・`last_modified`・`usage_count`も指定可能。
- `code_refs`: 管理ルートからの相対パス・ディレクトリ・globの配列。

JSON互換の独自属性を保持します。更新時はYAMLの値と本文を保持しますが、YAMLのコメントや表記形式は再整形されます。内容が同じ更新は日時やログを変更しません。

`--metadata-json`でJSON属性、または`--metadata-file`でJSON・YAML・Markdownのfrontmatterを渡せます。両者は同時指定できません。`--type`・`--title`・`--desc`・`--tags`（カンマ区切り）・`--status`があれば該当属性を上書きします。本文は`--body`または`--body-file`で渡します。明示した入力ファイルは管理ルート外でも読み取ります。

更新では`--unset <key>`を繰り返して任意属性を削除できます。`--sync`は変更のない知識についても目次・ログを修復します。`--no-index`・`--no-log`は目次やログの更新を省く指定で、`--sync`とは併用できません。

`show`の`content_hash`を `update`・`relate`・`delete` の`--if-hash`に渡すと、読んだ後に変更されている場合は`VERSION_CONFLICT`で停止します。`relate`ではsource、`delete --dry-run`でも削除対象のハッシュを返します。ハッシュの指定を省くと、実行時の内容を基に操作します。

## 検索と検証

```sh
bun /path/to/plugin/cli/memory/memory.ts search --root /path/to/workspace --type rule --all --json
bun /path/to/plugin/cli/memory/memory.ts search "認証" --root /path/to/workspace --filter 'tags=auth' --filter 'status!=deprecated' --json
bun /path/to/plugin/cli/memory/memory.ts search --root /path/to/workspace --for-path workspaces/default/task-001/api/src/auth.ts --json
bun /path/to/plugin/cli/memory/memory.ts validate --root /path/to/workspace --strict --drift --stale --stale-within 7d --json
```

検索語を省く場合は`--type`・`--for-path`・`--filter`のいずれかが必要です。既定10件、`--limit`は最大100件、`--all`は全件です。検索はローカルの語句一致・前方一致を使い、埋め込みや外部AIは使いません。

`--filter`は繰り返してAND条件にできます。`field=value`・`field!=value`・`field?`・`!field`に対応し、`verified.by=human:alice`のような属性や配列内の値も扱えます。検索対象に壊れた知識があれば部分結果を成功として返しません。`show`は指定した知識だけを読み、`--relations`付きでは関連全体を調べます。元のMarkdownだけが必要なら`show --raw`を使います。

コードの参照検査は選択中の `.space/<project>/`・`repositories/<project>/`・`workspaces/<project>/` 内に限定します。プロジェクト名部分のglob、他プロジェクト、ルート全体を探すglobは拒否し、シンボリックリンクを辿りません。`search --for-path`は参照属性との照合、`validate --drift`は実際の存在と目次の確認です。コードの内容を読んで知識の正しさを判定する機能ではありません。

通常の`validate`は形式エラーで失敗します。`--strict`は警告・リンク切れ・孤立した知識も失敗にし、`--stale`は期限切れを失敗にします。`--stale-within 7d`は間近の期限を警告しますが、それだけではstrictを失敗にしません。検証はファイルを変更しません。

## JSON入出力

`--input-json '<JSON>'` または `--input-json -`（標準入力）を単独で使います。JSON入力時は常にJSONで返します。

```json
{
  "command": ["create", "knowledge/auth"],
  "root": "/path/to/workspace",
  "project": "default",
  "metadata": {"type": "knowledge", "title": "認証方式", "description": "判断の根拠", "tags": ["auth"]},
  "body": "採用した方式と理由。",
  "actor": "agent:codex"
}
```

`command`はコマンドと位置引数の配列です。フラグに相当するフィールドは`root`・`project`・`actor`・`type`・`title`・`description`・`status`・`tags`（カンマ区切り文字列）・`body`・`metadata`・`metadataFile`・`bodyFile`・`ifHash`・`limit`（整数）・`forPath`・`staleWithin`（例`7d`）。`filter`・`unset`は文字列配列、`all`・`relations`・`sync`・`noIndex`・`noLog`・`dryRun`・`strict`・`drift`・`stale`は真偽値です。

成功は `{"ok":true,"data":...}`、失敗は `{"ok":false,"error":{"code":"...","message":"...","details":...}}`。検証で問題を見つけた場合は`ok:false`と検証結果の`data`を返します。終了コードは0が成功、1が入力・更新・検証の失敗、2が読取の失敗です。ハッシュ競合は`VERSION_CONFLICT`、中断した書き込みは`RECOVERY_REQUIRED`、復旧内容の競合は`RECOVERY_CONFLICT`です。

## 保存の中断と再開

プロジェクト内の書き込みは`.okf-write-lock`で排他します。各ファイルを一時ファイルから置き換え、複数ファイルの更新予定を`.memory-pending.json`へ先に保存します。更新途中に失敗した場合は、保存済みのパスをエラーの`details.written_paths`に含めます。全ファイルが同時に切り替わるトランザクションではありません。

中断した予定が残っている間は通常操作を停止します。原因を解消して`recover --dry-run`で確認し、`recover`で元の予定の残りを適用します。既に予定どおり保存されたファイルは再更新せず、中断後に別の変更が入ったファイルは上書きしません。復旧は対象プロジェクトだけを扱います。

プロセスの強制終了でロックも残った場合は、所有者ファイルを読み、元の書き手が終了していて他の書き込みもないことを確認してから、残ったロックを手動で整理します。CLIはロックを時間だけで削除しません。復旧予定ファイルは削除せず保持してください。

本文と入力ファイルは各16 MiB、復旧予定は64 MiBまでです。更新対象が大きすぎる場合は操作を分けます。OS側の権限や隔離は別途必要で、CLIのプロジェクト選択はアクセス認可の代わりにはなりません。
