# 標準原則を担当スキルへ移す

2026-11-17の依頼に基づく配置変更。標準の開発原則を読むために、利用先Memoryの初期化・共通文書のコピー・検索を要求しない。

- 23原則をdevlaw/references/principlesへ移し、本文・適用条件・原則間リンクを維持する。開始・各工程の目次から必要な本文だけを読む。
- OKFの管理メタデータは配布する参照資料から外す。出典は下表、MIT著作権表示はdevlaw/LICENSEに保持する。
- 設計判断の記録手順はmemory/referencesへ移す。開発原則への関連リンクは外し、Memory単独で成立させる。devlawから同じ記録手順を直接読む。
- use-principlesを削除し、コア6個と補助koto-usageの計7個にする。
- space/defaultにはMemoryの初期目次・履歴・LICENSEを残す。setupの配置対象は生成manifestから変わり、汎用の削除機能は追加しない。
- 利用先の既存資料は通常更新で保持する。明示的な整理はsetupの利用手順で案内し、編集差分・参照元を確認する。開発リポジトリ自身の.spaceや他プロジェクトへ今回の変更を適用しない。

## 原則の出典

| 資料 | 取込元 |
| --- | --- |
| `attack-the-premise.md` | [pstack](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/principle-attack-the-premise/SKILL.md) |
| `boundary-discipline.md` | [pstack](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/principle-boundary-discipline/SKILL.md) |
| `build-the-lever.md` | [pstack](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/principle-build-the-lever/SKILL.md) |
| `encode-lessons-in-structure.md` | [pstack](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/principle-encode-lessons-in-structure/SKILL.md) |
| `exhaust-the-design-space.md` | [pstack](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/principle-exhaust-the-design-space/SKILL.md) |
| `experience-first.md` | [pstack](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/principle-experience-first/SKILL.md) |
| `fix-root-causes.md` | [pstack](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/principle-fix-root-causes/SKILL.md) |
| `foundational-thinking.md` | [pstack](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/principle-foundational-thinking/SKILL.md) |
| `guard-the-context-window.md` | [pstack](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/principle-guard-the-context-window/SKILL.md) |
| `laziness-protocol.md` | [pstack](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/principle-laziness-protocol/SKILL.md) |
| `make-operations-idempotent.md` | [pstack](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/principle-make-operations-idempotent/SKILL.md) |
| `migrate-callers-then-delete-legacy-apis.md` | [pstack](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md) |
| `minimize-reader-load.md` | [pstack](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/principle-minimize-reader-load/SKILL.md) |
| `model-the-domain.md` | [pstack](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/principle-model-the-domain/SKILL.md) |
| `never-block-on-the-human.md` | [pstack](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/principle-never-block-on-the-human/SKILL.md) |
| `outcome-oriented-execution.md` | [pstack](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/principle-outcome-oriented-execution/SKILL.md) |
| `prove-it-works.md` | [pstack](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/principle-prove-it-works/SKILL.md) |
| `redesign-from-first-principles.md` | [pstack](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/principle-redesign-from-first-principles/SKILL.md) |
| `separate-before-serializing-shared-state.md` | [pstack](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/principle-separate-before-serializing-shared-state/SKILL.md) |
| `sequence-verifiable-units.md` | [pstack](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/principle-sequence-verifiable-units/SKILL.md) |
| `subtract-before-you-add.md` | [pstack](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/principle-subtract-before-you-add/SKILL.md) |
| `test-behavior-not-implementation.md` | [pstack](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/principle-test-behavior-not-implementation/SKILL.md) |
| `type-system-discipline.md` | [pstack](https://github.com/cursor/plugins/blob/032be146865d973682535de75f2287da438550bf/pstack/skills/principle-type-system-discipline/SKILL.md) |

## 検証

- Bun 1.4.2で全338テストが成功（24ファイル、2,611 assertions）。型検査も成功。
- Codex・Claude Code・Copilotの配布物を一時ディレクトリへコピーし、新規導入でMemoryのconceptが0件、標準23原則と記録手順がスキル内に存在することを確認した。Memory未準備でも記録手順を直接読める。
- プロジェクト導入の移設後もCLIとスキルの相対参照が成立する。利用先独自の原則をMemoryから取得でき、setupの再実行でも編集内容が残る。
- 旧構成を再現した導入データを3製品分作り、更新後のretainと編集済み本文・独自文書の保持を確認した。未編集資料の配置ハッシュ照合、Memoryの削除予定に現れる参照元、参照のない資料のif-hash付き削除、再更新で再配置されないことも確認した。スキルの未管理追加ファイルは保持した。
- 移動前の23原則と移動後の本文は、OKFのfrontmatterを除いて一致する。旧メタデータのgovernanceは全件contextで、必須制約の削除はない。MITの著作権表示も一致する。
- devlaw・memory・setupはskill-creatorのquick_validateに合格した。
- 配布物220ファイルを再生成し、build:checkとgit diff --checkに合格した。

更新検証には旧配置を再現したテストデータを使い、利用者の実プロジェクトには適用していない。クライアント上でのAIによる原則選択・適用の品質は、このCLI・配布検証では判定していない。
