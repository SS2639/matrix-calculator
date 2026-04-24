# matrixCalculater

行列計算を行う Flask アプリです。

## セットアップ

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## 開発サーバ起動

```bash
python app.py
```

## 本番起動（WSGI）

Linux では `gunicorn` を使って起動できます。

```bash
gunicorn -w 2 -b 0.0.0.0:8000 wsgi:application
```

Render の Web Service では次を推奨します。

- Build Command: `pip install -r requirements.txt`
- Start Command: `gunicorn -w 2 -b 0.0.0.0:$PORT wsgi:application`
- インスタンスタイプ: 単一インスタンスで開始（必要時にスケール）
- `/.runtime` は永続ディスクへ配置（保持したい場合）

## テスト実行

```bash
python -m unittest discover -s tests -q
```

## 公開運用向け環境変数

- `MATRIX_CALC_MAX_CONCURRENT_CALCS`: `/parse_tokens` の同時実行上限（既定 `2`）。
- `MATRIX_CALC_PROCESS_TIMEOUT_S`: 計算プロセスのタイムアウト秒（既定 `20`）。
- `MATRIX_CALC_QUEUE_TIMEOUT_S`: 子プロセス結果取得のタイムアウト秒（既定 `1`）。
- `MATRIX_CALC_RATE_LIMIT_WINDOW_S`: レートリミットの集計ウィンドウ秒（既定 `60`）。
- `MATRIX_CALC_RATE_LIMIT_MAX_REQUESTS`: 上記ウィンドウ内で許可する最大リクエスト数（既定 `30`）。
- `MATRIX_CALC_MAX_CONTENT_LENGTH_BYTES`: リクエストボディ上限（既定 `262144` バイト）。
- `MATRIX_CALC_MAX_TOKENS`: 式トークン上限（既定 `256`）。
- `MATRIX_CALC_MAX_TOKEN_CONTENT_CHARS`: トークン文字列長上限（既定 `128`）。
- `MATRIX_CALC_MAX_MATRIX_COUNT`: 行列数上限（既定 `32`）。
- `MATRIX_CALC_MAX_MATRIX_DIM`: 行列の行数/列数上限（既定 `20`）。
- `MATRIX_CALC_MAX_MATRIX_CELL_CHARS`: 行列セル文字列長上限（既定 `64`）。
- `MATRIX_CALC_RUNTIME_DIR`: ランタイムデータ保存先（既定 `.runtime`）。
- `FLASK_DEBUG`: 本番では必ず `0` に設定。

## 公開運用の注意

- `/_meta` は公開しない前提で常時 404 を返します。
- `/health` は `{"status":"ok"}` の最小応答のみ返します。
- レートリミットは `remote_addr` ベースのアプリ内メモリ方式です。マルチインスタンス構成ではインスタンス間でカウンタ共有されません。
- 本番ではリバースプロキシ（Nginx/Cloudflare 等）側の制限も併用してください。
- 本番レスポンスには `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` を付与します。
- ログは SQLite (`calc-log.sqlite3`) のみを使用します。
- ログ保持を継続する場合は、`MATRIX_CALC_RUNTIME_DIR` を永続ディスクに向けてください。
