import { ALLOWED_SYMBOL_CHARS } from "./allowedSymbols.gen.js";

/** @see docs/KEYBOARD.md — 記号集合の単一ソースは static/data/allowed_symbols.json */
export { ALLOWED_SYMBOL_CHARS };

/**
 * 式バーに置くスカラー／記号トークン文字列の検証（サーバ送信前）。
 * - 単一文字 a,b,c,x,y,z,n は SymPy 記号として許可
 * - それ以外は trim 後、有限の数値として解釈できること
 */
export function isValidScalarTokenContent(s) {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (t === "") return false;
  if (t.length === 1 && ALLOWED_SYMBOL_CHARS.has(t)) return true;
  const n = Number(t);
  return Number.isFinite(n);
}

/**
 * 入力途中のリテラル下書きが「まだ数値として確定できない」状態か。
 * 確定を試みるべきでない（エラーにすべき）不完全例: "-", ".", "1e", "1e-"
 */
export function isIncompleteLiteralDraft(draft) {
  if (draft == null || draft === "") return false;
  const t = draft.trim();
  if (t === "") return false;
  if (t.length === 1 && ALLOWED_SYMBOL_CHARS.has(t)) return false;
  const n = Number(t);
  if (Number.isFinite(n)) return false;
  // Number が NaN でも、さらに入力で有限になる可能性があるパターン（先頭の +/- はリテラルに含めない）
  if (/^(\d+\.?\d*|\.\d*)[eE][-+]?\d*$/.test(t)) {
    const expPart = t.split(/[eE]/)[1];
    if (expPart === "" || expPart === "+" || expPart === "-") return true;
  }
  if (/^[eE]/.test(t)) return true;
  if (t === ".") return true;
  if (/[eE][+-]?$/.test(t)) return true;
  // それ以外の NaN は不正な文字列の可能性が高いが、不完全扱いにしない（確定時に弾く）
  return false;
}

/**
 * 1キー分をリテラル下書きに追記できるか。できる場合は新しい文字列を返す。
 * @param {string | null} draft
 * @param {string} key e.key（1文字想定）
 * @returns {string | null}
 */
export function appendLiteralKey(draft, key) {
  const cur = draft ?? "";
  if (/^[0-9]$/.test(key)) return cur + key;
  if (key === ".") {
    const mant = cur.split(/[eE]/)[0];
    if (mant.includes(".")) return null;
    return cur + ".";
  }
  if (key === "e" || key === "E") {
    if (/[eE]/.test(cur)) return null;
    const mant = cur.split(/[eE]/)[0];
    if (!mant || !/\d/.test(mant)) return null;
    return cur + key;
  }
  // 数値リテラル内では指数部の直後に限り +/-（例: 1e-6）。+,-,*,/,** は演算子トークン側で扱う
  if (key === "+" || key === "-") {
    if (/[eE]$/.test(cur)) return cur + key;
    return null;
  }
  return null;
}
