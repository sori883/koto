### Worktree and simulator cleanup

1. 現状を記録して監査する。`df -h /`を記録し、`scripts/worktree-audit.sh [-b <pr-base-ref>] [repo-path]`を実行する（principle-build-the-lever）。`-b`なしでは`MERGED`を`origin/HEAD`に対して確かめるので、PRが別のブランチを対象にしているときは`-b origin/<branch>`を渡す。パスは手で打たず`git worktree list`から読む。手で打った`myrepo-worktrees/x`では、`.claude/worktrees/x`にあるものを取りこぼすからである（principle-encode-lessons-in-structure）。スクリプトは各worktreeを、サイズ、経過時間、マージの状態、コミットしていない作業、PRの状態、それに触れた最新のセッションで分類し、区分を提案する。会話記録の走査は遅いので、バックグラウンドで実行する。
2. 区分は助言であって、許可ではない。本当の成果物は、ピン留めされたセッションと進行中のセッションである（principle-prove-it-works）。その一覧を利用者またはサイドバーから得て、すべての候補と照らし合わせる。このスクリプトが、利用者がピン留めしていたworktreeを`safe`と判定したことがあるので、ピン留めの一覧を優先する。
3. 削除する前に使用状況を確かめる。`verify-recent-chat`の行すべてと、疑わしいものについては、サブエージェントを並行に起動して会話記録（`~/.claude/projects/<作業フォルダのパスを変換した名前>/<セッションID>.jsonl`。サブエージェントの記録はその`<セッションID>/subagents/`の下）を読ませ、そのセッションがピン留めまたは進行中か、どのworktreeに触れているかを報告させる（principle-guard-the-context-window。会話記録は大量である）。ピン留めされたセッションは、バックグラウンドのサブエージェントを通じて、arenaや再現用のツリーを隣のworktreeに作る。それらの名前がサイドバーに出なくても、使用中である。各サブエージェントの推論の強さは、「サブエージェント」の節に従って作業ごとに選ぶ。
4. 元に戻せない損失の前では止まる。`wip:N`は、追跡されているコミットしていない編集がN件あることを示す。先に差分を見せて判断を得る。きれいなworktreeの削除はブランチから復元できるが、コミットしていない作業は失われるからである。`scratch:N`は追跡されていない使い捨てのもので、消してよいが、ファイル名を挙げる。「自律性」の節に従い、きれいでマージ済みで使用中でないものは進める。`wip`と使用中のものは止まる。
5. 確認した集合を削除する。パスごとに`git worktree remove --force <path>`を実行する。無視されたビルド成果物のせいでディレクトリが残ったら、`rm -rf`で消してから`git worktree prune`を実行する。ブランチの参照は残るので、コミットは失われない。`df -h /`と一覧の再表示で確かめる。
6. シミュレータとその他の容量回収。次に大きく効くのは、たいていシミュレータである。`xcrun simctl --set testing delete all`（XCTestDevicesの複製）、`xcrun simctl delete unavailable`、そして古いランタイムには`xcrun simctl runtime list`のあとで`runtime delete <id>`を使う。必要ならさらに、Xcodeの`DerivedData`と`iOS DeviceSupport`、エディタのアプリデータ（`~/Library/Application Support/<エディタ名>`の下の、バックアップや作業フォルダごとのスナップショットなど、肥大化しやすいもの）、パッケージのキャッシュ（pnpm、uv、brew、yarn）。消すのは、利用者が残すと言っていないキャッシュだけにする。

これは、コードレビューで誤りを拾えないまま利用者の状態を削除する唯一のプレイブックなので、上の関門がレビューの役目を果たす。

**返答：** 前後の`df -h /`と回収した容量、削除したworktree、残したものそれぞれの一行の理由（どのセッションで使用中か、またはコミットしていない作業があるか）。
