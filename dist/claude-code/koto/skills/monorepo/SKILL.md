---
name: monorepo
description: kotoのCLIで管理ルート、プロジェクト、Gitリポジトリ、タスクごとのWorktreeを管理する。作業場所の準備・片付け、更新取得・登録解除、利用先のAGENTS.md・CLAUDE.mdへのkoto指示の追加・更新に使う。
---

# monorepo

[CLIの利用手順](../../cli/monorepo/README.md)を読み、依頼された操作を選ぶ。実行入口は、このSKILL.mdのディレクトリを基準に `../../cli/monorepo/monorepo.ts`。その実在する絶対パスを使って `bun <CLIの絶対パス> <command> --root <管理ルート> --project <project-id> --json` と実行する。setupとproject add/listには `--project` を渡さない。

管理ルート、プロジェクト、対象リポジトリ、タスクIDを依頼と既存の会話から特定する。分かっている値は再確認せず、判断できない対象だけを確認する。プロジェクト指定がなければdefaultを使う。存在しない対象やアクセス拒否を理由に、別のプロジェクトへ切り替えない。

初めて使うルートにはsetupを実行する。以後は必要なプロジェクト追加・リポジトリ登録を行い、workspace createで作業場所を用意する。既存環境を使う場合はshowまたはstatusで確認する。最新の開始地点が必要なら、対象リポジトリをsyncしてから作業場所を作る。

利用先の指示ファイルの追加・更新を依頼されたら、[指示ファイルの手順](../../cli/monorepo/README.md#指示ファイルの追加更新)に従う。管理ルート・projectに加え、配置先の絶対パスをtarget、製品をcodexまたはclaude-codeで明示し、instructions planで管理ブロックと衝突を確認する。更新が依頼範囲にありcanApplyがtrueならapplyし、statusのcurrentを確認する。既存の承認を理由なく聞き直さない。plan/statusだけの依頼ではapplyしない。

管理部分の独自編集、旧setupの未完了操作、ロックがあれば手順に沿って原因を確認する。記録や管理マーカーを削除して上書きを通さない。PARTIAL_FAILUREは同じ対象・配布元のstatusで確認して再実行する。配布元の場所が変わった場合は実在する新版をsourceに指定して更新する。配置だけでクライアントが読み込んだと扱わず、利用先の指示との矛盾や適用範囲も確認する。

入力検証、パス算出、登録情報の更新、排他、再実行はCLIに任せる。管理JSONを直接編集してエラーを迂回しない。JSONのokと終了コードに加えて、照会結果のready・observed・problemを確認する。途中失敗では各リポジトリの結果を伝え、原因を解消できた場合に同じ入力で再実行する。ロックや所有情報の不一致を自動的に削除して進めない。

作業は返されたpathで行い、変更の保存・統合・PRは既存GitやGitHub CLIを使う。repo removeは登録解除であり、Gitデータが残ることを結果とともに説明する。Memory・Tasksの内容はこのCLIでは管理しない。

片付けを依頼されたら、対象の作業や開発サーバーが停止していることを確かめ、`workspace remove <task-id> --dry-run`で全リポジトリの削除対象と保護条件を確認する。canRemoveがtrueで、対象が依頼の範囲に収まる場合は、同じコマンドから`--dry-run`を外して実行する。既に得られた依頼を理由なく再確認しない。プレビューと実行の双方でCLIがリモート追跡情報を更新する。

canRemoveがfalseなら、repositories内のproblem・message・detailsから止まった理由を説明する。保存・削除を指示されていないファイルを処分したり、勝手にpushしたりして削除条件を迂回しない。ignoredファイル、未送信コミット、通信失敗も停止の理由になる。PARTIAL_FAILUREの場合は原因を解消して同じremoveを再実行する。片付け中のタスクにcreateを実行して作り直さない。

完了時は削除した作業場所と、保持したブランチ・Git履歴を伝える。タスク直下のメモ等が残った場合はparentRetainedも説明する。ブランチを保持するため、同じ作業ブランチ名を使った新しいcreateは競合する。履歴の削除を片付けの一部として自動実行しない。
