import unittest
from unittest.mock import patch
from pathlib import Path
from concurrent.futures import TimeoutError as FutureTimeoutError

import app as app_module
from app import app
from expr_calc import MatrixCalculator


class MatrixCalculatorAppTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        app_module.RATE_LIMIT_STATE.clear()

    def test_home_initial_tab_is_arithmetic(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        self.assertIn('data-tab="arithmetic">四則演算</button>', html)
        self.assertIn('data-panel="arithmetic"', html)

    def test_meta_is_disabled_by_default(self):
        response = self.client.get("/_meta")
        self.assertEqual(response.status_code, 404)
        data = response.get_json()
        self.assertEqual(data["type"], "error")
        self.assertEqual(data["code"], "NOT_FOUND")

    def test_meta_is_not_exposed_even_if_flag_like_value_is_set(self):
        with patch.dict("os.environ", {"MATRIX_CALC_ENABLE_META": "1"}):
            response = self.client.get("/_meta")
        self.assertEqual(response.status_code, 404)
        data = response.get_json()
        self.assertEqual(data["code"], "NOT_FOUND")

    def test_health_returns_minimal_payload(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data, {"status": "ok"})

    def test_division_by_zero_returns_structured_error(self):
        payload = {
            "tokens": [
                {"type": "scalar", "content": "2/det("},
                {"type": "matrix", "content": "M1", "matrixId": "1"},
                {"type": "paren", "content": ")"},
            ],
            "matrices": {
                "1": {
                    "values": [["1", "2"], ["2", "4"]]
                }
            }
        }
        response = self.client.post("/parse_tokens", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["type"], "error")
        self.assertEqual(data["code"], "DIVISION_BY_ZERO")

    def test_invalid_matrix_cell_returns_position(self):
        payload = {
            "tokens": [
                {"type": "operation-func", "content": "det("},
                {"type": "matrix", "content": "M1", "matrixId": "1"},
                {"type": "paren", "content": ")"},
            ],
            "matrices": {
                "1": {
                    "values": [["1", "abc+*"], ["2", "4"]]
                }
            }
        }
        response = self.client.post("/parse_tokens", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["type"], "error")
        self.assertEqual(data["code"], "INVALID_MATRIX_CELL")
        self.assertEqual(data["matrixId"], "1")
        self.assertEqual(data["row"], 1)
        self.assertEqual(data["col"], 2)

    def test_invalid_payload_type_returns_400_and_code(self):
        payload = {"tokens": "not-array", "matrices": {}}
        response = self.client.post("/parse_tokens", json=payload)
        self.assertEqual(response.status_code, 400)
        data = response.get_json()
        self.assertEqual(data["type"], "error")
        self.assertEqual(data["code"], "INVALID_PAYLOAD_TYPE")

    def test_invalid_json_returns_400_and_code(self):
        response = self.client.post(
            "/parse_tokens",
            data="not-json",
            content_type="application/json"
        )
        self.assertEqual(response.status_code, 400)
        data = response.get_json()
        self.assertEqual(data["type"], "error")
        self.assertEqual(data["code"], "INVALID_JSON")

    def test_missing_matrix_id_returns_400_and_code(self):
        payload = {
            "tokens": [{"type": "matrix", "content": "M1"}],
            "matrices": {}
        }
        response = self.client.post("/parse_tokens", json=payload)
        self.assertEqual(response.status_code, 400)
        data = response.get_json()
        self.assertEqual(data["type"], "error")
        self.assertEqual(data["code"], "MISSING_MATRIX_ID")

    def test_invalid_token_item_type_returns_400_and_code(self):
        payload = {
            "tokens": ["not-dict-token"],
            "matrices": {}
        }
        response = self.client.post("/parse_tokens", json=payload)
        self.assertEqual(response.status_code, 400)
        data = response.get_json()
        self.assertEqual(data["type"], "error")
        self.assertEqual(data["code"], "INVALID_TOKEN_FORMAT")

    def test_runtime_dir_rejects_external_path_by_default(self):
        external_runtime = Path(app_module.PROJECT_ROOT.anchor) / "tmp_matrix_runtime"
        with patch.dict(
            "os.environ",
            {
                "MATRIX_CALC_RUNTIME_DIR": str(external_runtime),
                "MATRIX_CALC_ALLOW_EXTERNAL_RUNTIME_DIR": "0",
            },
            clear=False,
        ):
            with self.assertRaises(RuntimeError):
                app_module._resolve_runtime_dir()

    def test_runtime_dir_allows_external_path_with_explicit_opt_in(self):
        external_runtime = Path(app_module.PROJECT_ROOT.anchor) / "tmp_matrix_runtime"
        with patch.dict(
            "os.environ",
            {
                "MATRIX_CALC_RUNTIME_DIR": str(external_runtime),
                "MATRIX_CALC_ALLOW_EXTERNAL_RUNTIME_DIR": "1",
            },
            clear=False,
        ):
            resolved = app_module._resolve_runtime_dir()
        self.assertEqual(resolved, external_runtime.resolve())

    def test_value_error_message_is_sanitized(self):
        calc = MatrixCalculator(tokens=[], matrices={})
        with patch.object(calc, "tokens_to_expr", return_value="1"):
            with patch.object(calc, "check_syntax", return_value=None):
                with patch.object(calc, "build_env", return_value={}):
                    with patch.object(calc, "_process_result", side_effect=ValueError("secret detail")):
                        result = calc.evaluate()
        self.assertEqual(result["type"], "error")
        self.assertEqual(result["code"], "CALC_VALUE_ERROR")
        self.assertEqual(result["message"], "入力値に問題があります")
        self.assertNotIn("secret detail", result["message"])

    def test_calculation_timeout_returns_504_and_code(self):
        class DummyFuture:
            def result(self, timeout=None):
                raise FutureTimeoutError()

            def cancel(self):
                return True

        class DummyExecutor:
            def submit(self, *args, **kwargs):
                return DummyFuture()

        payload = {
            "tokens": [{"type": "matrix", "content": "M1", "matrixId": "1"}],
            "matrices": {"1": {"values": [["1"]]}}
        }
        with patch("app._get_calc_executor", return_value=DummyExecutor()):
            response = self.client.post("/parse_tokens", json=payload)
        self.assertEqual(response.status_code, 504)
        data = response.get_json()
        self.assertEqual(data["type"], "error")
        self.assertEqual(data["code"], "CALCULATION_TIMEOUT")

    def test_concurrency_limit_returns_429_and_code(self):
        payload = {
            "tokens": [{"type": "scalar", "content": "1"}],
            "matrices": {}
        }
        with patch.object(app_module.CALC_CONCURRENCY_GATE, "acquire", return_value=False):
            response = self.client.post("/parse_tokens", json=payload)
        self.assertEqual(response.status_code, 429)
        data = response.get_json()
        self.assertEqual(data["type"], "error")
        self.assertEqual(data["code"], "SERVER_BUSY")

    def test_cancel_calc_running_future_triggers_executor_reset(self):
        class RunningFuture:
            def cancel(self):
                return False

            def done(self):
                return False

        future = RunningFuture()
        client_key = ("127.0.0.1", "")
        with patch("app._client_scope_key", return_value=client_key):
            with app_module.ACTIVE_CALCS_LOCK:
                app_module.ACTIVE_CALCS["req-1"] = future
                app_module.ACTIVE_CALC_CLIENT_MAP[(client_key, "cid-1")] = "req-1"
            with patch("app._reset_calc_executor") as reset_mock:
                response = self.client.post("/cancel_calc", json={"requestId": "cid-1"})
            with app_module.ACTIVE_CALCS_LOCK:
                app_module.ACTIVE_CALCS.clear()
                app_module.ACTIVE_CALC_CLIENT_MAP.clear()
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data["cancelled"])
        reset_mock.assert_called_once()

    def test_rate_limit_window_behavior(self):
        with patch("app.RATE_LIMIT_WINDOW_S", 10), patch("app.RATE_LIMIT_MAX_REQUESTS", 2):
            with patch("app.time.time", return_value=100.0):
                limited, retry = app_module._is_rate_limited("1.2.3.4")
                self.assertFalse(limited)
                self.assertEqual(retry, 0)

                limited, retry = app_module._is_rate_limited("1.2.3.4")
                self.assertFalse(limited)
                self.assertEqual(retry, 0)

                limited, retry = app_module._is_rate_limited("1.2.3.4")
                self.assertTrue(limited)
                self.assertEqual(retry, 10)

            with patch("app.time.time", return_value=111.0):
                limited, retry = app_module._is_rate_limited("1.2.3.4")
                self.assertFalse(limited)
                self.assertEqual(retry, 0)

    def test_rate_limit_state_cleanup(self):
        app_module.RATE_LIMIT_STATE["old"] = {"window_started_at": 1.0, "count": 1}
        with patch("app.RATE_LIMIT_WINDOW_S", 10), patch("app.time.time", return_value=30.0):
            limited, retry = app_module._is_rate_limited("new")
        self.assertFalse(limited)
        self.assertEqual(retry, 0)
        self.assertNotIn("old", app_module.RATE_LIMIT_STATE)


if __name__ == "__main__":
    unittest.main()
