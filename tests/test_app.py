import unittest
from unittest.mock import patch
from pathlib import Path

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
        class DummyProcess:
            def __init__(self, *args, **kwargs):
                pass

            def start(self):
                return None

            def join(self, timeout=None):
                return None

            def is_alive(self):
                return True

            def terminate(self):
                return None

        payload = {
            "tokens": [{"type": "scalar", "content": "1"}],
            "matrices": {}
        }
        with patch("app.Process", DummyProcess):
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
