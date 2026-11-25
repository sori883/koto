# TypeScriptのパターン

`SKILL.md`の各ルールのコード例。根本にある原則は言語を問わない。**type-system-discipline**と**boundary-discipline**の原則スキルを参照。

## ブランド型

プリミティブにブランドを付け、取り違えられないようにする。検証は境界で一度だけ行う。下流のコードは型を信頼する。

```ts
type AgentId = string & { readonly __brand: "AgentId" };

function isAgentId(input: string): input is AgentId {
  return isUUID(input);
}

function parseAgentId(input: string): AgentId {
  if (!isAgentId(input)) throw new Error(`Invalid agent id: ${input}`);
  return input;
}

function focusAgent(id: AgentId): void {
  /* input は信頼できる */
}
```

`readonly __brand: 'X'`の形に合わせる。新しい書き方を作らない。

## 判別可能なユニオン

種類の違いはリテラルの判別子で表す。どの種類も同じフィールド名を持ち、その値は種類ごとに異なるので、ありえない組み合わせを表現できない。

```ts
// しない。真偽値と省略可能なフィールドでは、矛盾した状態が存在できる。
type DiffState = { loading: boolean; diff?: GitDiff; error?: string };

// する。正しい状態だけが存在する。
type DiffState =
  | { kind: "loading" }
  | { kind: "ready"; diff: GitDiff }
  | { kind: "error"; error: string };
```

判別子の名前（`kind`、`type`、`tag`）は一つに決めて使い続ける。

## 構成によるモデル化

緩い型を実行時の確認で制限するのではなく、すべてが正しい部品から型を組み立てる。

空でない配列は、可変長のタプルで表す。

```ts
type NonEmpty<T> = [T, ...T[]];

// しない：T[] に、呼び出し元がみな繰り返す長さの確認を加える
function pickWinner(entries: string[]): string {
  if (entries.length === 0) throw new Error("no entries");
  return entries[Math.floor(Math.random() * entries.length)];
}

// する：この型の空の値は存在できない
function pickWinner(entries: NonEmpty<string>): string {
  return entries[Math.floor(Math.random() * entries.length)];
}
```

素の`T[]`が来る場所では、ガードで一度だけ絞り込む。その事実は以後、型が運ぶ。

```ts
const isNonEmpty = <T>(arr: T[]): arr is NonEmpty<T> => arr.length > 0;
```

偶数の長さは、組で表す。

```ts
type Pairs<T> = [T, T][];
```

時間の範囲は、開始と長さで表す。

```ts
// しない：不変条件をコメントが抱えている
type TimeRange = { start: Date; end: Date }; // start <= end

// する：負の範囲は書けない。終わりは必要なときに導く
type TimeRange = { start: Date; durationMs: number };
```

`durationMs`は素のnumberのままにする。ブランドを付ける（ブランド型の節のとおり）のは、長さが期待される場所に生のnumberが渡されうる場合だけにし、反射的に付けない。悪い状態を作れなくする表現を選び、必要な読み方はその上に用意する（`pairs.flat()`、`rangeEnd()`の補助関数）。

## 最も単純な全域の型

何でも強めない。それに対するすべての操作が全域なら、`T[]`のままにする。

```ts
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0); // [] は 0 になる。問題ない
```

緩い型のせいで使う場所で嘘をつくことになるなら、強める。兆候は`!`、`arr[0] as T`、「起きるはずがない」throwである。

```ts
// しない：部分性をコンパイラの目を盗んで持ち込んでいる
function newestSession(sessions: Session[]): Session {
  return sessions.at(0)!;
}

// する：入力を強めれば、アサーションが消える
function newestSession(sessions: NonEmpty<Session>): Session {
  return sessions[0];
}
```

結果を`Session | undefined`へ弱めるのが、もう一つの全域のシグネチャである。

## `any`より`unknown`

外部のデータは常に`unknown`とする。使う前に絞り込む。

```ts
// しない
function handle(input: any) {
  return input.foo.bar;
}

// する
function handle(input: unknown) {
  if (typeof input === "object" && input !== null && "foo" in input) {
    // 絞り込み済み。アクセスはコンパイラが確かめる
  }
}
```

外部の出どころには、RPCのペイロード、`JSON.parse`、`postMessage`、IPC、ファイルの内容、環境変数、データベースの結果がある。

## 手書きのガードの前にスキーマ

外部のデータに対して、プロパティを一つずつ調べる型ガードを書く前に、リポジトリの実行時スキーマのライブラリと既存のスキーマを探す。検証は一つのスキーマに持たせ、TypeScriptの型はそこから導く。食い違いうるスキーマ、重複したinterface、ガードの3つを保守しない。

```ts
import { z } from "zod";

const UserSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["admin", "member"]),
});

type User = z.infer<typeof UserSchema>;

function parseUser(input: unknown): User {
  return UserSchema.parse(input);
}
```

失敗が想定された分岐なら`safeParse`を使う。リポジトリが別のスキーマのライブラリを使っているなら、それに相当する型推論の補助を使う。ガード一つのために新しいスキーマの依存を加えない。このルールが優先するのは、コードベースがすでに信頼しているスキーマの仕組みである。

## `as`キャストを使わない

どの`as`も、実行時に落ちる可能性がある。キャストは、型システムが主張を確かめたあとにだけ行う。

```ts
import { z } from "zod";

// しない
const user = data as User;

// しない
function isUser(data: unknown): data is User {
  return typeof data === "object" && data !== null && "id" in data;
}

// する
const userSchema = z.object({ id: z.string(), name: z.string() });
type User = z.infer<typeof userSchema>;

function parseUser(data: unknown): User {
  return userSchema.parse(data);
}
```

型が先にある場合は、バリデータに、それが証明する型を注釈する。そうすると、型より証明する範囲が狭いバリデータをコンパイラが拒む。下のオブジェクトから`name`を消すと、代入がコンパイルできなくなる。

```ts
type User = { id: string; name: string };

const userSchema: z.ZodType<User> = z.object({ id: z.string(), name: z.string() });
```

既存のコードから`as`を取り除くときは、TypeScriptが推論できない理由を突き止める。

- 判別子がない：判別子を加え、判別可能なユニオンにする。
- 元の型が広すぎる（例：`Record<string, unknown>`）：絞り込む。
- 型のない境界：その形を持つスキーマで解析する。スキーマを加えるのは、ない場所だけにする。
- 本当に表現できない：ブランド型か`satisfies`を使う。

## 絞り込みの優先順位

最善から最後の手段の順に並べる。

1. **判別可能なユニオンのswitch・if。** コンパイラが自動で絞り込む。
2. **`in`演算子。** `"key" in obj`は、そのキーを持つ種類に絞り込む。
3. **`typeof`・`instanceof`。** プリミティブとクラスのインスタンスに使う。
4. **ユーザー定義の型ガード。** 上のどれでも足りないとき。
5. **`as`キャスト。** 検証のあとだけ。

```ts
function area(s: Shape): number {
  if ("radius" in s) return Math.PI * s.radius ** 2; // circle に絞り込まれる
  return s.width * s.height; // rect に絞り込まれる
}
```

## 型ガード

ガードは主張を本当に確かめなければならない。嘘をつくガードは`as`より悪い。

```ts
function isCircle(s: Shape): s is Shape & { kind: "circle" } {
  return s.kind === "circle";
}
```

できるなら判別子による絞り込みを優先する。

## 網羅性

defaultの分岐で、判別対象を`never`型のローカル変数に代入する。

```ts
// 値を返す switch
function area(s: Shape): number {
  switch (s.kind) {
    case "circle":
      return Math.PI * s.radius ** 2;
    case "rect":
      return s.width * s.height;
    default: {
      const _exhaustive: never = s;
      return _exhaustive;
    }
  }
}

// 値を返さない switch
function handle(s: Shape): void {
  switch (s.kind) {
    case "circle":
      drawCircle(s);
      break;
    case "rect":
      drawRect(s);
      break;
    default: {
      const _exhaustive: never = s;
      void _exhaustive;
    }
  }
}
```

値を返すswitchではreturnの形、文のswitchではvoidの形にする。

## `as`より`satisfies`

`satisfies`は、型を広げずに検証する。

```ts
// しない。型が広がり、リテラル型を失う。
const config = { theme: "dark", cols: 3 } as Config;

// する。検証し、かつリテラル型を保つ。
const config = { theme: "dark", cols: 3 } satisfies Config;
// config.theme は string ではなく "dark"（リテラル）
```

## 境界での検証

データが入ってくる場所で一度だけ検証する。内部では型を信頼する。**boundary-discipline**の原則スキルを参照。

- **ワイヤーフォーマット**（proto、JSON-RPC）：前方互換の変更で古いクライアントが壊れないよう、`ignoreUnknownFields`付きで解析する。
- **永続化したJSON：** バージョン付きのblobにし、解析をtry/catchで囲む。
- **呼び出しの奥深くで検証し直さない。**

## スキーマから導く型

`.proto`、OpenAPIの仕様、GraphQLのスキーマ、データベースのマイグレーションがすでに形を定めているなら、重複させずに生成された型から導く。

```ts
// しない。形が重複し、スキーマが変わるとずれる。
type CheckSummary = {
  totalCount: number;
  checks: { name: string; status: string }[];
};
function renderChecks(s: CheckSummary) {
  /* ... */
}

// する。生成されたスキーマの型から導く。
import type { ChecksMessage } from "<generated module>";
function renderChecks(s: Pick<ChecksMessage, "totalCount" | "checks">) {
  /* ... */
}
```

新しいinterfaceを書く前に、`Pick`、`Omit`、`Parameters`、`ReturnType`、`Awaited`、`typeof`を使う。

## オブジェクトの引数

```ts
// しない。2つの引数を入れ替えてもコンパイルが通る。
openFile(uri, {
  startLineNumber: 10,
  startColumn: 1,
  endLineNumber: 10,
  endColumn: 1,
});

// する。順序に依存せず、説明なしに分かる。
openFile({
  uri,
  selection: {
    startLineNumber: 10,
    startColumn: 1,
    endLineNumber: 10,
    endColumn: 1,
  },
});
```

ホットパスでは使わない。フレームごとの描画、トークナイザ、パーサ、割り当てのコストが問題になる密なループの中などである。
