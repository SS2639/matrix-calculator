from flask import Flask, render_template, request, jsonify
from expr_calc import MatrixCalculator
from calc_log_store import mask_expression, append_calc_log_entry, init_calc_log_storage
from concurrent.futures import ProcessPoolExecutor, TimeoutError as FutureTimeoutError, CancelledError
from threading import BoundedSemaphore, Lock
from werkzeug.exceptions import HTTPException
from werkzeug.exceptions import RequestEntityTooLarge
import os
import json
import time
import uuid
import socket
from datetime import datetime
from pathlib import Path

app = Flask(__name__)
MAX_CONTENT_LENGTH = max(1024, int(os.getenv("MATRIX_CALC_MAX_CONTENT_LENGTH_BYTES", "262144")))
MAX_TOKENS = max(1, int(os.getenv("MATRIX_CALC_MAX_TOKENS", "256")))
MAX_TOKEN_CONTENT_CHARS = max(1, int(os.getenv("MATRIX_CALC_MAX_TOKEN_CONTENT_CHARS", "128")))
MAX_MATRIX_COUNT = max(1, int(os.getenv("MATRIX_CALC_MAX_MATRIX_COUNT", "32")))
MAX_MATRIX_DIM = max(1, int(os.getenv("MATRIX_CALC_MAX_MATRIX_DIM", "20")))
MAX_MATRIX_CELL_CHARS = max(1, int(os.getenv("MATRIX_CALC_MAX_MATRIX_CELL_CHARS", "64")))
PROCESS_TIMEOUT_S = float(os.getenv("MATRIX_CALC_PROCESS_TIMEOUT_S", "60"))
MAX_CONCURRENT_CALCS = max(1, int(os.getenv("MATRIX_CALC_MAX_CONCURRENT_CALCS", "2")))
RATE_LIMIT_WINDOW_S = max(1, int(os.getenv("MATRIX_CALC_RATE_LIMIT_WINDOW_S", "60")))
RATE_LIMIT_MAX_REQUESTS = max(1, int(os.getenv("MATRIX_CALC_RATE_LIMIT_MAX_REQUESTS", "30")))
CALC_CONCURRENCY_GATE = BoundedSemaphore(MAX_CONCURRENT_CALCS)
RATE_LIMIT_STATE = {}
RATE_LIMIT_LOCK = Lock()
ACTIVE_CALCS = {}
ACTIVE_CALC_CLIENT_MAP = {}
ACTIVE_CALCS_LOCK = Lock()
CANCELLED_CLIENT_REQUESTS = set()
CANCELLED_CLIENT_REQUESTS_LOCK = Lock()
CALC_EXECUTOR = None
CALC_EXECUTOR_LOCK = Lock()
PROJECT_ROOT = Path(__file__).resolve().parent


def _resolve_runtime_dir():
    configured_runtime = os.getenv("MATRIX_CALC_RUNTIME_DIR")
    allow_external_runtime = os.getenv("MATRIX_CALC_ALLOW_EXTERNAL_RUNTIME_DIR", "0") == "1"
    candidate = Path(configured_runtime).resolve() if configured_runtime else (PROJECT_ROOT / ".runtime").resolve()
    if allow_external_runtime:
        return candidate
    if candidate == PROJECT_ROOT or candidate.is_relative_to(PROJECT_ROOT):
        return candidate
    raise RuntimeError(
        "MATRIX_CALC_RUNTIME_DIR must be under project root unless "
        "MATRIX_CALC_ALLOW_EXTERNAL_RUNTIME_DIR=1 is explicitly set"
    )


RUNTIME_DIR = _resolve_runtime_dir()
CALC_DB_PATH = RUNTIME_DIR / "logs" / "calc-log.sqlite3"
APP_INSTANCE_ID = os.getenv("MATRIX_CALC_APP_INSTANCE_ID", f"{socket.gethostname()}:{PROJECT_ROOT.name}")
APP_INSTANCE_MARKER_PATH = RUNTIME_DIR / "app-instance.json"
RUNTIME_INIT_LOCK = Lock()
RUNTIME_INIT_DONE = False
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH
# 開発時に古い静的ファイルが残らないよう、既定のキャッシュ寿命を無効化する。
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0


def _is_pid_alive(pid):
    if not isinstance(pid, int) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _load_instance_marker():
    if not APP_INSTANCE_MARKER_PATH.exists():
        return None
    try:
        with open(APP_INSTANCE_MARKER_PATH, "r", encoding="utf-8") as f:
            marker = json.load(f)
        return marker if isinstance(marker, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def ensure_single_instance():
    marker = _load_instance_marker()
    if not marker:
        return

    existing_project_root = str(marker.get("project_root", ""))
    if existing_project_root != str(PROJECT_ROOT):
        return

    try:
        existing_pid = int(marker.get("pid"))
    except (TypeError, ValueError):
        return

    if existing_pid == os.getpid():
        return
    if not _is_pid_alive(existing_pid):
        return

    raise RuntimeError(
        f"another matrixCalculater instance is running "
        f"(pid={existing_pid}, marker={APP_INSTANCE_MARKER_PATH})"
    )


def write_instance_marker():
    marker = {
        "app_file": str(Path(__file__).resolve()),
        "project_root": str(PROJECT_ROOT),
        "runtime_dir": str(RUNTIME_DIR),
        "calc_db_path": str(CALC_DB_PATH),
        "instance_id": APP_INSTANCE_ID,
        "pid": os.getpid(),
        "cwd": os.getcwd(),
        "started_at": datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    try:
        RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
        with open(APP_INSTANCE_MARKER_PATH, "w", encoding="utf-8") as f:
            json.dump(marker, f, ensure_ascii=False, indent=2)
    except OSError as e:
        app.logger.warning("failed to write app instance marker: %s", e)


def error_response(message, code, status):
    if status >= 500:
        app.logger.warning("server error response: status=%s code=%s message=%s", status, code, message)
    return {
        "type": "error",
        "code": code,
        "message": message,
        "status": status,
    }, status


def _client_scope_key():
    remote_addr = request.remote_addr or "unknown"
    user_agent = str(request.headers.get("User-Agent", ""))[:160]
    return remote_addr, user_agent


def _validate_input_limits(tokens, matrices):
    if len(tokens) > MAX_TOKENS:
        return error_response(
            f"トークン数が上限を超えています（最大 {MAX_TOKENS}）",
            "TOKENS_LIMIT_EXCEEDED",
            422,
        )
    if len(matrices) > MAX_MATRIX_COUNT:
        return error_response(
            f"行列の数が上限を超えています（最大 {MAX_MATRIX_COUNT}）",
            "MATRICES_LIMIT_EXCEEDED",
            422,
        )

    for index, token in enumerate(tokens, start=1):
        if not isinstance(token, dict):
            return error_response(
                f"{index}番目のトークン形式が不正です",
                "INVALID_TOKEN_FORMAT",
                400,
            )
        content = token.get("content")
        if content is None:
            continue
        if len(str(content)) > MAX_TOKEN_CONTENT_CHARS:
            return error_response(
                f"{index}番目のトークン文字列が長すぎます（最大 {MAX_TOKEN_CONTENT_CHARS} 文字）",
                "TOKEN_CONTENT_TOO_LONG",
                422,
            )

    for matrix_id, matrix in matrices.items():
        if not isinstance(matrix, dict):
            return error_response(
                f"行列 {matrix_id} の形式が不正です",
                "INVALID_MATRIX_FORMAT",
                400,
            )
        values = matrix.get("values")
        if not isinstance(values, list) or not values:
            return error_response(
                f"行列 {matrix_id} の values が不正です",
                "INVALID_MATRIX_VALUES",
                400,
            )
        if len(values) > MAX_MATRIX_DIM:
            return error_response(
                f"行列 {matrix_id} の行数が上限を超えています（最大 {MAX_MATRIX_DIM}）",
                "MATRIX_ROW_LIMIT_EXCEEDED",
                422,
            )

        expected_cols = None
        for row_idx, row in enumerate(values, start=1):
            if not isinstance(row, list) or not row:
                return error_response(
                    f"行列 {matrix_id} の{row_idx}行目が不正です",
                    "INVALID_MATRIX_ROW",
                    400,
                )
            if len(row) > MAX_MATRIX_DIM:
                return error_response(
                    f"行列 {matrix_id} の列数が上限を超えています（最大 {MAX_MATRIX_DIM}）",
                    "MATRIX_COL_LIMIT_EXCEEDED",
                    422,
                )
            if expected_cols is None:
                expected_cols = len(row)
            elif len(row) != expected_cols:
                return error_response(
                    f"行列 {matrix_id} は各行の列数を揃えてください",
                    "MATRIX_COL_COUNT_MISMATCH",
                    400,
                )

            for col_idx, cell in enumerate(row, start=1):
                if len(str(cell)) > MAX_MATRIX_CELL_CHARS:
                    return error_response(
                        f"行列 {matrix_id} の{row_idx}行{col_idx}列が長すぎます（最大 {MAX_MATRIX_CELL_CHARS} 文字）",
                        "MATRIX_CELL_TOO_LONG",
                        422,
                    )
    return None


def initialize_runtime():
    global RUNTIME_INIT_DONE
    with RUNTIME_INIT_LOCK:
        if RUNTIME_INIT_DONE:
            return
        init_calc_log_storage(
            db_path=CALC_DB_PATH,
            logger=app.logger,
        )
        RUNTIME_INIT_DONE = True


def apply_runtime_mode_settings(debug):
    # 開発時のみテンプレート自動リロードを有効化する。
    app.config["TEMPLATES_AUTO_RELOAD"] = bool(debug)
    app.jinja_env.auto_reload = bool(debug)


def calc_worker(tokens, matrices):
    calc = MatrixCalculator(tokens, matrices)
    return calc.evaluate()


def _create_calc_executor():
    return ProcessPoolExecutor(max_workers=MAX_CONCURRENT_CALCS)


def _get_calc_executor():
    global CALC_EXECUTOR
    with CALC_EXECUTOR_LOCK:
        if CALC_EXECUTOR is None:
            CALC_EXECUTOR = _create_calc_executor()
        return CALC_EXECUTOR


def _reset_calc_executor():
    global CALC_EXECUTOR
    with CALC_EXECUTOR_LOCK:
        old_executor = CALC_EXECUTOR
        CALC_EXECUTOR = _create_calc_executor()
    if old_executor is not None:
        old_executor.shutdown(wait=False, cancel_futures=True)


def _is_lightweight_request(tokens, matrices):
    if not isinstance(tokens, list) or not isinstance(matrices, dict):
        return False
    if matrices:
        return False
    if len(tokens) != 1:
        return False
    token = tokens[0] if tokens else {}
    return isinstance(token, dict) and token.get("type") == "scalar"


def _mark_cancel_requested(client_key, client_request_id):
    if not client_request_id:
        return
    with CANCELLED_CLIENT_REQUESTS_LOCK:
        CANCELLED_CLIENT_REQUESTS.add((client_key, client_request_id))


def _is_cancel_requested(client_key, client_request_id):
    if not client_request_id:
        return False
    with CANCELLED_CLIENT_REQUESTS_LOCK:
        return (client_key, client_request_id) in CANCELLED_CLIENT_REQUESTS


def _clear_cancel_requested(client_key, client_request_id):
    if not client_request_id:
        return
    with CANCELLED_CLIENT_REQUESTS_LOCK:
        CANCELLED_CLIENT_REQUESTS.discard((client_key, client_request_id))


def _is_rate_limited(client_key):
    now = time.time()
    with RATE_LIMIT_LOCK:
        stale_threshold = max(RATE_LIMIT_WINDOW_S * 2, RATE_LIMIT_WINDOW_S + 1)
        stale_keys = [
            key for key, value in RATE_LIMIT_STATE.items()
            if now - value["window_started_at"] >= stale_threshold
        ]
        for key in stale_keys:
            RATE_LIMIT_STATE.pop(key, None)

        state = RATE_LIMIT_STATE.get(client_key)
        if not state:
            RATE_LIMIT_STATE[client_key] = {"window_started_at": now, "count": 1}
            return False, 0

        elapsed = now - state["window_started_at"]
        if elapsed >= RATE_LIMIT_WINDOW_S:
            state["window_started_at"] = now
            state["count"] = 1
            return False, 0

        if state["count"] >= RATE_LIMIT_MAX_REQUESTS:
            retry_after = max(1, int(RATE_LIMIT_WINDOW_S - elapsed))
            return True, retry_after

        state["count"] += 1
        return False, 0


def _is_mobile_user_agent(user_agent):
    ua = str(user_agent or "").lower()
    mobile_markers = (
        "android",
        "iphone",
        "ipad",
        "ipod",
        "mobile",
        "windows phone",
    )
    return any(marker in ua for marker in mobile_markers)


@app.route('/')
def home():
    query_ui = str(request.args.get("ui", "")).strip().lower()
    query_forced = query_ui in {"desktop", "mobile"}
    if query_forced:
        ui_mode = query_ui
    else:
        user_agent = request.headers.get("User-Agent", "")
        ui_mode = "mobile" if _is_mobile_user_agent(user_agent) else "desktop"
    return render_template(
        f"ui/{ui_mode}/index.html",
        ui_mode=ui_mode,
    )


@app.after_request
def apply_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    if response.content_type and response.content_type.startswith("text/html"):
        # ブラウザが古い HTML を再利用し続けるのを防ぐ。
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


@app.errorhandler(RequestEntityTooLarge)
def handle_request_too_large(_error):
    payload, status = error_response(
        "リクエストサイズが大きすぎます",
        "PAYLOAD_TOO_LARGE",
        413,
    )
    return jsonify(payload), status


@app.errorhandler(Exception)
def handle_unexpected_error(error):
    if isinstance(error, HTTPException):
        return error
    app.logger.exception("unexpected server error: %s", error)
    payload, status = error_response(
        "サーバー内部エラーが発生しました。時間をおいて再試行してください",
        "INTERNAL_SERVER_ERROR",
        500,
    )
    return jsonify(payload), status


@app.get("/_meta")
def app_meta():
    payload, status = error_response("not found", "NOT_FOUND", 404)
    return jsonify(payload), status


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.post("/cancel_calc")
def cancel_calc():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        payload, status = error_response("リクエストJSONが不正です", "INVALID_JSON", 400)
        return jsonify(payload), status

    client_request_id = str(data.get("requestId", "")).strip()[:128]
    if not client_request_id:
        payload, status = error_response("requestId が必要です", "MISSING_REQUEST_ID", 400)
        return jsonify(payload), status

    client_key = _client_scope_key()
    with ACTIVE_CALCS_LOCK:
        active_calc_id = ACTIVE_CALC_CLIENT_MAP.get((client_key, client_request_id))
        future = ACTIVE_CALCS.get(active_calc_id) if active_calc_id else None

    if future is None:
        return jsonify({"status": "ok", "cancelled": False, "requestId": client_request_id})

    _mark_cancel_requested(client_key, client_request_id)
    if future.cancel():
        return jsonify({"status": "ok", "cancelled": True, "requestId": client_request_id})
    if not future.done():
        # 実行中の Future は cancel() できないため、executor を再作成して中断を試みる。
        _reset_calc_executor()
        return jsonify({"status": "ok", "cancelled": True, "requestId": client_request_id})
    return jsonify({"status": "ok", "cancelled": False, "requestId": client_request_id})

@app.route("/parse_tokens", methods=["POST"])
def parse_tokens():
    initialize_runtime()
    request_id = str(uuid.uuid4())
    client_request_id = None
    request_started_at = time.perf_counter()
    validation_finished_at = request_started_at
    execution_started_at = request_started_at
    execution_finished_at = request_started_at
    run_mode = "uninitialized"
    data = request.get_json(silent=True)
    tokens = []

    def finalize_response(payload, status=200, extra_headers=None):
        response_started_at = time.perf_counter()
        elapsed_ms = int((response_started_at - request_started_at) * 1000)
        validation_ms = int((validation_finished_at - request_started_at) * 1000)
        execution_wait_ms = int((execution_started_at - validation_finished_at) * 1000)
        execution_ms = int((execution_finished_at - execution_started_at) * 1000)
        is_error = isinstance(payload, dict) and payload.get("type") == "error"
        append_calc_log_entry(
            db_path=CALC_DB_PATH,
            request_id=request_id,
            timestamp=datetime.now().astimezone().isoformat(timespec="milliseconds"),
            expr_masked=mask_expression(tokens),
            elapsed_ms=elapsed_ms,
            ok=not is_error and status < 400,
            error_code=payload.get("code") if is_error else None,
            logger=app.logger,
        )
        log_finished_at = time.perf_counter()
        logging_ms = int((log_finished_at - response_started_at) * 1000)
        total_ms = int((log_finished_at - request_started_at) * 1000)
        app.logger.info(
            "parse_tokens timing request_id=%s mode=%s total_ms=%s validation_ms=%s queue_wait_ms=%s execution_ms=%s log_ms=%s status=%s",
            request_id,
            run_mode,
            total_ms,
            validation_ms,
            execution_wait_ms,
            execution_ms,
            logging_ms,
            status,
        )
        response = jsonify(payload)
        response.status_code = status
        if isinstance(extra_headers, dict):
            for key, value in extra_headers.items():
                response.headers[key] = value
        return response

    if not isinstance(data, dict):
        payload, status = error_response("リクエストJSONが不正です", "INVALID_JSON", 400)
        return finalize_response(payload, status)
    client_request_id_candidate = str(data.get("requestId", "")).strip()
    if client_request_id_candidate:
        client_request_id = client_request_id_candidate[:128]

    tokens = data.get("tokens", [])
    matrices = data.get("matrices", {})
    if not isinstance(tokens, list) or not isinstance(matrices, dict):
        payload, status = error_response(
            "tokens は配列、matrices はオブジェクトで指定してください",
            "INVALID_PAYLOAD_TYPE",
            400
        )
        return finalize_response(payload, status)
    if not tokens:
        payload, status = error_response(
            "式が空です。行列または数値を入力してください",
            "EMPTY_EXPRESSION",
            400
        )
        return finalize_response(payload, status)
    limit_error = _validate_input_limits(tokens, matrices)
    if limit_error:
        payload, status = limit_error
        return finalize_response(payload, status)

    for i, token in enumerate(tokens, start=1):
        if "type" not in token or "content" not in token:
            payload, status = error_response(
                f"{i}番目のトークンに type/content がありません",
                "INVALID_TOKEN_FIELDS",
                400
            )
            return finalize_response(payload, status)
        if token.get("type") == "matrix" and not token.get("matrixId"):
            payload, status = error_response(
                f"{i}番目の行列トークンに matrixId がありません",
                "MISSING_MATRIX_ID",
                400
            )
            return finalize_response(payload, status)

    # 未検証の X-Forwarded-For は信頼せず、WSGI 層が確定した remote_addr を利用する。
    client_key = _client_scope_key()[0]
    limited, retry_after = _is_rate_limited(client_key)
    if limited:
        payload, status = error_response(
            "リクエストが多すぎます。しばらく待ってから再試行してください",
            "RATE_LIMIT_EXCEEDED",
            429
        )
        return finalize_response(payload, status, {"Retry-After": str(retry_after)})

    acquired = CALC_CONCURRENCY_GATE.acquire(blocking=False)
    if not acquired:
        payload, status = error_response(
            "サーバーが混み合っています。少し待ってから再試行してください",
            "SERVER_BUSY",
            429
        )
        return finalize_response(payload, status)

    validation_finished_at = time.perf_counter()
    future = None
    try:
        execution_started_at = time.perf_counter()
        client_key = _client_scope_key()
        if _is_lightweight_request(tokens, matrices):
            run_mode = "inline"
            result = calc_worker(tokens, matrices)
        else:
            run_mode = "executor"
            future = _get_calc_executor().submit(calc_worker, tokens, matrices)
            with ACTIVE_CALCS_LOCK:
                ACTIVE_CALCS[request_id] = future
                if client_request_id:
                    ACTIVE_CALC_CLIENT_MAP[(client_key, client_request_id)] = request_id
            try:
                result = future.result(timeout=PROCESS_TIMEOUT_S)
            except CancelledError:
                payload, status = error_response(
                    "計算を停止しました",
                    "REQUEST_ABORTED",
                    499
                )
                return finalize_response(payload, status)
            except FutureTimeoutError:
                future.cancel()
                _reset_calc_executor()
                payload, status = error_response(
                    "サーバー応答がタイムアウトしました。式を簡略化して再実行してください",
                    "CALCULATION_TIMEOUT",
                    504
                )
                return finalize_response(payload, status)
            except Exception:
                if _is_cancel_requested(client_key, client_request_id):
                    payload, status = error_response(
                        "計算を停止しました",
                        "REQUEST_ABORTED",
                        499
                    )
                    return finalize_response(payload, status)
                payload, status = error_response(
                    "計算結果を取得できませんでした",
                    "RESULT_UNAVAILABLE",
                    500
                )
                return finalize_response(payload, status)
            if _is_cancel_requested(client_key, client_request_id):
                payload, status = error_response(
                    "計算を停止しました",
                    "REQUEST_ABORTED",
                    499
                )
                return finalize_response(payload, status)
        execution_finished_at = time.perf_counter()

        if isinstance(result, dict) and result.get("type") == "error":
            app.logger.info(
                "calc error response: code=%s message=%s",
                result.get("code", "UNKNOWN"),
                result.get("message", "")
            )
        return finalize_response(result)
    finally:
        client_key = _client_scope_key()
        with ACTIVE_CALCS_LOCK:
            ACTIVE_CALCS.pop(request_id, None)
            if client_request_id:
                ACTIVE_CALC_CLIENT_MAP.pop((client_key, client_request_id), None)
                _clear_cancel_requested(client_key, client_request_id)
        if acquired:
            CALC_CONCURRENCY_GATE.release()

if __name__ == "__main__":
    debug = os.getenv("FLASK_DEBUG", "0") == "1"
    apply_runtime_mode_settings(debug)
    # Instance marker checks are development safeguards for local `python app.py`.
    # Skip marker guard in the reloader parent process to avoid false positives.
    is_reloader_parent = debug and os.getenv("WERKZEUG_RUN_MAIN") != "true"
    if not is_reloader_parent:
        ensure_single_instance()
        initialize_runtime()
        write_instance_marker()
    app.logger.info(
        "matrix app start: file=%s project_root=%s runtime_dir=%s db_path=%s instance_id=%s",
        Path(__file__).resolve(),
        PROJECT_ROOT,
        RUNTIME_DIR,
        CALC_DB_PATH,
        APP_INSTANCE_ID,
    )
    app.run(debug=debug)
