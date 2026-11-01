---
name: okf-agent-memory
description: OKFの知識の検索・参照・保存をMemory CLIへ引き継ぐ。OKF Agent Memoryを指定された場合に、対象ルートと知識の保存先を確認する。
license: MIT
---

# Memoryで知識を扱う

[Memory](../memory/SKILL.md)のCLIと手順を使う。既存リポジトリをroot、通常はdefaultをprojectとし、保存先は `.space/default/memory/`。

古い知識が `.space/babel/` にある場合は、[setupの移行手順](../setup/references/setup.md#既存の知識を移行する)で対象と保存状態を確認する。旧領域を無視して空のMemoryを作らず、対象の移行が済むまで旧CLIの書き込みも行わない。

知識の形式はOKF。新規作成・更新には用途のscopeを指定し、更新ではcontent_hashを照合する。検索・参照の利用記録はMemoryの手順に従い、読み取り専用では記録を付けない。
