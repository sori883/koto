# 図を描画する

見せる各`.mmd`ファイルをnpmパッケージ`pele@1.9.0`で描画し、利用者にはSVGを渡す。Peleは、リポジトリの外に一度だけインストールする。各SVGは、その`.mmd`ファイルの隣に同じ名前で書く。APIは https://pele.run/api にある。`render`のオプションには`{ limit: 1_000_000, outputLimit: 8_000_000, maxEdges: 10_000 }`を渡す。Peleの既定値は、500状態の図がなりうる大きさより小さい。Peleが`PeleError`を投げたときは、利用者にMermaidのテキストとエラーを見せる。

## 色

PeleはMermaidの`theme`と`themeVariables`を無視する。`.pele`に、Peleの`--pele-*` CSS変数を設定する。一覧は https://pele.run/theming にある。コマンドは各状態に、`class sN teal`のように、そのグループの色のクラスを付ける。悪い状態にはそれぞれ`class sN breaks`か`class sN mayBreak`、不具合への最短の経路にある各状態には`class sN bugPath`、PROPERTYの反例が永遠に繰り返す各状態には`class sN repeats`を付ける。Peleはこれらのクラスを状態のノードに付ける。クラスにはCSSで色を付ける。

`.mmd`ファイルには、どのMermaidビューアーでも不具合のマークが見えるように、`breaks`と`mayBreak`の`classDef`行がある。グループの色、`bugPath`、`repeats`の`classDef`はない。Peleは各`classDef`の色をノードの`style`属性として書き、`style`属性は通常のCSSルールに勝つ。そのため、下のマークのルールは`!important`を使う。それがないと、ダークテーマでも明るいマークの色のままになる。不具合のマークは塗りと文字を設定し、`bugPath`と`repeats`は枠線を設定する。マークがグループの色の上に出るように、マークのルールはグループの色の後に置く。

これらの色は提案である。各SVGの先頭の`<style>`要素に入れる。すると各SVGは、見る人の明るい・暗いの設定に従う。

```css
.pele {
  --pele-bg: #ffffff;
  --pele-fg: #1c1c1c;
  --pele-muted: #656565;
  --pele-line: #808080;
  --pele-surface: #fcfcfc;
  --pele-surface-alt: #f1f1f1;
  --pele-border: #c9c9c9;
}
.pele .blue rect { fill: #c3e0ff; }
.pele .orange rect { fill: #f0d3bf; }
.pele .purple rect { fill: #e3d5ff; }
.pele .yellow rect { fill: #f0dcbf; }
.pele .teal rect { fill: #bfe3df; }
.pele .tan rect { fill: #e5d9ce; }
.pele .pink rect { fill: #ffcbe6; }
.pele .breaks rect {
  fill: #ffecee !important;
  stroke: #e72e3b !important;
  stroke-width: 2.5px !important;
}
.pele .breaks text {
  fill: #cd2834 !important;
}
.pele .mayBreak rect {
  fill: #fff3e6 !important;
  stroke: #e8730c !important;
  stroke-width: 2.5px !important;
}
.pele .mayBreak text {
  fill: #b85a06 !important;
}
.pele .bugPath rect {
  stroke: #1680f3 !important;
  stroke-width: 2.5px !important;
}
.pele .repeats rect {
  stroke: #9b35d6 !important;
  stroke-width: 2.5px !important;
  stroke-dasharray: 6 3;
}
@media (prefers-color-scheme: dark) {
  .pele {
    --pele-bg: #1f1f1f;
    --pele-fg: #f5f5f5;
    --pele-muted: #acacac;
    --pele-line: #939393;
    --pele-surface: #121212;
    --pele-surface-alt: #2c2c2c;
    --pele-border: #4e4e4e;
  }
  .pele .blue rect { fill: #1b3857; }
  .pele .orange rect { fill: #573117; }
  .pele .purple rect { fill: #3c2e57; }
  .pele .yellow rect { fill: #573d17; }
  .pele .teal rect { fill: #174641; }
  .pele .tan rect { fill: #3d3127; }
  .pele .pink rect { fill: #57233e; }
  .pele .breaks rect {
    fill: #2e2021 !important;
    stroke: #cf2b35 !important;
  }
  .pele .breaks text {
    fill: #ff6463 !important;
  }
  .pele .mayBreak rect {
    fill: #2e2619 !important;
    stroke: #d0700f !important;
  }
  .pele .mayBreak text {
    fill: #ffa257 !important;
  }
  .pele .bugPath rect {
    stroke: #116dd2 !important;
  }
  .pele .repeats rect {
    stroke: #9a3fcf !important;
  }
}
```
