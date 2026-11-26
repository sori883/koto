# ノートを作る

ノートの作成では、利用者がブラウザまたはCLIから題名付きのノートを保存し、書きかけの下書きを取り消し、保存したノートを利用者向けの別の画面から確かめられる。

## サブ機能

- `create-open`は、ブラウザの各入口から空のエディタを開く。
- `create-save`は、題名と本文を保存する。
- `create-cancel`は、ブラウザの書きかけの下書きを破棄する。
- `create-cli`は、端末から同じ形のノートを作る。

## たどり着き方（利用者の視点）

- ブラウザのツールバーで`New note`ボタンを選ぶ。
- 編集可能な欄の外にフォーカスがある状態で、ブラウザで`n`を押す。
- 端末で`notes create --title <title> --body <body>`を実行する。

## control-notesで操作する

前提：

- Notesが`http://127.0.0.1:4173`で正常に動いている。
- `Release checklist`という題名のノートがない。
- `control-notes doctor`が、期待するURLと使い捨てのデータディレクトリを報告する。

- **エディタを開く。** `New note`を選ぶ。`control-notes browser click --role button --name "New note"`を実行する。`Note editor`という名前のフォームが現れ、`Title`のテキストボックスにフォーカスがある。
- **内容を入れる。** 題名と本文を入力する。`control-notes browser fill --role textbox --name "Title" --value "Release checklist"`と`control-notes browser fill --role textbox --name "Body" --value "Tag and publish"`を実行する。`Save note`ボタンが有効になる。
- **ノートを保存する。** `Save note`を選ぶ。`control-notes browser click --role button --name "Save note"`を実行する。`Note saved`という名前のステータスが現れ、見出しが`Release checklist`になる。
- **保存を確かめる。** ノートの一覧に戻り、ノートを開き直す。`control-notes browser click --role link --name "All notes"`と`control-notes browser click --role link --name "Release checklist"`を実行する。エディタに保存した2つの値が表示される。
- **下書きを取り消す。** 新しいノートを開き、`Discard me`と入力して`Cancel`を選ぶ。`control-notes browser click --role button --name "New note"`、`control-notes browser fill --role textbox --name "Title" --value "Discard me"`、`control-notes browser click --role button --name "Cancel"`を実行する。ノートの一覧に戻り、`Discard me`のリンクがない。
- **CLIの入口。** 2つ目のノートを作る。`control-notes cli -- notes create --title "CLI note" --body "Created from terminal" --format json`を実行する。終了コードが`0`で、stdoutに新しいノートのIDと題名が含まれる。
- **証明。** 保存した2つのノートを`All notes`から開き直す。`control-notes browser snapshot --aria --path artifacts/create-note/list.aria.txt`と`control-notes browser screenshot --path artifacts/create-note/list.png`を実行する。成果物に`Release checklist`と`CLI note`が写っている。

## 注意点

- テキストボックスにフォーカスがある状態で`n`を押すと、新しいエディタが開かずに文字が入力される。
- 題名は保存時に前後の空白が除かれる。下書きの入力値ではなく、表示された題名を確かめる。
- 保存のステータスだけでは証明として足りない。一覧からノートを開き直す。
- 後片付けで`Release checklist`と`CLI note`を消す。ただし、それらの証明の成果物は残す。
