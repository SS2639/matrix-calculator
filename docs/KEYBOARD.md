# 式バー・キーボード入力仕様

行列の**セル（`INPUT`）にフォーカスがあるとき**は、セルへの文字入力が優先され、式バー用のショートカットは動きません（`core/tokenManager.js` / `ui/desktop/main.js` で除外）。

挿入位置のカーソル（`.cursor`）は**常に表示**されます。`tokenManager` のキー処理は、`document.activeElement` が式バー（`.expression-bar`）のときだけ有効です。式バー内をクリックすると `tabindex="0"` によりフォーカスが当たります。`=` による計算（`ui/desktop/main.js`）は式バー未フォーカスでも動作します。

## 1. データの単一ソース（記号 `a,b,c,…`）

| ファイル | 役割 |
|----------|------|
| [`static/data/allowed_symbols.json`](../static/data/allowed_symbols.json) | **正本**。許可する SymPy 記号（1文字）の JSON 配列。 |
| [`expr_calc.py`](../expr_calc.py) | 起動時に上記 JSON を読み、`ALLOWED_SYMBOLS` を構築。 |
| [`static/js/core/allowedSymbols.gen.js`](../static/js/core/allowedSymbols.gen.js) | **生成物**（手編集禁止）。フロントの `Set` 用。 |

記号集合を変えたら:

1. `allowed_symbols.json` を編集する。
2. リポジトリルートで `python tools/sync_allowed_symbols_from_json.py` を実行する。
3. 生成された `allowedSymbols.gen.js` をコミットする。

## 2. フロントのモジュール分担

| モジュール | 内容 |
|------------|------|
| [`core/scalarValidate.js`](../static/js/core/scalarValidate.js) | 数値リテラル検証、下書きへの1文字追記可否、記号は `ALLOWED_SYMBOL_CHARS` を参照。 |
| [`core/tokenManager.js`](../static/js/core/tokenManager.js) | `keydown` の**評価順**、トークン挿入、数値下書き、`*`→`**` マージ。 |
| [`ui/desktop/main.js`](../static/js/ui/desktop/main.js) | 画面初期化、`=` 計算キー配線、オペレータUI配線。 |
| [`core/calcRunner.js`](../static/js/core/calcRunner.js) | 計算実行本体（送信前検証、API呼び出し、エラーセルハイライト）。 |
| [`core/help.js`](../static/js/core/help.js) | ヘルプオーバーレイ制御（開閉、`Esc`、背景クリック、フォーカストラップ）。 |
| [`core/displayResult.js`](../static/js/core/displayResult.js) | 結果ログ表示。エラー時は `message` と `code` を併記。 |

## 3. `keydown` の処理順（`tokenManager.initKeyControls`）

0. **`document.activeElement` が式バーでない** → 何もしない（式バー用キーは受け付けない）。
1. `INPUT` / `TEXTAREA` 上 → 何もしない（式バー専用ショートカットを奪わない）。
2. `=` → 無視（`main.js` が計算を担当）。
3. `Ctrl` / `Meta` / `Alt` 併用 → 無視。
4. 矢印（上下左右）→ カーソル移動（移動前に数値下書きを `commit`、失敗時は `onInputError`）。
5. `Backspace` / `Delete` / `Escape` → 下書き削除 or トークン削除 or 全消去。
6. **`Enter`** → 数値下書き（`literalDraft`）があるときだけ **確定**（`commitLiteralDraft`）。空スロット `""` は閉じる。計算はしない（計算は `=` を `main.js` が処理）。
7. `(` `)` → 括弧トークン（先に下書き確定）。
8. **1文字**かつ `allowed_symbols` に含まれる（大文字は小文字化）→ **記号トークン** `symbol`（先に下書き確定）。
9. 数値下書きに `appendLiteralKey` 可能なキー → 下書き更新（`0-9` `.` `e` `E`、指数直後の `+` `-` のみ）。
10. テンキー正規化後の `+` `-` → 演算子トークン `binary-op`（先に下書き確定）。
11. `*` `/` → 演算子（`*` 直後の `*` は `**` にマージ）。

## 4. 数値リテラルと演算子の役割分担

- **数値下書き**に入るのは主に数字・小数点・指数 `e`/`E`・指数部の `+`/`-` のみ（先頭の単項 `+`/`-` は**入れない**。負数は `-` トークン＋数値トークン）。
- **`val` で空スロット（`literalDraft === ""`）を開いた直後** → 先頭キーは `0`–`9` と `.` のみ（`+`/`-` は受け付けず、押すとスロットを閉じる）。
- **`+` `-` `*` `/` `**`** は常に演算子トークン（`*` 連打で `**`）。

## 5. 計算キー（`ui/desktop/main.js`）と下書き確定（`tokenManager`）

- **`=`** → `runCalc`（行列セル・`TEXTAREA` 以外、かつヘルプオーバーレイ表示中でないこと）。
- **`Enter`** → 式バーにフォーカスがあり **数値下書き中**のときだけ確定（§3 手順 6）。下書きが無いときは計算しない。

## 6. ヘルプオーバーレイ操作（`core/help.js`）

- `?` ボタンで開く。閉じるボタンで閉じる。
- **`Esc`** で閉じる。
- オーバーレイ背景クリックで閉じる。
- 表示中はフォーカスをオーバーレイ内に閉じ込める（`Tab` / `Shift+Tab`）。
- 閉じたときは、開く前にフォーカスされていた要素へ戻す。

## 7. エラー表示とエラーコード

- フロント表示は `core/displayResult.js` が担当し、`message` に加えて `code` がある場合は `[...]` で併記する。
- 例: `0で割ることはできません [DIVISION_BY_ZERO]`
- `core/calcRunner.js` は `INVALID_MATRIX_CELL` など `matrixId/row/col` を含むエラーで対象セルをハイライトする。
- API の HTTP エラー時は `core/api.js` が本文JSONの `code/message` を優先して返す。

## 8. 環境差・未対応

- 配列や IME により `e.key` が想定と異なる場合、記号・演算子が効かないことがあります。テンキーは `e.code`（`NumpadAdd` 等）で補正しています。

## 9. サーバー側タイムアウト設定（参考）

- `MATRIX_CALC_PROCESS_TIMEOUT_S`（既定: `20`）  
  ワーカープロセス `join` のタイムアウト秒。
- `MATRIX_CALC_QUEUE_TIMEOUT_S`（既定: `1`）  
  計算結果キュー取得のタイムアウト秒。

## 10. ユーザー向け短い説明

アプリ内ヘルプ: [`static/help.html`](../static/help.html)（概要のみ。本ドキュメントが開発者向けの完全版）。
