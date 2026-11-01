# プロジェクトへの導入と更新

## 実行するコマンド

`setup`は`bun <このスキル>/scripts/setup.ts`の略記。グローバルコマンドを前提にしない。

```text
setup plan --project /absolute/path/to/project --json
setup apply --project /absolute/path/to/project --json
setup status --project /absolute/path/to/project --json
```

## 全スキルをプロジェクトへ配置する

CodexとClaude Codeでは、各コマンドに`--scope project`を追加すると、全スキルと同梱CLI・資料・エージェントを実ファイルで配置する。プラグインの登録は不要。対象製品の配布物を取得して、その中のsetupを実行する。インストール済みプラグインからも同じ操作ができる。

```text
setup plan --project /absolute/path/to/project --scope project --json
setup apply --project /absolute/path/to/project --scope project --json
setup status --project /absolute/path/to/project --scope project --json
```

| 製品 | スキル | エージェント | 指示 |
| --- | --- | --- | --- |
| Codex | `.agents/skills/` | `.codex/agents/` | `AGENTS.md` |
| Claude Code | `.claude/skills/` | `.claude/agents/` | `CLAUDE.md` |

同梱ファイルは`setup-manifest.project.json`に従って配置する。スキルの選択・除外は行わない。通常のCLI実行に配布元は不要で、更新・配布物との比較には配布元を指定する。コピーしたsetupを使う場合は、取得した配布物のルートを`--source`で渡す。

```text
bun .agents/skills/setup/scripts/setup.ts plan --project . --scope project --source /path/to/koto/dist/codex/koto --json
bun .agents/skills/setup/scripts/setup.ts apply --project . --scope project --source /path/to/koto/dist/codex/koto --json
```

Claude CodeではCLIの場所を`.claude/skills/setup/scripts/setup.ts`、配布元を`dist/claude-code/koto`に読み替える。`--source`には利用先のスキルフォルダではなく、`setup-manifest.json`を含む配布ルートを指定する。新しい版への更新には、新版の配布物にあるsetupを使える。

プロジェクト導入の指示は、プロジェクトルートからの相対パスでスキルとMemoryを参照する。コピーしたファイルはGitで共有できる。実行時にできる`node_modules/`・`__pycache__/`・`.venv/`はGit管理から除外する。同梱ツールをプロジェクト本体のworkspace依存へ混ぜない。Tasks・Memoryの利用にbun installは不要。

既存のプラグイン用setupからプロジェクト導入へ切り替える場合も、同じ管理記録で既存編集を確認してから参照先を更新する。切り替え後に`--scope project`を省略すると停止する。プラグインの有効・無効は変更しないため、同じスキルが重複して見える場合は利用する導入方式に合わせてプラグインの有効範囲を調整する。

## 製品と導入方式の指定

GitHub Copilot in VS Codeでは、各コマンドに`--product copilot`を指定する。

```text
setup plan --project /absolute/path/to/project --product copilot --json
setup apply --project /absolute/path/to/project --product copilot --json
setup status --project /absolute/path/to/project --product copilot --json
```

`--product`は`codex`・`claude-code`・`copilot`を受け付ける。省略時は配布ルートのsetup-manifest.jsonに記載された製品を使う。CopilotとClaude Codeは配布物を共用し、既定はclaude-codeなので、Copilotでは省略しない。既定と異なる製品は、同梱されたsetup-manifest.<product>.jsonから読み取る。未同梱の製品や、プラグイン名・版数・製品が一致しないmanifestは拒否する。

| コマンド | 動作 |
| --- | --- |
| `plan` | 同梱内容、前回の管理記録、現在のファイルを比較し、変更予定と衝突を返す |
| `apply` | 全件を事前確認し、衝突がなければ配置・更新して管理記録を保存する |
| `status` | 現在の同梱内容との差、ローカル変更、未完了の適用、ロックの有無を返す |

planとstatusは対象プロジェクトへ書き込まない。初回起動ではスキル自身のscripts/node_modules内に、依存定義の確認結果を記録する。外部依存のない構成なので、パッケージのダウンロードは行わない。Bun 1.4.2以上とscriptsへの書き込み権限が必要。

通常は配布ルートのsetup-manifest.jsonが、この製品で配置するファイルを指定する。プロジェクト導入では同梱のsetup-manifest.project.jsonを使う。配布元は`--source`またはCLI自身の配置から読み取り、作業ディレクトリから推測しない。

## 配置先と保持する内容

Tasks・MemoryのCLIは、プラグイン方式では配布物の`cli/tasks/`・`cli/memory/`にある。プロジェクト導入ではCodexの`.agents/cli/`、Claude Codeの`.claude/cli/`へ配置し、スキルからの相対参照を維持する。両CLIはBunだけで動き、実行時のパッケージ導入を要求しない。

setupは知識と指示を配置する。タスクの登録が必要になった時点でTasksのsetupを使い、既存のstate.jsonを手作業で作らない。rootは利用先リポジトリ、projectは通常default。実行中のTasks・checkpoint・Memory利用ログは、ブランチ切り替えで巻き戻らない保存方法を選び、Gitの追跡状態を確認する。

| 内容 | 配置先 |
| --- | --- |
| 共通知識・ルール | `.space/default/memory/`直下のtype別ディレクトリ |
| 同梱されたCodex用のエージェント定義 | `.codex/agents/` |
| Codexの指示 | `AGENTS.md`内の管理ブロック |
| Claude Codeの指示 | `CLAUDE.md`内の管理ブロック |
| GitHub Copilotの指示 | `.github/copilot-instructions.md`内の管理ブロック |
| 前回配置した内容のハッシュ | `.space/setup/<plugin>-<product>.json` |

既定のプラグイン方式では、Claude Codeのエージェントはプラグインのagentsとして提供される。プロジェクト導入では`.claude/agents/`へコピーする。

プラグイン方式では、指示テンプレートの`{{SKILL_ROOT}}`は配布ルートのskills、`{{MEMORY_ROOT}}`は利用先の`.space/default/memory/`の絶対パスに置き換わる。プラグインの配置場所が変わった場合もplanで差を確認し、applyで参照を更新する。プロジェクト導入では、製品別のスキル配置先と`.space/default/memory`の相対パスに置き換わる。

指示ファイルでは、次の開始・終了マーカーに挟まれた部分だけを管理する。マーカー外の既存指示、別のプラグインの指示、利用先独自の文書は保持する。

```markdown
<!-- koto:setup:koto:codex:start -->
この製品の指示
<!-- koto:setup:koto:codex:end -->
```

コピー先に未管理の別内容があれば衝突として止める。同じ内容の既存ファイルは管理対象に登録できる。二回目以降は前回のハッシュと現在値を比較する。前回と異なっていても、同じ管理方式で現在の管理部分が今回の同梱内容と完全に一致する場合は、その内容を新版として管理記録へ採用できる。それ以外の管理部分の編集・削除、マーカーの破損・重複は衝突になる。管理ブロック外だけの編集は更新を妨げない。

setupのapplyはMemoryと同じ書き込みロックを取得する。Memoryが書き込み中、または`.memory-pending.json`が残る場合は更新を進めず、元の処理を完了・復旧する。中断したsetupのpendingがある間も知識の編集を止め、先に同じ配布物でsetupを再実行する。

共有する`index.md`は既存の見出し・説明・独自項目を保持し、不足する項目だけを追加する。配布側の項目が更新された場合、前回配置時からその項目が変わっていなければ更新する。両側で同じ項目が変更された場合は衝突として止める。`log.md`と`LICENSE`は存在しない場合だけ配置し、既存内容やその後の編集を保持する。

配布元からなくなったファイルは`retain`と表示し、利用先から削除しない。管理記録も保持する。ソースと配置先の親方向参照、絶対パス指定、symlink、許可された配置先の外への書き込みは拒否する。

## 既存の知識を移行する

`.space/babel/`がある場合、新しいsetupは自動適用を停止する。旧知識を置き去りにして新規のMemoryへ切り替えない。

移行を依頼された場合は、旧領域と移行先`.space/default/memory/`の内容、Gitの追跡状態、同時に書き込む処理を確認する。旧OKFの`.okf-write-lock`、setupのpendingやロックが残っていれば、元の処理と版で状態を解決してから進める。知識のコピーだけで書き手を停止したと扱わない。

移行先が存在しない場合は、旧領域全体を同じリポジトリ内の新しい位置へ移し、移動前後の相対ファイル一覧と内容ハッシュが一致することを確認する。既存ファイルを消したり、既存の移行先へディレクトリごと重ねたりしない。両方がある場合はIDごとの重複・差分を比較し、残す内容を決めてから統合する。意味を判断せず上書きしない。

setupの旧管理記録は保持する。移行後のplan・applyは旧配置時のハッシュも照合する。既存編集や未完了の適用があれば停止し、管理記録を消して回避しない。コード参照はリポジトリ相対のまま保持し、旧領域へのリンクや絶対パスは移行先と照合する。

Memoryのvalidateで形式・リンク・コード参照を確認する。scopeのない知識は未分類として保持できる。必要な更新時に内容を判断してshared・dev・opsを指定し、一括してsharedと推測しない。新しいMemory CLIで検索・本文取得を確認してから利用を再開する。

旧orchの台帳はTasksと形式・状態の意味が異なるため、自動変換しない。必要な未完了の仕事を旧台帳と実態から確認し、新しいTasksへ目的・残件・元記録への参照を登録する。旧台帳の完了・受け入れを新しいタスクの検証済み完了と読み替えず、旧記録は保持する。

## agent-gearからの切り替え

旧名のプラグインを無効にし、kotoを導入した後、新しい会話でkotoのsetupを使う。対象プロジェクトで`plan`、`apply`、`status`の順に実行する。Copilotでは各コマンドに`--product copilot`を指定する。

kotoの管理記録がまだなければ、同じ製品の`.space/setup/agent-gear-<product>.json`を読み、前回配置した内容を照合する。旧名の管理ブロックはその位置でkotoのブロックに置き換え、ブロック外の指示を保持する。更新後は`.space/setup/koto-<product>.json`を使い、旧管理記録と旧vendor内のファイルは削除しない。タスクとプロジェクト固有の知識も保持する。

旧名の管理記録がない、管理部分が編集されている、新旧のブロックが両方ある、マーカーが破損している場合は衝突として止まる。既存の記録・編集内容を保全してから解決し、管理ファイルを一括削除して再導入しない。

旧名のいずれかの製品にpendingがあれば、先にその元の版で適用を完了する。kotoのapplyは`koto.lock`と`agent-gear.lock`の両方で書き手を排他する。中断後にロックが残った場合も、両方のPID・時刻と全ての書き手の停止を確認してから、残っているロックだけを除く。旧名のsetupへ戻して更新を続けず、以後はkotoを使う。

## 旧vendor配置からの更新

以前の`.space/default/memory/vendor/<plugin>/`へ導入済みの場合も、新版のplan・applyで`.space/default/memory/`直下に共通知識を配置し、指示の検索先を更新する。旧vendorのファイルと管理記録は保持し、自動削除しない。配布元にない独自文書は自動移動しないので、旧vendorへ独自に保存した知識がある場合は、必要な文書を確認してMemory側へ統合する。

移行する配布文書にローカル編集・削除がある場合や、Memory側に異なる同名文書がある場合は、全配置を止めて衝突を返す。元の内容を保全し、共通文書へ反映する差分とプロジェクト固有の知識を整理してから再実行する。旧版のpendingが残っている場合は、先にその版で適用を完了する。

## 結果の読み方

通常もJSONを返し、`--json`では一行にする。成功は`ok: true, data`、失敗は`ok: false, error`。dataのactionsにはcreate・update・unchanged・retain、conflictsには配置先と理由が入る。pendingは途中の適用記録、lockedは書き手のロックがあることを示す。

planやstatusの成功は「比較できた」ことを意味し、衝突がないことを意味しない。必ずconflictsも確認する。終了コードは0=処理成功、1=入出力・起動失敗、2=入力・形式・パス違反、3=衝突・ロック・途中失敗。

衝突があるapplyは、配置先を一件も書き換えず停止する。該当ファイルと配布元を比較し、残したい内容を先に保全する。管理状態を消したり、強制上書きしたりして解決したことにしない。必要な差分の統合を決めた後に再実行する。

## 中断と再開

applyは`.space/setup/<plugin>.lock`で同じプラグインの書き手を排他する。稼働中の処理のロックを削除しない。

複数ファイルの配置は一つのファイルシステムトランザクションではない。各ファイルを一時ファイルから置換し、途中の予定を`.space/setup/<plugin>-<product>.pending.json`へ保存する。途中失敗はPARTIALとして、完了した配置先と原因を返す。

再開時は、全対象が「適用前」または「適用後」の内容であることを照合し、残りを適用する。中断後に追加のローカル編集があれば再び止める。pendingは手編集・削除せず、同じ配布版でapplyを再実行する。配布版を変更した場合は、先に元の版で未完了の適用を終える。

異常終了でロックが残った場合は、statusとロック内のPID・時刻を確認し、関連する全ての書き手が停止したことを確かめてから、その`.space/setup/<plugin>.lock`と、同じ処理が残した`.space/default/memory/.okf-write-lock/`だけを除く。Memoryのロック所有者は配下の`owner.json`で確認する。setup由来はwriterがsetupとなる。初回起動中は子プロセスがある場合もある。停止が確認できない状態ではロックを奪わない。

同じホストのローカルファイルを対象にする。ネットワーク共有、電源断、別プロセスが同じファイルを同時に編集する状況での完全な一括適用は保証しない。適用中にプラグインのファイルを入れ替えない。

同じプロジェクトへCodex・Claude Code・Copilotの複数製品を導入した場合、Memory内の配布文書は共有し、管理記録は製品ごとに持つ。一方で配布文書を更新し、他方も同じ内容の新版へ更新する場合、既に配置された内容と完全に一致することを確認して管理記録を更新する。異なるローカル編集は上書きせず停止する。製品ごとに別の版を維持する場合も、各製品の配置記録と内容の差を確認する。
