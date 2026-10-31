# pstackの追加スキルとエージェントを採用する

この文書は構成整理前の開発・検証記録です。現在の配布構成は[現状資料](../current-state.md)を参照してください。

2026-09-26。比較対象はcursor/pluginsの固定コミット `78f46dacbafc71fd7d937bfc2c26da914f1bc09b`。利用先はCodex・Claude Code・Copilotであり、Cursor専用の履歴パス、モデル名、エージェント起動API、個人の保存先を必須にしない。採用経緯と検証記録はこの文書に置き、配布物へ含めない。

## 採用範囲

優先・次点として選んだ6スキル、tdd、show-me-your-work、no-commentsを追加した。文章系3スキルとreflect・automate-meもユーザーの追加回答で採用し、今回の追加は計14スキル。統括スキルの名称はユーザーの選択によりdevlowを維持し、開発担当はdevlow-workerへ統一した。既存のdevlowから必要な条件で呼び出し、各手順を全体フローへ複製しない。

| スキルと原版 | 採用内容と調整 |
| --- | --- |
| [blast-radius](https://github.com/cursor/plugins/blob/78f46dacbafc71fd7d937bfc2c26da914f1bc09b/pstack/skills/blast-radius/SKILL.md) | 呼び出し以外の契約・非同期・保存形式を含む波及調査と、安全性の前提の実行確認。前提を無理に一つへ限定せず、根拠と到達点を区別する |
| [create-verification-skill](https://github.com/cursor/plugins/blob/78f46dacbafc71fd7d937bfc2c26da914f1bc09b/pstack/skills/create-verification-skill/SKILL.md) | 起動・状態確認・操作・証拠・後片付けと機能一覧を生成する。利用先の製品に対応した配置を確認し、実行した機能と未確認を分ける |
| [maintain-verification-skill](https://github.com/cursor/plugins/blob/78f46dacbafc71fd7d937bfc2c26da914f1bc09b/pstack/skills/maintain-verification-skill/SKILL.md) | ソースと実操作で手順のずれを調べる。共有環境の操作は一人が担当し、製品の不具合に合わせて期待結果を緩めない。自動PR・定期実行は含めない |
| [interrogate](https://github.com/cursor/plugins/blob/78f46dacbafc71fd7d937bfc2c26da914f1bc09b/pstack/skills/interrogate/SKILL.md) | 同じ基準での独立レビューと指摘の証拠照合。固定モデルを外し、独立性とモデル多様性の実現範囲を報告する。レビューのみなら編集しない |
| [teach](https://github.com/cursor/plugins/blob/78f46dacbafc71fd7d937bfc2c26da914f1bc09b/pstack/skills/teach/SKILL.md) | howとwhyを組み合わせ、読者の理解に応じて説明する。図・画像生成を常時必須にはせず、確度を保持する |
| [recall](https://github.com/cursor/plugins/blob/78f46dacbafc71fd7d937bfc2c26da914f1bc09b/pstack/skills/recall/SKILL.md) | 利用先のタスク・checkpoint・OKF・Gitを中心に現在地を再構成する。会話は提供済みまたは範囲限定で取得可能なものを使う。読み取りだけで変更を再開しない |
| [tdd](https://github.com/cursor/plugins/blob/78f46dacbafc71fd7d937bfc2c26da914f1bc09b/pstack/skills/tdd/SKILL.md) | 安価な局所テストで意図した失敗を先に確認する。環境エラーをRedと数えず、適切な経路がなければ代替と証拠の限界を示す |
| [show-me-your-work](https://github.com/cursor/plugins/blob/78f46dacbafc71fd7d937bfc2c26da914f1bc09b/pstack/skills/show-me-your-work/SKILL.md) | 判断の追記を、訂正先IDと証拠照合まで拡張する。既存記録を優先し、新規はタスク側。常時ログ・自動コミット・固定エージェントストアを要求しない |
| [no-comments](https://github.com/cursor/plugins/blob/78f46dacbafc71fd7d937bfc2c26da914f1bc09b/pstack/skills/no-comments/SKILL.md) | 理由・制約はOKFへ保存・照合してから削除する。分からなければ残す。ライセンス・必要な公開API文書・ツール指示は保持する |
| [technical-writing](https://github.com/cursor/plugins/blob/78f46dacbafc71fd7d937bfc2c26da914f1bc09b/pstack/skills/technical-writing/SKILL.md) | 読者と目的から構成を選び、条件・主体・用語・証拠を明確にする。複合文書の強制分割、英語語数規則の日本語への転用、全コード例のタブ統一を外した |
| [unslop](https://github.com/cursor/plugins/blob/78f46dacbafc71fd7d937bfc2c26da914f1bc09b/pstack/skills/unslop/SKILL.md) | 冗長さ・曖昧さ・過圧縮を減らす。AI著者判定や語句・記号の一律禁止にはせず、意味・条件・留保・根拠を保つ |
| [bro](https://github.com/cursor/plugins/blob/78f46dacbafc71fd7d937bfc2c26da914f1bc09b/pstack/skills/bro/SKILL.md) | 直前の説明を短く言い直す。新しい調査を始めず、必要な留保を落とさない |
| [reflect](https://github.com/cursor/plugins/blob/78f46dacbafc71fd7d937bfc2c26da914f1bc09b/pstack/skills/reflect/SKILL.md) | 判断・道具・別の進め方を照合し、既存スキルの具体的な改善案にする。固定モデルと三人の委譲、履歴パス、自動の課題登録を外す。変更先と差分への人間の承認後に反映する |
| [automate-me](https://github.com/cursor/plugins/blob/78f46dacbafc71fd7d937bfc2c26da914f1bc09b/pstack/skills/automate-me/SKILL.md) | 本人の作業方針を個人向けスキルとして提案する。明示された方針と行動からの推測を分け、本文・保存先・共有範囲への承認後に保存する。固定配置、自動コミット・PR作成を外す |

各スキルに原版のMIT LICENSEを同梱した。標準のfrontmatterにname・description・licenseを置き、製品固有の起動設定を共通本文の前提にしない。

## エージェントの採用

「両方」は直前に比較したpstackの2体を指すと解釈し、役割が分かる名前に変更した。

- [poteto-agent](https://github.com/cursor/plugins/blob/78f46dacbafc71fd7d937bfc2c26da914f1bc09b/pstack/agents/poteto-agent.md) → `devlow-worker`。入口のスキルを先に読む仕組みを採用し、devlowの全体フロー・必要工程・use-principlesへ接続する。親の全体計画を再作成せず、担当単位と所有範囲を守る。
- [Comment Sicko](https://github.com/cursor/plugins/blob/78f46dacbafc71fd7d937bfc2c26da914f1bc09b/pstack/agents/comment-sicko.md) → `comment-curator`。コメント整理の専門担当とし、no-commentsを先に読む。攻撃的な口調、根拠不明なら削除、正しさに関わる抑制指示の削除は採用しない。OKFへの先行保存と内容照合を行う。

Codexの正本は `packaging/codex/templates/agents/*.toml`、Claude形式は `packaging/claude-code/agents/*.md`。2役の指示は両形式で一致させ、モデル・権限設定を追加していない。原版のMIT LICENSEは各配布物の `assets/pstack-agents-LICENSE`へ同梱する。

Codexのcopy配置へスキルの絶対パスを焼き込むとインストール場所に依存するため、親が実際の配置から解決したパスを渡す方式にした。パスがない場合はスキル一覧またはsetupの管理指示から特定し、読めない場合を明示する。全体フローの [担当の受け渡し](https://github.com/sori883/koto/blob/77b4d4f87a4c575ccb4b243f2a62acd17cd446a2/skills/devlow/references/delegation.md)に契約を置く。

形式は[Codexのカスタムエージェント](https://developers.openai.com/codex/subagents)、[Claude Codeのサブエージェント](https://code.claude.com/docs/en/sub-agents)、[VS Codeのプラグイン仕様](https://code.visualstudio.com/docs/agent-customization/agent-plugins)を確認した。Codexは必須のname・description・developer_instructions、Claude形式はname・descriptionと本文を使う。CopilotにはClaude形式を同梱し、製品UIでの読込・起動は別の未検証事項として残す。

## コメントと知識の接続

二つの方式を比較した。元コメントをそのまま削除し後で知識化する方式では、途中失敗で理由を失う。先に保存・内容照合し、次に削除する方式を採用した。OKFとソースを跨ぐトランザクションはなく、削除後の検証で問題があれば自分の削除だけを戻し、保存した知識は残す。

`code_refs`は既存のOKFプロファイルの配列を利用する。行番号・シンボルをパスに混ぜず本文へ置く。how・why・devlowの調査と各製品の導入指示からパス検索へ接続し、ソース内の代替リンクコメントを必須にしない。OKF CLIの検索・保存形式そのものは変更していない。

## 判断ログの接続

既存行を直接書き換える方式と、訂正行を追記する方式を比較し、経緯を残せる後者を採用した。新規TSVは `id ts run phase decision why evidence result supersedes`。単なる状態変化と元記録の誤りを区別し、循環・重複ID・競合訂正は照合時に扱う。スキルの手順として提供し、専用ログCLIや並行追記の自動排他は追加していない。一人の書き込み担当を決める。

## 確認した範囲

- 追加した14スキルのfrontmatterをskill-creatorのquick_validate.pyで確認した。最後に追加したreflect・automate-meも個別に成功した。
- `bun scripts/build.ts` がエージェントを含む両形式の配布物314ファイルを生成し、全配布Markdownの相対リンクを検証した。
- `bun run typecheck` が成功した。
- `bun test tests/distribution` は7件・213 assertionsが成功した。リポジトリ外のCodex・Claude Code・Copilot用利用先で、初期化、既存内容の保持、再適用、各CLI、エージェントの形式と配置を確認した。Codexの利用先で編集されたエージェントをsetupが上書きしないこと、両形式の指示が一致しモデル・権限設定を固定しないことも確認した。
- バージョンを0.1.3へ更新した後の全体テストは170件成功・2件skip・1053 assertions。既存のGo実行ファイルとの比較2件は未実行である。CIと同じ依存関係の固定インストール、3つのCLIの起動、型検査、生成物照合と差分の空白検査も成功した。
- 配布テストに、コメント由来の知識の保存・読み返し・形式検証、コメント削除後の `--for-path` 検索を追加した。これは保存・検索の実経路の確認であり、AIがコメントの価値を正しく判定することの自動検証ではない。

手順の文面では、根拠不明コメントの保持、ツール指示の保持、読み取り専用レビュー、再現失敗と環境失敗の区別、訂正と通常の状態変化、知識の版の照合、文章の不確実性の保持を点検した。独立エージェントによる行動試験や各製品UIでの新スキル起動は未実施である。

## reflect・automate-meの承認境界

ユーザーは2スキルの採用と、利用時の作成に人間の承認を求めることを指定した。既存スキルの変更も同じ境界に含め、本文・description・参照資料・スクリプトの具体案を提示してから適用する。スキルの呼び出し自体、一般的な自律実行の許可、無回答、AI担当の賛成を未提示の差分の承認にしない。同じ案が既に承認済みなら重ねて確認せず、対象や内容が変わった場合は改めて確認する。

草案を実際のスキルディレクトリに置いてからレビューする方式と、発見対象外で提示する方式を比較し、承認前に有効化されない後者を採用した。共通手順は [reflectの承認資料](https://github.com/sori883/koto/blob/77b4d4f87a4c575ccb4b243f2a62acd17cd446a2/skills/reflect/references/approval.md)へ置き、automate-meも参照する。既存の仕事の完了を、この追加改善の承認待ちに巻き込まない。

この承認境界はAIが従うスキル本文の手順として提供する。ファイルシステムへの書き込みをプログラムで阻止する機構は追加していない。

人間に選択式の確認が見えていなかったという会話を踏まえ、案への参照と承認の問いは会話本文にも表示する。静的な手順点検では、未回答なら草案に留める、一部承認なら対象を限定する、既承認の同じ差分は再確認しない、承認後に保存先・内容が変われば再確認する、他者の編集は上書きしない、という分岐を確認した。実エージェントによる承認待ち・再開の行動試験は未実施である。

## 追加レビューの反映

2026-09-26。ユーザーが提示した静的レビューの3件を、現在の定義と既存設計で照合して採用した。

- maintain-verification-skillは、対象がなければ検索範囲と「対象なし」を報告する。create-verification-skillへ渡すのは、新規作成が既存の依頼・承認に含まれる場合だけにした。点検から無条件に新規作成へ広げない。
- blast-radiusは単独起動でも既存OKFを検索し、実ファイルの `code_refs`に対応する理由・制約を本文と現在のコードで照合する。確認したconceptと不足を結果へ含める。
- interrogateはレビュー前に同じ確認を行い、bundle・concept・根拠・検索範囲・未確認事項を各担当へ渡す。OKFの実パスも渡し、担当プロンプトから不足分を読み取り専用で確認できるようにした。

devlowとsetupの指示による検索は維持し、確認済みの知識は対象・版への適合性を確かめて再利用する。bundleなし・検索結果なし・取得不能を区別し、調査のための初期化や保存は追加しない。OKF CLI、no-comments、エージェント定義は変更していない。

変更した3スキルの形式検証、配布テスト7件・213 assertions、314ファイルの生成物照合と差分の空白検査が成功した。新しい動作の確認は手順の静的な照合までであり、実エージェントによる単独呼び出しや担当への受け渡しは未検証である。
