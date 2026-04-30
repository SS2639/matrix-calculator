import {
  ALLOWED_SYMBOL_CHARS,
  appendLiteralKey,
  isIncompleteLiteralDraft,
} from "./scalarValidate.js";

class Token {
  constructor(content, type, matrixId = null) {
    this.content = content;
    this.type = type;
    this.matrixId = matrixId;
  }

  render(parent) {
    const el = document.createElement("span");
    el.classList.add("token");
    el.classList.add(this.type);
    el.textContent = this.content;

    parent.appendChild(el);
    return el;
  }
}

export class TokenManager {
  constructor(selector, options = {}) {
    this.bar = document.querySelector(selector);
    this.tokens = [];
    this.cursorIndex = 0;
    /** @type {string | null} */
    this.literalDraft = null;
    this.cursorEl = this.createCursorElement();
    this.onInputError = options.onInputError || (() => {});
    this.enableBarFocus = options.enableBarFocus !== false;
    this.focusExpressionBarOnPadInsert = options.focusExpressionBarOnPadInsert !== false;
    this.enableKeyControls = options.enableKeyControls !== false;
    if (!this.bar) {
      console.error(`TokenManager: element not found for selector "${selector}"`);
      return;
    }
    if (this.enableBarFocus) this.initExpressionBarFocus();
    if (this.enableKeyControls) this.initKeyControls();
    this.renderAll();
  }

  /** クリックで式バーにフォーカス（カーソル表示・キー入力の前提） */
  initExpressionBarFocus() {
    if (!this.bar) return;
    this.bar.addEventListener(
      "mousedown",
      (e) => {
        if (e.button !== 0) return;
        this.bar.focus({ preventScroll: true });
      },
      true
    );
  }

  createCursorElement() {
    const el = document.createElement("span");
    el.classList.add("cursor");
    return el;
  }

  addToken(content, type, matrixId = null) {
    const token = new Token(content, type, matrixId);
    this.tokens.splice(this.cursorIndex, 0, token);
    this.cursorIndex++;
    this.renderAll();
  }

  /**
   * 下書きを確定してトークン化。空なら成功。
   * @returns {{ ok: true } | { ok: false, message: string }}
   */
  commitLiteralDraft() {
    if (this.literalDraft == null || this.literalDraft === "") {
      this.literalDraft = null;
      return { ok: true };
    }
    if (isIncompleteLiteralDraft(this.literalDraft)) {
      return { ok: false, message: "数値が不完全です" };
    }
    const committedLiteral = this.literalDraft;
    this.literalDraft = null;
    this.addToken(committedLiteral, "scalar");
    return { ok: true };
  }

  /**
   * 計算直前など: 下書きを確定（失敗時はメッセージ）。
   * addToken を内部で呼ぶため cursor が進む点に注意。
   */
  flushLiteralDraftForSubmit() {
    return this.commitLiteralDraft();
  }

  /**
   * 結果ログ用: トークンとカーソル位置の下書きを空白区切りで表示
   */
  getExpressionPreviewString() {
    const parts = [];
    for (let i = 0; i < this.tokens.length; i++) {
      if (i === this.cursorIndex && this.literalDraft != null) {
        parts.push(this.literalDraft);
      }
      parts.push(this.tokens[i].content);
    }
    if (this.cursorIndex === this.tokens.length && this.literalDraft != null) {
      parts.push(this.literalDraft);
    }
    return parts.join(" ");
  }

  /**
   * 表示処理向けの簡易トークン列（既存 displayResult 互換）
   */
  getPreviewTokensForDisplay() {
    return [{ content: this.getExpressionPreviewString(), type: "scalar", matrixId: null }];
  }

  deletePrevToken() {
    if (this.literalDraft != null) {
      if (this.literalDraft === "") {
        this.literalDraft = null;
        this.renderAll();
        return;
      }
      this.literalDraft = this.literalDraft.slice(0, -1);
      if (this.literalDraft === "") this.literalDraft = null;
      this.renderAll();
      return;
    }
    if (this.cursorIndex > 0) {
      this.tokens.splice(this.cursorIndex - 1, 1);
      this.cursorIndex--;
      this.renderAll();
    }
  }

  deleteNextToken() {
    if (this.literalDraft != null) return;
    if (this.cursorIndex < this.tokens.length) {
      this.tokens.splice(this.cursorIndex, 1);
      this.renderAll();
    }
  }

  clearAll() {
    this.tokens = [];
    this.cursorIndex = 0;
    this.literalDraft = null;
    this.renderAll();
  }

  updateMatrixName(matrixId, newName) {
    let updated = false;
    for (const t of this.tokens) {
      if (t.matrixId === matrixId) {
        t.content = newName;
        updated = true;
      }
    }
    if (updated) this.renderAll();
  }

  moveCursor(direction) {
    if (direction === "left" && this.cursorIndex > 0) {
      const r = this.commitLiteralDraft();
      if (!r.ok) {
        this.onInputError(r.message);
        return;
      }
      this.cursorIndex--;
    } else if (direction === "right" && this.cursorIndex < this.tokens.length) {
      const r = this.commitLiteralDraft();
      if (!r.ok) {
        this.onInputError(r.message);
        return;
      }
      this.cursorIndex++;
    } else if (direction === "home") {
      const r = this.commitLiteralDraft();
      if (!r.ok) {
        this.onInputError(r.message);
        return;
      }
      this.cursorIndex = 0;
    } else if (direction === "end") {
      const r = this.commitLiteralDraft();
      if (!r.ok) {
        this.onInputError(r.message);
        return;
      }
      this.cursorIndex = this.tokens.length;
    }

    this.renderAll();
  }

  resolveCursorIndexByTokenClick(index, event, tokenEl) {
    if (!event || !tokenEl) return index + 1;
    const bounds = tokenEl.getBoundingClientRect();
    const width = bounds.width;
    if (!Number.isFinite(width) || width <= 0) return index + 1;
    const offsetX = event.clientX - bounds.left;
    return offsetX < width / 2 ? index : index + 1;
  }

  handleTokenClick(index, event, tokenEl) {
    const r = this.commitLiteralDraft();
    if (!r.ok) {
      this.onInputError(r.message);
      return;
    }
    this.cursorIndex = this.resolveCursorIndexByTokenClick(index, event, tokenEl);
    this.renderAll();
  }

  renderAll() {
    if (!this.bar) return;
    this.bar.innerHTML = "";
    for (let i = 0; i <= this.tokens.length; i++) {
      if (i === this.cursorIndex) {
        if (this.literalDraft != null) {
          const d = document.createElement("span");
          d.classList.add("token", "scalar", "is-draft");
          if (this.literalDraft === "") {
            d.classList.add("is-empty-placeholder");
            d.textContent = "\u200b";
          } else {
            d.textContent = this.literalDraft;
          }
          this.bar.appendChild(d);
        }
        this.bar.appendChild(this.cursorEl);
      }
      if (i < this.tokens.length) {
        const t = this.tokens[i];
        const el = t.render(this.bar);
        el.addEventListener("click", (event) => this.handleTokenClick(i, event, el));
      }
    }
  }

  /**
   * キーボードの二項演算子（* は ** マージあり）
   */
  insertBinaryOperatorFromKey(op) {
    if (op === "*") {
      const r = this.commitLiteralDraft();
      if (!r.ok) {
        this.onInputError(r.message);
        return;
      }
      const prev = this.cursorIndex > 0 ? this.tokens[this.cursorIndex - 1] : null;
      if (prev && prev.type === "binary-op" && prev.content === "*") {
        prev.content = "**";
        this.renderAll();
        return;
      }
      this.addToken("*", "binary-op");
      return;
    }
    const r = this.commitLiteralDraft();
    if (!r.ok) {
      this.onInputError(r.message);
      return;
    }
    this.addToken(op, "binary-op");
  }

  /**
   * 演算子パッドから: commit 後にトークン追加。* は ** マージ。
   * @param {string} op data-op
   * @param {string} type トークン型クラス名に対応する type
   */
  insertFromPad(op, type) {
    const r = this.commitLiteralDraft();
    if (!r.ok) {
      this.onInputError(r.message);
      return;
    }
    if (op === "*") {
      const prev = this.cursorIndex > 0 ? this.tokens[this.cursorIndex - 1] : null;
      if (prev && prev.type === "binary-op" && prev.content === "*") {
        prev.content = "**";
        this.renderAll();
        if (this.focusExpressionBarOnPadInsert) this.bar?.focus({ preventScroll: true });
        return;
      }
      this.addToken("*", "binary-op");
      if (this.focusExpressionBarOnPadInsert) this.bar?.focus({ preventScroll: true });
      return;
    }
    if (op === "**") {
      this.addToken("**", "binary-op");
      if (this.focusExpressionBarOnPadInsert) this.bar?.focus({ preventScroll: true });
      return;
    }
    if (op === "val") {
      this.literalDraft = "";
      this.renderAll();
      if (this.focusExpressionBarOnPadInsert) this.bar?.focus({ preventScroll: true });
      return;
    }
    this.addToken(op, type);
    if (this.focusExpressionBarOnPadInsert) this.bar?.focus({ preventScroll: true });
  }

  initKeyControls() {
    document.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "=") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (
        (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
        document.activeElement !== this.bar
      ) {
        e.preventDefault();
        this.bar?.focus({ preventScroll: true });
        this.moveCursor(e.key === "ArrowLeft" ? "left" : "right");
        return;
      }
      if (document.activeElement !== this.bar) return;

      let key = e.key;

      /** テンキー等で e.key が環境依存になる場合の二項演算子記号 */
      let opKey = key;
      if (e.code === "NumpadAdd") opKey = "+";
      else if (e.code === "NumpadSubtract") opKey = "-";
      else if (e.code === "NumpadMultiply") opKey = "*";
      else if (e.code === "NumpadDivide") opKey = "/";

      if (
        key === "ArrowLeft" ||
        key === "ArrowRight" ||
        key === "ArrowUp" ||
        key === "ArrowDown"
      ) {
        e.preventDefault();
        if (key === "ArrowLeft") this.moveCursor("left");
        else if (key === "ArrowRight") this.moveCursor("right");
        else if (key === "ArrowUp") this.moveCursor("home");
        else this.moveCursor("end");
        return;
      }

      if (key === "Backspace") {
        e.preventDefault();
        this.deletePrevToken();
        return;
      }
      if (key === "Delete") {
        e.preventDefault();
        this.deleteNextToken();
        return;
      }
      if (key === "Escape") {
        e.preventDefault();
        this.clearAll();
        return;
      }

      /** 数値連続入力中: Enter で下書きを確定（不完全・不正なら onInputError） */
      if (key === "Enter") {
        if (this.literalDraft != null) {
          e.preventDefault();
          const r = this.commitLiteralDraft();
          if (!r.ok) this.onInputError(r.message);
        }
        return;
      }

      if (key === "(" || key === ")") {
        e.preventDefault();
        const r = this.commitLiteralDraft();
        if (!r.ok) {
          this.onInputError(r.message);
          return;
        }
        this.addToken(key, "paren");
        return;
      }

      if (key.length === 1) {
        const lk = key.toLowerCase();
        if (ALLOWED_SYMBOL_CHARS.has(lk)) {
          e.preventDefault();
          const r = this.commitLiteralDraft();
          if (!r.ok) {
            this.onInputError(r.message);
            return;
          }
          this.addToken(lk, "symbol");
          return;
        }
      }

      /**
       * val 空スロット: 先頭は 0–9 と . のみ。
       * それ以外のキーはスロットを閉じ、同じキーを通常処理へ（閉じただけで演算子等が無視されないようにする）。
       */
      if (this.literalDraft === "") {
        let kEmpty = key;
        if (e.code === "NumpadDecimal") kEmpty = ".";
        else if (/^Numpad[0-9]$/.test(e.code)) kEmpty = e.code.slice(-1);
        const litTry = appendLiteralKey("", kEmpty);
        if (litTry != null) {
          e.preventDefault();
          this.literalDraft = litTry;
          this.renderAll();
          return;
        }
        if (key === "Tab") return;
        e.preventDefault();
        this.literalDraft = null;
        this.renderAll();
        key = kEmpty;
        opKey = key;
        if (e.code === "NumpadAdd") opKey = "+";
        else if (e.code === "NumpadSubtract") opKey = "-";
        else if (e.code === "NumpadMultiply") opKey = "*";
        else if (e.code === "NumpadDivide") opKey = "/";
      }

      const lit = appendLiteralKey(this.literalDraft, key);
      if (lit != null) {
        e.preventDefault();
        this.literalDraft = lit;
        this.renderAll();
        return;
      }

      if (opKey === "+" || opKey === "-") {
        e.preventDefault();
        if (this.literalDraft != null && this.literalDraft !== "") {
          const r = this.commitLiteralDraft();
          if (!r.ok) {
            this.onInputError(r.message);
            return;
          }
        }
        this.insertBinaryOperatorFromKey(opKey);
        return;
      }

      if (opKey === "*" || opKey === "/") {
        e.preventDefault();
        this.insertBinaryOperatorFromKey(opKey);
        return;
      }
    });
  }
}
