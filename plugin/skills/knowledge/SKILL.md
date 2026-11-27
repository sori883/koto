---
name: knowledge
description: "コードにもGitの履歴にも残らず、次の作業で知らないと困ること（設計の判断、外から来た制約、受け入れた妥協、資料への参照）を、.space/kb/にOKF形式で残す・探す・見直す。利用者に「残して」「覚えておいて」と頼まれたとき、チケットを閉じるときの棚卸し、過去の判断や制約を確かめるとき、資料を取り込むとき、Knowledgeを見直すときに使う。好みや作業スタイルはCLAUDE.mdに、手順はスキルに、仕事の進み具合はチケットに書く。"
disable-model-invocation: false
---

# Knowledge

Knowledgeは、コードにもGitの履歴にも残らず、次に作業する人とAIが知らないと困ることの記録である。1件を1ファイルとし、プロジェクトのルートの`.space/kb/`に置いてコミットする。

## 何を残すか

次の順に当てはめ、最初に当てはまった場所に残す。Knowledgeは最後の受け皿である。

1. コードやGitの履歴を読めばわかる → 残さない。
2. 型・lint・テストで防げる → 仕組みにする。
3. 次も同じ手順を踏む → スキルにする。
4. これからやる仕事、いまの現在地 → チケット（**ticket**スキル）。
5. その作業をレビューするためだけに要る経緯 → 判断ログ（**show-me-your-work**スキル）。
6. 次の作業でも、知らないと困る → Knowledge。

利用者の好みや作業スタイルは、Knowledgeではなく`CLAUDE.md`に書く。Claude Codeの自動メモリーには書かない。社外秘の資料は扱わない。

## 種類

| 種類 | `type` | 入れるもの | 読んだときの態度 |
| --- | --- | --- | --- |
| `decision` | `Decision`（判断） | 設計の判断、見送った案 | 正しい状態として扱い、変えるよう提案しない |
| `constraint` | `Constraint`（制約） | 外から来た制約（契約、法律、ほかのチームとの取り決め）と、受け入れた妥協（既存のコード、範囲、時間などの内側の事情） | その場では変えない。見直す条件を満たしたときにだけ、変える提案をする |
| `reference` | `Reference`（参照） | 資料への参照。資料が扱う関心事ごとに1件とし、資料の長さでは分けない | その関心事に触れるときに読む |

- 判断と制約には、効く場所を`code_refs`で付ける。コードへの参照は種類にしない。
- 1件と1件の関係は、本文のMarkdownリンクで表す。リンクは`.space/kb/`からの絶対パス（`/constraints/log-retention.md`）で書き、関係の意味はリンクの前後の文で伝える。妥協を生んだ制約があれば、妥協の「出所」からその制約へリンクする。
- 同じ内容の1件があれば、新しく作らずにその1件を直す。

## 置き場所

```text
{project}/.space/kb/
  index.md                 目次。knowledge.tsが作り直す。手で編集しない
  decisions/<slug>.md      判断
  constraints/<slug>.md    制約
  documents/<slug>.md      参照
  references/<slug>/       参照の写し（Markdownに変換した資料と、要点になる図や表の画像）
```

`.space/kb/`が無ければ、先に**setup**スキルで作る。slugは英小文字・数字・ハイフンで64文字まで、内容が分かる英語にする（`get-user-returns-null`など）。

## 1件の形

OKF v0.2の形式で、YAMLのfrontmatterとMarkdownの本文を持つ。

```markdown
---
type: Constraint
title: 取得APIは見つからないとき null を返す
description: 既存の呼び出し側に合わせて null を返す。本当は結果型にしたい
tags: [api, users]
status: stable
generated: { by: claude-code, at: 2026-11-26T01:00:00Z }
verified: [{ by: "human:alice", at: 2026-11-26T01:05:00Z }]
sources:
  - { resource: .space/tickets/user-fetch/ticket.md }
code_refs: [src/users/get-user.ts]
review_when: 呼び出し側をまとめて移行するとき
---

# 取得APIは見つからないとき null を返す

## 制約
見つからないときは例外ではなく null を返す。

## 出所
内側の事情。呼び出し側が null 前提で12か所あり、今回の範囲で移行できない。

## 守り方
新しい呼び出し側も null を確かめる。戻り値の型だけを変えない。

## 本当はどうしたいか
結果型（成功か失敗かを型で表す）にしたい。
```

| キー | 書くもの |
| --- | --- |
| `type` | `Decision`・`Constraint`・`Reference`のどれか。必須 |
| `title` | 短い名前。目次の見出しになる |
| `description` | 1文の要約。目次に出る1行で、会話の始まりに読まれるのはここまで。本文を読まずに要るかどうか判断できるように書く |
| `tags` | 関心事（`auth`、`billing`など） |
| `status` | `draft`（未確認）・`stable`（確定）・`deprecated`（役目を終えた）。無いときは`stable`として扱う |
| `generated` | 誰がいつ書いたか |
| `verified` | 人が中身を確かめた記録。`by`は`human:<名前>`にする。人が確かめていないものを書かない |
| `sources` | 出どころ。チケットのパス、PRのURLなど |
| `resource` | 参照だけ。元の資料のURL |
| `code_refs` | 判断と制約だけ。プロジェクトのルートからのパス・ディレクトリ・globの配列 |
| `review_when` | 見直す条件。日付で言えない条件を文で書く |
| `stale_after` | 見直す期限が日付で言えるときだけ。`2027-03-31T00:00:00Z`の形 |

本文の見出しは種類ごとに揃える。`knowledge.ts new`が雛形を作る。

| 種類 | 見出し |
| --- | --- |
| 判断 | 結論 / 理由 / 見送った案 |
| 制約 | 制約 / 出所 / 守り方 / 本当はどうしたいか（妥協のときだけ書く。そうでなければ見出しごと消す） |
| 参照 | 要点 / 読む場面 / 開き方 / 目次 |

本文には結論と、次の作業で要る理由だけを書く。詳しい経緯は`sources`のチケットや判断ログに任せ、書き写さない。

## 操作

このスキルの`scripts/knowledge.ts`をBunで実行する（`bun <このスキルのフォルダ>/scripts/knowledge.ts ...`）。外部パッケージは使わない。最初の引数には、プロジェクトのルートの絶対パスを渡す。

| 操作 | コマンド |
| --- | --- |
| 作る | `knowledge.ts new <root> <decision\|constraint\|reference> <slug> <title> --description <text> [--tags a,b] [--code-refs path,glob] [--source <path-or-url>]... [--resource <url>] [--review-when <text>] [--status draft\|stable] [--by <actor>]` |
| 探す | `knowledge.ts list <root> [--type <種類>] [--tag <tag>] [--status <status>] [--query <語句>]` |
| ファイルに効く1件を読む | `knowledge.ts for-path <root> <path>` |
| 目次を作り直す | `knowledge.ts index <root>` |
| 点検する | `knowledge.ts check <root>` |

- `new`は1件を雛形つきで作り、目次を作り直す。`--status`を省くと`draft`になる。`--status stable --by human:<名前>`で作ると、`verified`にその人の記録が入る。`--by`はAIなら`claude-code`のように書き、利用者が確かめていないのに`human:`を付けない。
- `list`はタブ区切りで、パス、`type`、`status`、`title`、`description`を出す。`--query`は本文を含めた全文から探す。
- `for-path`は、そのパスに`code_refs`が一致する判断・制約を本文ごと出す。`deprecated`は出さない。
- 本文とfrontmatterの書き換えは、ファイルを直接編集する。書き換えたら`knowledge.ts index`で目次を作り直す。
- `check`は、形式の誤り、`code_refs`の指す先が無いもの、リンク切れ、`stale_after`を過ぎたもの、古い目次を出す。`draft`と`review_when`も`info`として並べる。誤り（`error`）があると終了コードが1になる。

## 自動で読まれるもの

kotoのフックが、次の場面でKnowledgeをAIに渡す。

- 会話とサブエージェントの始まりに、`index.md`を渡す。100件を超えたら、件数とこのスキルで探すよう促す文だけを渡す。
- `Read`でファイルを読んだ直後に、そのファイルに`code_refs`が一致する判断・制約を本文ごと渡す。編集は先に読むことが前提なので、編集を考える前に届く。
- `Edit`・`Write`・`NotebookEdit`の直前にも同じものを渡す。読まずに書く場合の予備で、この時点ではその編集はもう止まらない。

渡された判断・制約に反する編集が要るときは、編集の前に利用者に確かめる。指摘や変更を提案する前にも、その箇所の1件を確かめる。目次の`description`だけで判断せず、要る1件は本文まで読む。

## 手順

### 頼まれて残す

利用者に「残して」「覚えておいて」と頼まれたときに使う。作業の途中で、AIのほうから残すよう提案はしない。

1. 何を残すかを、「何を残すか」の順で確かめる。Knowledgeに当たらなければ、行き先を伝えて終える。
2. `knowledge.ts list --query`で同じ内容の1件を探す。あれば、その1件を直す。
3. 種類、slug、title、description、効く場所、見直す条件を決め、`knowledge.ts new`で作る。利用者が頼んだので`--status stable --by human:<名前>`とする。利用者の名前が分からなければ、Gitの`user.name`を使う。
4. 本文を書き、`knowledge.ts index`で目次を作り直す。
5. 作ったパスと要点を伝える。コミットは利用者に頼まれたときか、作業の流れがコミットを含むときに行う。

### チケットを閉じるときに残す

**ticket**スキルの「終える」「やめる」から呼ばれる。

1. `ticket.md`（目的、結果、成果物）と、同じフォルダの`decisions.tsv`を読み返す。
2. 「何を残すか」の順で、次の作業でも効く判断・制約・参照を選ぶ。PRの説明やコミットに書いたこと、この作業のレビューにしか要らないことは選ばない。多くても数件に絞る。何も無ければ、無いと伝えて終える。
3. 同じ内容の1件がないかを`knowledge.ts list --query`で探す。あれば、作り直さずに直す案にする。
4. 利用者がいるなら、候補ごとに種類、title、description、効く場所を示し、`AskUserQuestion`で残すかを聞く。残すと答えたものを`--status stable --by human:<名前>`で作る。利用者がいない作業では、`--status draft`で作る。
5. `sources`にはチケットの`ticket.md`のパスを入れる。PRがあればそのURLも入れる。
6. 本文を書き、目次を作り直す。チケットの更新と同じコミットに含める。

### コメントから残す

**no-comments**スキルから呼ばれる。削除したコメントのうち、受け入れた妥協や外から来た制約を述べていたものを扱う。

1. 差分の削除行から、元の文と、そのコメントが付いていたファイル・シンボルを読む。
2. 同じ内容の1件がないかを`knowledge.ts list --query`で探す。あれば、`code_refs`を足すなどして直す。
3. 無ければ、制約（`constraint`）として作る。`code_refs`にはコメントが付いていたファイルを入れ、本文の「出所」に、外から来たものか内側の事情かと、元のコメントの要旨を書く。妥協なら「本当はどうしたいか」も書く。
4. 利用者がいるなら、候補を示して`AskUserQuestion`で残すかを聞き、残すものを`--status stable --by human:<名前>`で作る。利用者がいない作業では`--status draft`で作る。
5. 目次を作り直す。

### 資料を取り込む

1. 資料が扱う関心事を1つ決める。ひとつの関心事が1件になる。
2. 資料をMarkdownに変換し、`references/<slug>/`に置く。元のファイルは置かない。図や表が要点になるときだけ、その画像を同じフォルダに置き、Markdownから参照する。
3. `knowledge.ts new <root> reference <slug> ...`で参照の1件を作る。`--resource`に元の資料のURLを入れる。
4. 本文の「要点」に要点、「読む場面」にどんなときに開くか、「開き方」に元の資料の開き方（要るアカウントなど）、「目次」に写しの見出しと`references/<slug>/`の中のファイルへのリンクを書く。
5. 元の資料と照らして確かめたら、`verified`に確かめた人と日時を書く。

### 見直す

利用者に見直しや片付けを頼まれたときに使う。

1. `knowledge.ts check`を実行する。
2. 結果を利用者に示し、1件ずつ扱いを決める。
   - `draft`：中身を示し、確かめてもらう。確かめたら`status: stable`にし、`verified`に`{ by: "human:<名前>", at: <日時> }`を足す。誤りなら直すか、ファイルを消す。
   - `review_when`・`stale_after`：条件を満たしたかを確かめる。満たしていれば、直すか`deprecated`にする。
   - `code_refs`の指す先が無い：移った先を探して直す。コードごと消えたなら`deprecated`にする。
   - リンク切れ、形式の誤り：直す。
3. 役目を終えた1件は、消さずに`status: deprecated`にする。本文に、役目を終えた理由と日付を1行足す。
4. `knowledge.ts index`で目次を作り直し、もう一度`check`する。

## 返答

扱った1件のパスと種類、状態（`draft`・`stable`・`deprecated`）、作り直した目次、コミットしたかどうか。
