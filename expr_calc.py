import ast
import json
from pathlib import Path

from sympy import Matrix, simplify, sqrt, exp, sin, cos, log, I, pi, E, symbols, Symbol, Expr, MatrixBase, oo, zoo, nan, Integer, Float, Rational
from sympy.matrices.common import NonInvertibleMatrixError
from sympy.parsing.sympy_parser import parse_expr, standard_transformations, auto_symbol

ALLOWED_NODES = (
    ast.Expression, ast.BinOp, ast.UnaryOp, ast.Call,
    ast.Name, ast.Load, ast.Constant,
    ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.UAdd, ast.USub
)

_DATA_DIR = Path(__file__).resolve().parent / "static" / "data"
_ALLOWED_SYMBOLS_JSON = _DATA_DIR / "allowed_symbols.json"
_SAFE_PARSE_TRANSFORMATIONS = tuple(t for t in standard_transformations if t is not auto_symbol)
_SAFE_PARSE_GLOBALS = {
    "__builtins__": {},
    "Integer": Integer,
    "Float": Float,
    "Rational": Rational,
}


def _load_allowed_symbols():
    """式に現れてよい SymPy 記号（1文字）。単一ソース: static/data/allowed_symbols.json"""
    with open(_ALLOWED_SYMBOLS_JSON, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list) or not all(isinstance(x, str) and len(x) == 1 for x in data):
        raise ValueError("allowed_symbols.json must be a JSON array of single-character strings")
    return frozenset(data)


ALLOWED_SYMBOLS = _load_allowed_symbols()

# 式に混入しがちな全角演算子・記号を半角に統一（ast.parse 用）
_OP_NORMALIZE = str.maketrans({
    "＋": "+",
    "－": "-",
    "＊": "*",
    "／": "/",
    "（": "(",
    "）": ")",
    "＝": "=",
    "×": "*",
    "÷": "/",
    "−": "-",
})


class CalcInputError(ValueError):
    def __init__(self, message, code="CALC_INPUT_ERROR", **details):
        super().__init__(message)
        self.code = code
        self.details = details


class MatrixCalculator:
    def __init__(self, tokens, matrices):
        self.tokens = tokens
        self.matrices = matrices

    def evaluate(self):
        try:
            expr = self.tokens_to_expr()
            self.check_syntax(expr)
            env = self.build_env()
            # Python eval を避け、SymPy の式パーサのみで評価する
            try:
                evaluated = parse_expr(
                    expr,
                    local_dict=env,
                    global_dict=_SAFE_PARSE_GLOBALS,
                    transformations=_SAFE_PARSE_TRANSFORMATIONS,
                )
            except NameError as e:
                raise CalcInputError(
                    "許可されていない識別子または関数が含まれています",
                    code="UNSUPPORTED_IDENTIFIER"
                ) from e
            result = self._process_result(evaluated)
            return result
        except NonInvertibleMatrixError:
            return {"type": "error", "code": "NON_INVERTIBLE", "message": "逆行列は存在しません（行列式が0です）"}
        except ZeroDivisionError:
            return {"type": "error", "code": "DIVISION_BY_ZERO", "message": "0で割ることはできません"}
        except CalcInputError as e:
            return {
                "type": "error",
                "code": e.code,
                "message": str(e),
                **e.details
            }
        except ValueError as e:
            return {"type": "error", "code": "CALC_VALUE_ERROR", "message": "入力値に問題があります"}
        except Exception as e:
            error_name = type(e).__name__
            if error_name == "NonSquareMatrixError":
                return {"type": "error", "code": "NON_SQUARE_MATRIX", "message": "この演算は正方行列でのみ実行できます"}
            if "ShapeError" in error_name:
                return {"type": "error", "code": "MATRIX_SHAPE_ERROR", "message": "行列サイズが一致しないため計算できません"}
            return {"type": "error", "code": "CALC_UNKNOWN_ERROR", "message": "計算中にエラーが発生しました"}

    # トークンから式文字列に変換
    def tokens_to_expr(self):
        expr = []
        for t in self.tokens:
            if t["type"] == "matrix":
                expr.append(f"__M{t['matrixId']}")
            else:
                expr.append(t.get("content", ""))
        return "".join(expr).translate(_OP_NORMALIZE)

    # 許可構文チェック
    def check_syntax(self, expr):
        try:
            tree = ast.parse(expr, mode="eval")
            for node in ast.walk(tree):
                if not isinstance(node, ALLOWED_NODES):
                    raise CalcInputError(
                        f"許可されていない構文: {type(node).__name__}",
                        code="UNSUPPORTED_SYNTAX"
                    )
        except SyntaxError:
            raise CalcInputError("括弧や式の構文が正しくありません", code="INVALID_EXPRESSION_SYNTAX")

    # 計算環境構築
    def build_env(self):
        env = {
            "Matrix": Matrix,
            "rref": lambda M: M.rref()[0],
            "det": lambda M: M.det(),
            "inv": lambda M: M.inv(),
            "t": lambda M: M.T,
            "H": lambda M: M.H,
            "tr": lambda M: M.trace(),
            "eig": lambda M: (
                lambda eigvects: {
                    "eigenvalues": [simplify(ev) for ev, _, _ in eigvects],
                    "multiplicities": [mult for _, mult, _ in eigvects],
                    "eigenvectors": [Matrix([simplify(v) for v in vecs]) for _, _, vecs in eigvects]
                }
            )(M.eigenvects()),
            "QR": lambda M: (
                lambda qr: {"Q": qr[0], "R": qr[1]}
            )(M.QRdecomposition()),
            "jord": lambda M: {
                "P": M.jordan_form()[0],
                "J": M.jordan_form()[1],
            },
            "norm": lambda M: M.norm(),
            "LU": lambda M: (
                lambda lu: {"L": lu[0], "U": lu[1]}
            )(M.LUdecomposition()[:2]),
            "SVD": lambda M: (
                lambda svd: {"U": svd[0], "S": svd[1], "V": svd[2]}
            )(M.singular_value_decomposition()),
            "sqrt": sqrt, "i": I, "exp": exp, "sin": sin,
            "cos": cos, "log": log, "pi": pi, "E": E
        }
        for s in ALLOWED_SYMBOLS:
            env[s] = symbols(s)

        for mid, data in self.matrices.items():
            if not isinstance(data, dict) or "values" not in data:
                raise CalcInputError(f"行列 {mid} の形式が不正です", code="INVALID_MATRIX_FORMAT", matrixId=mid)
            values = data["values"]
            if not isinstance(values, list) or not values:
                raise CalcInputError(
                    f"行列 {mid} のサイズが不正です（空行/列があります）",
                    code="INVALID_MATRIX_SIZE",
                    matrixId=mid
                )
            if not all(isinstance(row, list) and row for row in values):
                raise CalcInputError(
                    f"行列 {mid} のサイズが不正です（空行/列があります）",
                    code="INVALID_MATRIX_SIZE",
                    matrixId=mid
                )
            col_count = len(values[0])
            if any(len(row) != col_count for row in values):
                raise CalcInputError(
                    f"行列 {mid} のサイズが不正です（行ごとの列数が一致しません）",
                    code="INVALID_MATRIX_SIZE",
                    matrixId=mid
                )
            try:
                # 行列値も parse_expr を使い、評価経路を統一して安全化する
                parsed_rows = []
                for row_index, row in enumerate(values, start=1):
                    parsed_row = []
                    for col_index, value in enumerate(row, start=1):
                        try:
                            parsed_row.append(self._parse_matrix_cell(value))
                        except Exception as e:
                            raise CalcInputError(
                                f"行列 {mid} の {row_index}行{col_index}列に不正な値があります",
                                code="INVALID_MATRIX_CELL",
                                matrixId=mid,
                                row=row_index,
                                col=col_index
                            ) from e
                    parsed_rows.append(parsed_row)
                env[f"__M{mid}"] = Matrix(parsed_rows)
            except Exception as e:
                if isinstance(e, CalcInputError):
                    raise
                raise CalcInputError(
                    f"行列 {mid} に不正な値があります",
                    code="INVALID_MATRIX_VALUE",
                    matrixId=mid
                ) from e
        return env

    def _parse_matrix_cell(self, value):
        if not isinstance(value, str):
            value = str(value)
        normalized = value.translate(_OP_NORMALIZE)
        self.check_syntax(normalized)
        cell_env = {"i": I}
        for s in ALLOWED_SYMBOLS:
            cell_env[s] = symbols(s)
        return parse_expr(
            normalized,
            local_dict=cell_env,
            global_dict=_SAFE_PARSE_GLOBALS,
            transformations=_SAFE_PARSE_TRANSFORMATIONS,
        )

    # 出力用文字列化 (I → i)
    def _to_user_str(self, x):
        return str(simplify(x)).replace("I", "i")

    def _matrix_to_user_str(self, mat):
        data = mat.tolist()
        return [[self._to_user_str(c) for c in row] for row in data]

    def _is_non_finite_atom(self, value):
        if isinstance(value, Expr):
            # SymPy は 0除算などを例外ではなく zoo/oo/nan として返すことがある
            return bool(value.has(zoo) or value.has(oo) or value.has(nan))
        return False

    def _contains_non_finite(self, value):
        if isinstance(value, MatrixBase):
            return any(self._is_non_finite_atom(cell) for cell in value)
        if isinstance(value, dict):
            return any(self._contains_non_finite(v) for v in value.values())
        if isinstance(value, (list, tuple)):
            return any(self._contains_non_finite(v) for v in value)
        return self._is_non_finite_atom(value)

    # 結果を typeごとに整理
    def _process_result(self, elem):
        if self._contains_non_finite(elem):
            raise CalcInputError("0で割ることはできません", code="DIVISION_BY_ZERO")

        # 単一行列
        if isinstance(elem, MatrixBase):
            return {
                "type": "matrix",
                "values": self._matrix_to_user_str(elem)
            }

        # 解析系の dict
        elif isinstance(elem, dict):
            # QR分解
            if "Q" in elem and "R" in elem:
                return {
                    "type": "QR",
                    "Q": self._matrix_to_user_str(elem["Q"]),
                    "R": self._matrix_to_user_str(elem["R"])
                }

            # 固有値分解
            elif "eigenvalues" in elem and "eigenvectors" in elem:
                return {
                    "type": "eig",
                    "eigenvalues": [self._to_user_str(ev) for ev in elem["eigenvalues"]],
                    "multiplicities": elem["multiplicities"],
                    "eigenvectors": [self._matrix_to_user_str(vec) for vec in elem["eigenvectors"]]
                }

            # ジョルダン分解
            elif "P" in elem and "J" in elem:
                return {
                    "type": "jord",
                    "J": self._matrix_to_user_str(elem["J"]),
                    "P": self._matrix_to_user_str(elem["P"])
                }

            # LU 分解
            elif "L" in elem and "U" in elem:
                return {
                    "type": "LU",
                    "L": self._matrix_to_user_str(elem["L"]),
                    "U": self._matrix_to_user_str(elem["U"]),
                }

            # SVD
            elif "U" in elem and "S" in elem and "V" in elem:
                return {
                    "type": "SVD",
                    "U": self._matrix_to_user_str(elem["U"]),
                    "S": self._matrix_to_user_str(elem["S"]),
                    "V": self._matrix_to_user_str(elem["V"]),
                }

            else:
                return {"type": "info", **elem}

        # スカラー
        elif isinstance(elem, (int, float, complex, str, Symbol, Expr)):
            return {"type": "scalar", "value": self._to_user_str(elem)}

        # 想定外はエラー
        else:
            raise ValueError(f"予期しない計算結果の型: {type(elem).__name__}")
