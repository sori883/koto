# pstack参照記録

kotoの土台を作るときに参照したpstackの版と、構成要素ごとの採否を記録する。方針は[kotoの目的と配布設計](../architecture.md)の「作り方の方針」に従う。

## 参照した版

| 項目 | 値 |
| --- | --- |
| リポジトリ | <https://github.com/cursor/plugins> の`pstack/` |
| コミット | `41e400932eca14f289e7db717a70455256b6d388`（2026-11-24） |
| 版 | 0.15.48 |
| ライセンス | MIT License（Copyright (c) 2026 Lauren Tan） |

別の版を参照するときは、この表を更新し、採否に影響する差分を下の表に反映する。

## 採否

区分の意味は次のとおり。

- **書き起こす**：構成と考え方を参照し、kotoの設計でClaude Code向けに書く。
- **コピー候補**：ほぼそのまま使える。コピーする場合はMIT Licenseの表示を配布物に含める。
- **後で判断**：Memory・Tasksを載せる段階で、koto独自の概念と合わせて扱いを決める。
- **採用しない**：Cursor専用、または作者個人の環境向けで、kotoの目的に合わない。

採否はまだ確定していない。各スキルを作る時点で確定し、この表を更新する。

### 中核

| 要素 | 区分 | 備考 |
| --- | --- | --- |
| `poteto-mode` | 書き起こした | kotoの中核スキル`koto-mode`。Cursor専用の部分だけを読み替えた |
| `poteto-mode/playbooks/`（22本） | 書き起こした | すべて`koto-mode/playbooks/`に置いた |
| `poteto-mode/references/bugbot-triage.md` | 書き起こした | |
| `poteto-mode/scripts/` | コピーした | パッケージ名と会話記録の場所だけをClaude Code向けに変えた |
| `poteto-mode/worker.md` | 書き起こした | PR本文の見出しを日本語にした |
| `agents/poteto-agent.md` | 書き起こした | `koto-agent`。`model: opus`、`effort: xhigh`、`background: true` |
| `figure-it-out` | 書き起こした | |
| `poteto-help` | 書き起こす | kotoの使い方案内として作るかを土台の段階で判断 |
| `setup-pstack` | 後で判断 | 役割ごとの既定は中核スキルとエージェント定義に書いた。利用者ごとの設定が要るかは後で判断する |

### 原則（`principle-*`、24本）

| 要素 | 区分 | 備考 |
| --- | --- | --- |
| すべての`principle-*` | 書き起こした | |

### 単体スキル

| 要素 | 区分 | 備考 |
| --- | --- | --- |
| `how`、`why`、`teach` | コピー候補 | Memory段階で知識の検索・参照を加える |
| `blast-radius`、`interrogate`、`architect`、`arena`、`swarm` | コピー候補 | 複数モデル前提の部分はClaude Codeのモデル指定に合わせる |
| `tdd`、`benchmark-checklist` | コピー候補 | |
| `create-verification-skill`、`maintain-verification-skill` | コピー候補 | |
| `create-formal-verification-skill`、`maintain-formal-verification-skill`、`statechart` | 後で判断 | 必要性を土台の段階では判断しない |
| `no-comments`、`agents/comment-sicko.md` | コピー候補 | Memory段階でコメントの理由を知識へ移す手順を加える |
| `unslop`、`bro`、`technical-writing` | コピー候補 | 日本語の文章向けに調整が必要 |
| `in-your-own-words`、`sharpen`、`reframe`、`ketchup` | コピー候補 | |
| `typescript-best-practices` | コピー候補 | |
| `show-me-your-work`、`recall`、`reflect`、`automate-me`、`correct` | 後で判断 | 記録・振り返りを扱うため、Memory・Tasksと合わせて設計する |
| `ketchup-video` | 採用しない | 動画生成の環境に依存する |
| `make-bot-ui` | 採用しない | 特定のボットとWebhook向け |
| `automations/benny` | 採用しない | Cursor Automations専用 |
| `docs/harness/claude-code.md` | 採用しない | kotoは最初からClaude Codeの名前で書くため、読み替え表を持たない |

## cursor-team-kit

pstackの中核スキルが使う次のスキルは、同じリポジトリの`cursor-team-kit/`（MIT License、Copyright (c) 2026 Cursor）から書き起こした。参照した版は上の表と同じコミットである。

| 要素 | 区分 | 備考 |
| --- | --- | --- |
| `deslop` | 書き起こした | |
| `control-ui`、`control-cli` | 書き起こした | |
| `verify-this` | 書き起こした | `control-ui`が参照する |
