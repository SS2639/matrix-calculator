import re
import sqlite3
from pathlib import Path


def mask_expression(tokens):
    if not isinstance(tokens, list):
        return ""

    parts = []
    for token in tokens:
        if not isinstance(token, dict):
            continue
        token_type = token.get("type")
        if token_type == "matrix":
            matrix_id = token.get("matrixId")
            parts.append(f"M{matrix_id}" if matrix_id else "M")
            continue

        content = token.get("content", "")
        content = content if isinstance(content, str) else str(content)

        if token_type in {"binary-op", "paren"}:
            if content in {"+", "-", "*", "/", "**", "(", ")"}:
                parts.append(content)
            else:
                parts.append("OP")
            continue

        if token_type in {"operation-func", "analysis-func"}:
            if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,31}", content):
                parts.append(content)
            else:
                parts.append("FUNC")
            continue

        if token_type == "scalar":
            parts.append("N")
            continue

        if token_type == "symbol":
            parts.append("SYM")
            continue

        parts.append("TOK")
    return "".join(parts)


def append_calc_log_entry(
    *,
    db_path,
    request_id,
    timestamp,
    expr_masked,
    elapsed_ms,
    ok,
    error_code,
    logger,
):
    entry = {
        "id": request_id,
        "timestamp": timestamp,
        "expr_masked": expr_masked,
        "elapsed_ms": elapsed_ms,
        "ok": ok,
        "error_code": error_code,
    }
    try:
        conn = sqlite3.connect(db_path)
        try:
            conn.execute(
                """
                INSERT INTO calc_logs (id, timestamp, expr_masked, elapsed_ms, ok, error_code)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    entry["id"],
                    entry["timestamp"],
                    entry["expr_masked"],
                    entry["elapsed_ms"],
                    1 if entry["ok"] else 0,
                    entry["error_code"],
                ),
            )
            conn.commit()
        finally:
            conn.close()
    except sqlite3.Error as e:
        logger.warning("failed to append calc log to sqlite: %s", e)


def init_calc_log_storage(*, db_path, logger):
    db_path = Path(db_path)
    try:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(db_path)
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS calc_logs (
                    id TEXT PRIMARY KEY,
                    timestamp TEXT NOT NULL,
                    expr_masked TEXT NOT NULL,
                    elapsed_ms INTEGER NOT NULL,
                    ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
                    error_code TEXT
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_calc_logs_timestamp ON calc_logs(timestamp)"
            )
            conn.commit()
        finally:
            conn.close()
    except sqlite3.Error as e:
        logger.warning("failed to initialize calc log sqlite storage: %s", e)
