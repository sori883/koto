# kotoへの改名

2026-09-27。ユーザーが名称をkoto（コト）に決定した。Knowledge-Oriented Task Orchestrationの略で、OKFによる知識の継承とタスクの分割・管理を表す。設計正本は[architecture.md](architecture.md)。GitHubのリポジトリ名変更はユーザーが行う。

公開作業は[Issue #20](https://github.com/sori883/koto/issues/20)で追う。0.1.4の[PR #19](https://github.com/sori883/koto/pull/19)はCI成功後にmainへ取り込んだ。利用者が更新したREADMEを含め、次のパッチ版0.1.5として改名を公開する。

## 変更範囲

ルートのpackage名、プラグイン・マーケットプレイス名、表示名、GitHub参照先、ランタイムパッケージ名、指示テンプレート、導入手順、テスト、Serenaのプロジェクト名をkotoへ変更した。版数は0.1.5とする。配布物は正本から生成し、`dist/codex/koto/`と`dist/claude-code/koto/`へ切り替える。

既存スキルの名前、CLIの入口、タスクと知識の保存先は変更しない。過去の導入結果・検証記録にある旧名と、実在したタスクID・旧vendorパスは当時の事実として残す。過去のIssue・CIへのGitHubリンクは新しいリポジトリ名へ更新する。開発リポジトリの`.space/`と`work/`、Gitのremote設定、利用者のプラグイン登録は変更対象に含めない。

## setupの引き継ぎ

単純なID置換では、旧状態を未導入と判定して指示ブロックが重複し、配置済みエージェントの更新にも衝突する。kotoの管理記録がない場合だけ、同じ製品の旧管理記録を前回の配置情報として読み取る。新しい管理記録はkoto名で作り、旧記録は保全する。新旧のブロックが両方ある場合やローカル編集がある場合は停止する。

移行も通常のpendingによる再開経路を使う。旧名のpendingがいずれかの製品に残っている間は更新を止め、書き込み時は新旧両方のロックを取る。旧vendorの記録は読み取りと保持に対応するが、新しいmanifestが旧名のvendorへ配置することは許可しない。操作するAI向けの手順は[setupの資料](../skills/setup/references/setup.md#agent-gearからの切り替え)に置く。

## GitHubとローカルの切り替え順序

1. この変更をコミット・pushし、ソース・dist・カタログを同じ変更としてmainへ取り込む。土台のnatural-japanese 0.1.4はPR #19でmainへ反映済み。
2. GitHubのリポジトリ名をユーザーが`agent-gear`から`koto`へ変更する。
3. 新しい場所へcloneする。

   ```sh
   git clone https://github.com/sori883/koto.git
   cd koto
   bun install --frozen-lockfile --ignore-scripts
   bun run build:check
   ```

4. エディタでは新しいcloneを開く。ローカルパスで登録したマーケットプレイスやプラグインは新しい配置先へ切り替える。旧名のプラグインを無効にしてkotoを導入し、利用先ごとにsetupを更新する。
5. 旧チェックアウトに未コミット・未追跡・ignoredの必要なファイルが残っていないか確認する。GitHubへ反映されていないファイルはcloneされないため、必要なものは別途引き継ぐ。

改名前は`sori883/koto`がまだ使えないため、READMEの新しいGitHub導入例は手順2の後に使う。cloneは新しいローカルディレクトリへ切り替える方法として採用し、既存チェックアウトを自動で移動・削除しない。

## 検証

実施結果は次のとおり。

- `bun run typecheck`：成功。
- `bun run test`：194件成功、2件skip、失敗0件。skipは外部Go版OKF実行ファイルを使う互換性テスト。
- setupの三製品での引き継ぎ、指示ブロックの重複防止、ローカル編集の保護、旧pending・旧ロック、旧vendorからの更新、CLI強制終了後の再開：成功。
- リポジトリ外へコピーした三製品の配布物で、setup・OKF・orch・natural-japaneseを実行：成功。
- `bun run build`：378ファイルを生成。旧名のdistを残さず、新名の配布物とカタログへ切り替え。
- `bun run build:check`と`git diff --check`：成功。

GitHubでの改名、新URLからのclone、クライアントのプラグイン登録切り替えは、このローカル実装の検証とは区別する。
