---
name: control-cli
description: 外部サービスを使わずに、対話型のCLIやTUIを操作・検査・プロファイルするローカルハーネスを組み立てる、または既存のものを流用する。CLIの使い勝手の確認、起動時間のリグレッション、メモリリーク、ハング、プロンプトの流れ、ターミナルのデモに使う。
---

# CLIを操作する

対話型のCLIは、手作業でいじるのではなく、繰り返し使えるローカルハーネスで動かす。まず、リポジトリにテスト/デモ用のハーネスがあればそれを再利用する。なければ、標準的なローカルツールで一時的なハーネスを組み立てる。

## 使いどころ

- 決まった入力で、CLI/TUIのバグを再現する。
- キーボード操作の流れ、プロンプト、割り込み、リサイズ時の動作、ターミナルのレイアウトを検証する。
- バグ修正の変更前・変更後のやり取りの記録を取る。
- 起動時間、遅い操作、ハング、メモリの増加をプロファイルする。
- 説明するより出力を見せたほうが早い場合に、短いターミナルのデモを録画する。

## ハーネスのループ

1. 検証対象のコマンドと、再現できる最小のワークスペースを特定する。
2. 既存のローカルハーネスを探す。パッケージのスクリプト、e2eテスト、デモの録画ツール、expectスクリプト、PTYのヘルパーなど。
3. ハーネスがなければ、決まった環境変数を設定した、独立したターミナルセッションでCLIを起動する。
4. 操作の前に、現在の画面を取得する。
5. 操作は1つずつ送る。テキスト、Enter、矢印キー、Escape、Ctrl-C、リサイズ。
6. 次の操作の前に、具体的な画面のパターンやプロンプトが出るまで待つ。
7. やり取りの記録とプロファイルの成果物を保存する。
8. セッションをきれいに終了する。

## ハーネスの選択肢

- リポジトリ固有のハーネス：アプリの起動方法、環境変数、プロンプトを把握しているので、リポジトリにあるスクリプトを優先する。
- `tmux`：セッション管理、`capture-pane`、`send-keys`、アタッチ/デタッチ。
- PTYの確認用スクリプト：tmuxが使えない場合は、Python、Node、Expectの短いスクリプトを使う。
- ランタイムのインスペクタ：CPUプロファイル、ヒープスナップショット、実行中の評価には、NodeまたはBunのインスペクタを使う。
- ターミナルの録画ツール：ユーザーがデモを求めた場合は、リポジトリにあるデモ用ツールか、asciinema互換のツールを使う。

## 最小限のtmuxハーネス

```bash
SESSION="cli-harness-$(date +%s)"
tmux new-session -d -s "$SESSION" -- <command-under-test>
tmux capture-pane -pt "$SESSION"
tmux send-keys -t "$SESSION" "help" Enter
tmux capture-pane -pt "$SESSION"
tmux kill-session -t "$SESSION"
```

Node製のCLIの場合：

```bash
NODE_OPTIONS="--inspect=127.0.0.1:0" tmux new-session -d -s "$SESSION" -- <node-cli-command>
```

ターミナルの出力からインスペクタのURLを読み取り、プロファイルが必要ならChrome DevTools互換のツールを使う。

## 最小限のPTYハーネス

tmuxもデモ用ハーネスもないリポジトリで、決まった条件で待つ必要がある場合はPTYスクリプトを使う。ユーザーが再利用できるテストの追加を求めない限り、一時的なものにとどめる。

```python
import os
import pty
import select
import subprocess
import time

master_fd, slave_fd = pty.openpty()
proc = subprocess.Popen(
    ["<command>", "<arg>"],
    stdin=slave_fd,
    stdout=slave_fd,
    stderr=slave_fd,
    close_fds=True,
)
os.close(slave_fd)

deadline = time.time() + 30
buffer = b""
while time.time() < deadline:
    ready, _, _ = select.select([master_fd], [], [], 0.25)
    if not ready:
        continue
    chunk = os.read(master_fd, 4096)
    buffer += chunk
    if b"<ready text>" in buffer:
        os.write(master_fd, b"help\n")
        break

print(buffer.decode(errors="replace"))
proc.terminate()
os.close(master_fd)
```

CLIがより高度なターミナル制御を必要とする場合は、`pty.fork()`か既存のPTYライブラリを使う。

## プロファイルの手順

- 起動時間のリグレッション：同じマシン、環境、コマンドで、変更前と変更後の起動時間を計測する。
- 遅い操作：CPUプロファイルを開始し、操作を行い、プロファイルを止めて、自己時間の上位の関数を比べる。
- メモリリーク：可能ならGCを強制してヒープスナップショットを取り、操作を繰り返し、もう一度GCを強制して別のスナップショットを取る。
- ハング：割り込む前に、画面、アクティブなハンドル/リソース、スタック/CPUのサンプルを取得する。

## 守ること

- スリープより、条件を決めた待ち方を優先する。スリープせざるを得ない場合は、理由を説明する。
- 操作中のセッションに、認証情報や破壊的なコマンドを送らない。
- リポジトリにテスト/デモ用のハーネスがない限り、ハーネスは`/tmp`に置く。
- 別のリポジトリのパスをハードコードしない。コマンドは現在のリポジトリのスクリプトとランタイムに合わせる。
- ユーザーが残すよう求めない限り、tmuxのセッション、一時ディレクトリ、インスペクタのプロセス、デモの成果物を片付ける。
