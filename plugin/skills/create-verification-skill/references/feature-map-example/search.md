# ノートを検索する

検索では、利用者が題名や本文の文字でノートを探し、一致したノートを確かめ、一致なしと検索が使えない状態を見分けられる。

## サブ機能

- `search-open`は、対応しているブラウザの各入口から検索を開く。
- `search-match`は、ノートのデータを変えずに、題名と本文の一致を返す。
- `search-open-result`は、結果をノートのエディタで開く。
- `search-empty`は、一致がない検索語に対して、完全な該当なしの状態を表示する。
- `search-clear`は、検索語を消し、最近のノートの表示に戻す。
- `search-cli`は、端末から同じ一致するノートを返す。

## たどり着き方（利用者の視点）

- ブラウザのツールバーで`Search`ボタンを選ぶ。
- 編集可能な欄の外にフォーカスがある状態で、ブラウザで`/`を押す。
- 端末で`notes search <query>`を実行する。

## control-notesで操作する

前提：

- Notesが`http://127.0.0.1:4173`で正常に動いている。
- 使い捨てのデータディレクトリに、本文が`Draft budget`の`Quarterly plan`がある。
- `control-notes doctor`が、期待するURLとデータディレクトリを報告する。

- **ツールバーの入口。** `Search`ボタンを選ぶ。`control-notes browser click --role button --name "Search"`を実行する。`Search notes`という名前のダイアログが現れ、その検索ボックスにフォーカスがある。
- **キーボードの入口。** ダイアログを閉じ、ページにフォーカスを当てて`/`を押す。`control-notes browser press --key "/"`を実行する。同じダイアログが現れ、ページにスラッシュは入力されない。
- **題名の一致。** `quarterly`と入力する。`control-notes browser fill --role searchbox --name "Search notes" --value "quarterly"`を実行する。`Search results`の一覧に`Quarterly plan`があり、`Grocery list`はない。
- **本文の一致。** 検索語を`budget`に置き換える。`control-notes browser fill --role searchbox --name "Search notes" --value "budget"`を実行する。結果の`Quarterly plan`が、本文の一致箇所の抜粋とともに表示されたままになる。
- **結果を開く。** `Quarterly plan`を選ぶ。`control-notes browser click --role link --name "Quarterly plan"`を実行する。ダイアログが閉じ、エディタの見出しが`Quarterly plan`になる。
- **該当なしの状態。** 検索を開き直し、`volcano`と入力する。`control-notes browser fill --role searchbox --name "Search notes" --value "volcano"`を実行する。検索が終わると`No matching notes`という名前のステータスが現れる。
- **検索語をクリアする。** `Clear search`を選ぶ。`control-notes browser click --role button --name "Clear search"`を実行する。検索ボックスが空になり、結果の一覧の代わりに`Recent notes`の領域が表示される。
- **CLIでの一致。** 端末から検索する。`control-notes cli -- notes search "quarterly" --format json`を実行する。終了コードが`0`で、stdoutに題名が`Quarterly plan`のオブジェクトが1つ含まれる。
- **CLIでの不一致。** 存在しない値を検索する。`control-notes cli -- notes search "volcano" --format json`を実行する。終了コードが`0`で、stdoutが`[]`になる。
- **証明。** 結果が表示された状態を残す。`control-notes browser snapshot --aria --path artifacts/search/results.aria.txt`と`control-notes browser screenshot --path artifacts/search/results.png`を実行する。どちらの成果物からも、Notes、検索語、`Quarterly plan`が分かる。

## 注意点

- エディタや検索ボックスにフォーカスがある状態で`/`を押すと、検索が開かずに文字が入力される。
- 結果は短いデバウンスのあとに更新される。決まった時間のsleepではなく、結果の一覧か該当なしのステータスを待つ。
- 利用者が`Include archived`を有効にしない限り、アーカイブしたノートは除かれる。
- CLIは既定で人間向けの出力になる。安定した確認には`--format json`を使う。
- 結果を開くとブラウザの状態が変わる。別の検索語を証明する前に、検索を開き直す。
