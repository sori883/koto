---
name: ticket
description: "仕事の単位（チケット）を、.space/tickets/<ticket-id>/ticket.mdで作る・一覧する・状態を変える・関係を図にする・中断と再開の地点を書く。koto-modeのプレイブックがチケットを作る・読む・書き換えるときに呼ぶ。「どこまで進んだか」「次に何をするか」をチケットで確かめるときにも使う。セッション内の手順の管理には、Claude Codeのタスクリストを使う。"
disable-model-invocation: false
---

# Ticket

チケットは、一つの仕事の単位の記録である。作るかどうかはkoto-modeのプレイブックが決め、セッションをまたぐかどうかや作業の規模では決めない。何を、なぜ、どこまでやれば終わりかと、いまの状態、中断したならどこから再開するかを書く。

チケットに書かないものがある。判断の履歴は**show-me-your-work**スキルの判断ログ（同じフォルダの`decisions.tsv`）に書く。このセッションでどの手順まで進んだかは、Claude Codeのタスクリストで管理する。

## 置き場所

```text
{project}/.space/tickets/
  <ticket-id>/
    ticket.md        チケット本体
    decisions.tsv    判断ログ（show-me-your-work）
    ...              調査メモなど、このチケットの資料
```

`.space/tickets/`が無ければ、先に**setup**スキルで作る。`ticket.md`も`decisions.tsv`もコミットする。子チケットも、親のフォルダの中ではなく`tickets/`の直下に置く。

## ticket.mdの形

```markdown
---
id: api-validation
title: 入力を検証する
status: running
parent: api
depends_on: [api-schema]
created: 2026-05-24T09:00:00Z
updated: 2026-05-24T11:20:00Z
---

# 入力を検証する

## 目的
APIが不正な入力を受け付けて500を返している。400と理由を返すようにする。

## 終了条件
- 必須項目の欠落と型の誤りに400を返す。
- 既存のテストと、新しく足した入力検証のテストが通る。

## 成果物
- PR: https://github.com/example/app/pull/42
- src/api/validate.ts

## checkpoint
- 現在地：必須項目の検証まで実装し、テストが通った。型の検証は未着手。
- 次の操作：src/api/validate.tsに型の検証を足し、tests/api/validate.test.tsに失敗するテストを先に書く。
- 注意：ブランチはfeat/api-validation。未コミットの編集は無い。

## 結果
```

- **frontmatter**は、スクリプトが読み書きする。値は一行に収める。`depends_on`は`[a, b]`の形で書く。
- **目的**は、なぜこの仕事をするのかを書く。
- **終了条件**は、満たしたかどうかを確かめられる形で書く。
- **成果物**は、PR、ブランチ、ファイル、ドキュメントへのパスやリンクを書く。中身は書き写さない。
- **checkpoint**は、何も知らない担当者がここから再開できるように書く。現在地、次の操作、注意点である。中断するとき、引き継ぐとき、区切りがついたときに書き換える。履歴は残さない。経緯は判断ログに書く。
- **結果**は、`done`にするときに、実際に何をして、終了条件をどう確かめたかを書く。`cancelled`にするときは、やめた理由を書く。

## 状態

| 状態 | 意味 | 次に進める状態 |
| --- | --- | --- |
| `pending` | 未着手 | `running`、`cancelled` |
| `running` | 作業中 | `paused`、`done`、`cancelled` |
| `paused` | 中断している。待っている理由や再開の条件はcheckpointに書く | `running`、`cancelled` |
| `done` | 終了条件を満たした | `pending`（やり直す） |
| `cancelled` | やめた | `pending`（やり直す） |

- `running`にできるのは、`depends_on`のチケットがすべて`done`のときだけである。
- `done`にできるのは、子チケット（`parent`がこのチケット）がすべて`done`か`cancelled`のときだけである。

## 操作

このスキルの`scripts/ticket.ts`をBunで実行する（`bun <このスキルのフォルダ>/scripts/ticket.ts ...`）。外部パッケージは使わないので、`bun install`は要らない。最初の引数には、プロジェクトのルートの絶対パスを渡す。下の表では`bun`と`scripts/`を省いて書く。

| 操作 | コマンド |
| --- | --- |
| 作る | `ticket.ts new <root> <id> <title> [--parent <id>] [--depends-on <id,id>]` |
| 一覧する | `ticket.ts list <root> [--status <状態>] [--ready]` |
| 状態を変える | `ticket.ts status <root> <id> <状態>` |
| 関係を図にする | `ticket.ts graph <root> [--mermaid]` |

- IDは英小文字・数字・ハイフンで64文字まで、先頭は英小文字か数字とする。内容が分かる短い名前にする（`api-validation`など）。
- `list`はタブ区切りで、`id`、`status`、`ready`、`parent`、`depends_on`、`title`を出す。`ready`は、`pending`で依存先がすべて`done`なら`yes`になる。`--ready`は、すぐ着手できるチケットだけを出す。
- `status`は状態と`updated`だけを書き換える。許されない状態の変更、終わっていない依存先や子チケットがあるときは、何も変えずに失敗する。
- frontmatterの`status`と`updated`は手で書き換えない。状態の変更は必ず`ticket.ts status`で行う。チケットのフォルダと`ticket.md`も、手で作らず`ticket.ts new`で作る。手で書き換えると、依存先と子チケットの確認が働かず、`updated`も実際の時刻とずれる。
- `graph`は、親子を木で、状態と依存先を各行に添えて出す。`pending`には、すぐ着手できるなら`ready`、依存先が終わっていなければ`blocked`を添える。依存先が多いときや、どれが詰まっているかを確かめるときに使う。

  ```text
  api [running] APIを作る
  ├─ api-schema [done] スキーマを決める
  └─ api-validation [pending, ready] 入力を検証する  ← depends: api-schema(done)
  docs [pending, blocked] 説明を書く  ← depends: api-validation(pending)
  ```

- `graph --mermaid`は、同じ関係をMermaidのflowchartで出す。点線は親子、矢印は依存で、矢印の先のチケットは元のチケットが`done`になるまで始められない。状態ごとに色が付く。利用者が図で見たいときに使う。Markdownに載せるときは```` ```mermaid ````のコードブロックで囲む。GitHub、VS Code、ObsidianなどのMermaidに対応した表示で図になる。
- 本文（目的、終了条件、成果物、checkpoint、結果）は、ファイルを直接編集する。

## 手順

### 始める

1. `.space/tickets/`が無ければ、Skillツールで`koto:setup`を呼んで作る。
2. 同じ仕事のチケットがないか`ticket.ts list`で確かめる。あればそれを使う。
3. 無ければ`ticket.ts new`で作り、目的と終了条件を書く。分からないことは推測で埋めず、利用者に確かめる。
4. `ticket.ts status <root> <id> running`で始める。
5. 判断ログを残す作業なら、**show-me-your-work**スキルで同じフォルダの`decisions.tsv`に書き始める。

### 中断する・引き継ぐ

1. checkpointを書き換える。現在地、次の操作、注意点（ブランチ、未コミットの編集の有無など）を書く。
2. `ticket.ts status <root> <id> paused`にする。

### 再開する

1. `ticket.ts list`で状態を見て、`ticket.md`のcheckpointを読む。判断ログがあれば、その最後の数行も読む。
2. checkpointに書かれた現在地が、実際のブランチやファイルと合っているかを確かめる。食い違えば、実物を正とし、checkpointを直す。
3. `ticket.ts status <root> <id> running`で再開する。

### 終える

1. 終了条件をすべて満たしたかを、実物で確かめる。
2. 成果物と結果を書く。
3. `ticket.ts status <root> <id> done`にする。

### やめる・やり直す

- やめるときは、結果にやめた理由を書き、`cancelled`にする。
- やり直すときは、`pending`に戻し、checkpointにやり直す理由を書く。前の結果は消さず、「前回の結果」として残す。

## 返答

扱ったチケットのIDとパス、状態の変化、checkpointに書いた次の操作。
