---
name: control-ui
description: ローカルのブラウザ/CDPハーネスを組み立てる、または既存のものを流用して、Web・IDE・ElectronのUIを操作・検査する。ローカルでのUI検証、スクリーンショット、アクセシビリティスナップショット、パフォーマンスプロファイル、見た目の差分、UIバグの再現に使う。
---

# UIを操作する

ローカルのブラウザ自動操作を使い、証拠付きでUIの動作を検証する。まず、リポジトリにPlaywright・ブラウザ・Electronのハーネスがあればそれを再利用する。なければ、アプリの開発サーバーまたはChromiumのデバッグポートを使って一時的なローカルハーネスを組み立てる。

## 使いどころ

- 実際のブラウザのフォーカス、キーボード入力、スクロール、リサイズ、描画に依存するUIバグを再現する。
- 見た目やアクセシビリティの変更を、スクリーンショットとスナップショットで検証する。
- 出荷前に、ローカルでWeb・IDE・Electronの動作を確認する。
- コンソールログ、ネットワークログ、CPUプロファイル、トレース、ヒープスナップショットを取得する。
- `verify-this`のための変更前・変更後の証拠を作る。

## 準備の手順

1. リポジトリに記載された開発用コマンドで、アプリをローカルで起動する。
2. 既存のローカルハーネスを探す。Playwrightのテスト、Cypressのspec、Storybook、ブラウザ用スクリプト、Electronの起動スクリプト、スナップショットツールなど。
3. Webアプリなら、既存のブラウザツールでローカルのURLに接続する。
4. Electron/Chromiumなら、対応していればリモートデバッグポートを有効にする。
5. 正しいページは、タブの順番だけでなく、安定したアプリの目印で選ぶ。
6. 座標より、アクセシビリティのロール、ラベル、安定した`data-*`セレクタを優先する。

## 汎用のWebハーネス

できるだけリポジトリに導入済みのブラウザツールを使う。リポジトリにすでにPlaywrightがあれば、使い捨ての最小限の確認は次のようになる。

```javascript
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://127.0.0.1:<port>");
await page.getByRole("button", { name: /submit/i }).click();
await page.screenshot({ path: "/tmp/ui-harness-after.png", fullPage: true });
await browser.close();
```

ユーザーの依頼がない限り、この確認のためだけにPlaywrightをプロジェクトの依存関係に追加しない。既存の開発用依存関係か、環境ですでに使える外部のブラウザツールを優先する。

## 汎用のCDPハーネス

Electron、または`--remote-debugging-port=<port>`付きで起動したChromiumアプリには、CDPで接続する。

```javascript
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://127.0.0.1:<debug-port>");
const pages = browser.contexts().flatMap((context) => context.pages());
let page;
for (const candidate of pages) {
  if (await candidate.locator("<app-root-selector>").count()) {
    page = candidate;
    break;
  }
}

if (!page) {
  console.log(await Promise.all(pages.map(async (p) => ({
    title: await p.title(),
    url: p.url(),
  }))));
  throw new Error("No matching app page found");
}

await page.screenshot({ path: "/tmp/ui-harness-cdp.png", fullPage: true });
await browser.close();
```

`<app-root-selector>`は、現在のリポジトリにある安定した目印に置き換える。アプリのルート要素、ランドマーク、製品固有の`data-*`属性などである。

## 操作のループ

1. 操作の前に、ページのスナップショットかスクリーンショットを取る。
2. 最新のページ構造から対象を選ぶ。
3. 構造に関わる操作をちょうど1つ行う。クリック、入力、キー押下、ドラッグ、スクロール、移動、リサイズのいずれか。
4. 新しいスナップショット/スクリーンショットを取る。
5. 期待した状態の変化を確認する。
6. ユーザーが証拠を求めた場合は、変更前・変更後の比較用に成果物を保存する。

## CDPでできること

生のCDPは、高水準のブラウザAPIで足りない場合にだけ使う。

- パフォーマンス：CPUプロファイル、トレース、ペイントの点滅表示、FPSメーター、レイアウトシフトの調査。
- メモリ：リーク調査のためのヒープスナップショットと強制GC。
- ネットワーク：リクエストのブロック、帯域制限、キャッシュの無効化、リクエスト/レスポンスのログ。
- 描画：ビューポートの変更、カラースキームのエミュレーション、視差効果を減らす設定、アクセシビリティの確認。
- デバッグ：コンソールのストリーミング、例外の捕捉、DOMスナップショット。

## ページの選択

複数のアプリのウィンドウ/タブが同じデバッグポートを共有している場合：

- 検証対象の画面を示す肯定的な目印を優先する。アプリのルートセレクタなどである。
- 必要なら、否定的な目印を使って違う画面を避ける。
- 一致するページがなければ、推測せず、使えるページのタイトルとURLを一覧にする。

## 守ること

- 画面遷移や構造の変更の後に、古い要素参照に頼らない。
- クリックの直前に新しいスクリーンショットを取っていない限り、座標でのクリックは避ける。
- テストデータはローカルで、使い捨てにする。
- プライバシーに配慮が必要なワークスペースのスクリーンショットやヒープスナップショットは、ユーザーが明示的に同意しない限り保存しない。
- 別のリポジトリのセレクタ、ポート、スクリプトのパスをハードコードしない。現在のリポジトリのローカルなアプリの目印を見つける。
- 終わったら、開発サーバー、デバッグセッション、一時プロファイルを片付ける。
