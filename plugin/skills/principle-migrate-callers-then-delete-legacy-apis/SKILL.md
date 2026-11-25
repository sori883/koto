---
name: principle-migrate-callers-then-delete-legacy-apis
description: 古い呼び出し元が残っている状態で新しい内部APIを入れるときに適用する。互換用の層を残さず、呼び出し元の移行と古いAPIの削除を一度に行う。
disable-model-invocation: false
---

# Migrate Callers Then Delete Legacy APIs

新しい内部APIを入れたら、呼び出し元をすべて移し、古いAPIを同じ回で消す。互換用の層を残さない。

- テストは新しい約束を確かめるよう書き換え、リファクタリング前の実装の細部だけを守っていたテストは消す。

**適用する条件：**

- 後方互換に依存する外部の利用者がいない。
- プロジェクトが、調整された破壊的変更を受け止められる。
- 新しいAPIが、単純化やリファクタリングの取り組みの一部である。
