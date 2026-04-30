import { ALLOWED_SYMBOL_CHARS } from "./allowedSymbols.gen.js";

/** @see docs/KEYBOARD.md — 記号集合の単一ソースは static/data/allowed_symbols.json */
export { ALLOWED_SYMBOL_CHARS };

/**
 * 入力途中のリテラル下書きが「まだ数値として確定できない」状態か。
 * 確定を試みるべきでない（エラーにすべき）不完全例: "-", ".", "1e", "1e-"
 */
export function isIncompleteLiteralDraft(draft) {
  if (draft == null || draft === "") return false;
  const text = String(draft).trim();
  if (text === "") return false;
  if (text.length === 1 && ALLOWED_SYMBOL_CHARS.has(text)) return false;
  const numericValue = Number(text);
  if (Number.isFinite(numericValue)) return false;
  // Number が NaN でも、さらに入力で有限になる可能性があるパターン（先頭の +/- はリテラルに含めない）
  if (/^(\d+\.?\d*|\.\d*)[eE][-+]?\d*$/.test(text)) {
    const expPart = text.split(/[eE]/)[1];
    if (expPart === "" || expPart === "+" || expPart === "-") return true;
  }
  if (/^[eE]/.test(text)) return true;
  if (text === ".") return true;
  if (/[eE][+-]?$/.test(text)) return true;
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
