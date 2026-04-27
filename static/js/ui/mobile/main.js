import { setTokenManager, renderGroup } from "../../core/matrixGroup.js";
import { TokenManager } from "../../core/tokenManager.js";
import { displayResult } from "../../core/displayResult.js";
import { fetchParsedTokens } from "../../core/api.js";
import { isValidScalarTokenContent } from "../../core/scalarValidate.js";
import { initHelp } from "../../core/help.js";
import { initOperatorTabs } from "../../core/operatorTabs.js";

const SWIPE_THRESHOLD_RATIO = 0.2;

function getTokensData(tokenManager) {
  return tokenManager.tokens.map((t) => ({
    content: t.content,
    type: t.type,
    matrixId: t.matrixId,
  }));
}

function getMatricesData(tokensData, matrixTrack) {
  const usedMatrixIds = new Set(tokensData.filter((t) => t.type === "matrix").map((t) => t.matrixId));
  const matricesData = {};
  matrixTrack.querySelectorAll(".matrix-group").forEach((group) => {
    const id = group.dataset.matrixId;
    if (!usedMatrixIds.has(id)) return;
    const table = group.querySelector("table");
    if (!table) return;
    const values = Array.from(table.rows).map((row) =>
      Array.from(row.cells).map((cell) => {
        const input = cell.querySelector("input");
        return input ? (input.value || "") : "";
      })
    );
    matricesData[id] = { values };
  });
  return matricesData;
}

function clearMatrixErrorHighlights() {
  document.querySelectorAll(".matrix-cell-error").forEach((el) => {
    el.classList.remove("matrix-cell-error");
  });
}

function highlightMatrixCellError(result) {
  if (!result || result.type !== "error") return;
  const matrixId = result.matrixId;
  const row = Number(result.row);
  const col = Number(result.col);
  if (!matrixId || !Number.isInteger(row) || !Number.isInteger(col)) return;
  const group = document.querySelector(`.matrix-group[data-matrix-id="${matrixId}"]`);
  if (!group) return;
  const table = group.querySelector("table");
  if (!table || row < 1 || col < 1 || row > table.rows.length || col > table.rows[0].cells.length) return;
  const targetInput = table.rows[row - 1].cells[col - 1].querySelector("input");
  if (!targetInput) return;
  targetInput.classList.add("matrix-cell-error");
  targetInput.focus({ preventScroll: true });
}

function renderLatestResult(resultLog, tokensData, result) {
  resultLog.innerHTML = "";
  displayResult(tokensData, result, null, resultLog);
}

function createScalarCommitter({ tokenManager, scalarInput, scalarError }) {
  function showScalarError(message) {
    if (!scalarError) return;
    scalarError.textContent = message || "";
  }

  function commitScalarFromInput() {
    const raw = String(scalarInput?.value ?? "");
    const value = raw.trim();
    if (!value) {
      showScalarError("");
      return { ok: false, reason: "EMPTY" };
    }
    if (!isValidScalarTokenContent(value)) {
      showScalarError("不正な値です");
      return { ok: false, reason: "INVALID" };
    }
    showScalarError("");
    tokenManager.addToken(value, "scalar");
    scalarInput.value = "";
    return { ok: true };
  }

  return { commitScalarFromInput, showScalarError };
}

function createMobilePager({ viewport, track, indicator, prevBtn, nextBtn }) {
  let currentIndex = 0;
  let pointerStartX = null;
  let pointerStartY = null;
  let isAnimating = false;

  function getPages() {
    return Array.from(track.querySelectorAll(".mobile-matrix-page"));
  }

  function updateIndicator() {
    const total = getPages().length;
    const visibleIndex = total === 0 ? 0 : currentIndex + 1;
    indicator.textContent = `${visibleIndex}/${total}`;
    prevBtn.disabled = total <= 1 || currentIndex <= 0;
    nextBtn.disabled = total <= 1 || currentIndex >= total - 1;
  }

  function syncCurrentIndexFromScroll() {
    const pageWidth = viewport.clientWidth;
    if (!pageWidth) return;
    const total = getPages().length;
    const nextIndex = Math.round(viewport.scrollLeft / pageWidth);
    currentIndex = Math.max(0, Math.min(total - 1, nextIndex));
    updateIndicator();
  }

  function animateScrollTo(targetLeft, durationMs = 200) {
    if (isAnimating) return;
    const startLeft = viewport.scrollLeft;
    const delta = targetLeft - startLeft;
    if (Math.abs(delta) < 1) {
      viewport.scrollLeft = targetLeft;
      return;
    }
    const startedAt = performance.now();
    isAnimating = true;
    const tick = (now) => {
      const elapsed = now - startedAt;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = 1 - (1 - progress) * (1 - progress);
      viewport.scrollLeft = startLeft + delta * eased;
      if (progress < 1) {
        requestAnimationFrame(tick);
        return;
      }
      viewport.scrollLeft = targetLeft;
      isAnimating = false;
    };
    requestAnimationFrame(tick);
  }

  function goToIndex(index, smooth = true) {
    const pages = getPages();
    if (pages.length === 0) {
      currentIndex = 0;
      updateIndicator();
      return;
    }
    const bounded = Math.max(0, Math.min(pages.length - 1, index));
    currentIndex = bounded;
    const left = viewport.clientWidth * bounded;
    if (smooth) animateScrollTo(left, 200);
    else viewport.scrollLeft = left;
    updateIndicator();
  }

  function goPrev() {
    goToIndex(currentIndex - 1, true);
  }

  function goNext() {
    goToIndex(currentIndex + 1, true);
  }

  function wrapGroup(group) {
    group.querySelectorAll(".matrix-menu-item").forEach((item) => {
      if (item.textContent?.trim() === "複製") item.remove();
    });
    const page = document.createElement("div");
    page.className = "mobile-matrix-page";
    page.appendChild(group);
    track.appendChild(page);
  }

  function addMatrixGroup(group) {
    wrapGroup(group);
    goToIndex(getPages().length - 1, true);
  }

  function removeEmptyPages() {
    const pages = getPages();
    const removedPageIndices = [];
    pages.forEach((page, index) => {
      if (page.querySelector(".matrix-group")) return;
      removedPageIndices.push(index);
      page.remove();
    });
    return removedPageIndices;
  }

  function refreshAfterMutation(removedPageIndices = []) {
    const pages = getPages();
    if (pages.length === 0) {
      currentIndex = 0;
      updateIndicator();
      return;
    }
    const deletedCurrent = removedPageIndices.includes(currentIndex);
    if (!deletedCurrent) {
      currentIndex = Math.min(currentIndex, pages.length - 1);
      goToIndex(currentIndex, false);
      return;
    }
    const movedTo = currentIndex < pages.length ? currentIndex : pages.length - 1;
    goToIndex(movedTo, true);
  }

  prevBtn.addEventListener("click", goPrev);
  nextBtn.addEventListener("click", goNext);

  viewport.addEventListener("scroll", () => {
    syncCurrentIndexFromScroll();
  });

  viewport.addEventListener("pointerdown", (e) => {
    pointerStartX = e.clientX;
    pointerStartY = e.clientY;
  });
  viewport.addEventListener("pointerup", (e) => {
    if (pointerStartX == null || pointerStartY == null) return;
    const dx = e.clientX - pointerStartX;
    const dy = e.clientY - pointerStartY;
    pointerStartX = null;
    pointerStartY = null;
    if (Math.abs(dy) > Math.abs(dx)) return;
    const threshold = viewport.clientWidth * SWIPE_THRESHOLD_RATIO;
    if (Math.abs(dx) < threshold) {
      goToIndex(currentIndex, true);
      return;
    }
    if (dx < 0) goNext();
    else goPrev();
  });

  new MutationObserver((records) => {
    const removedIndices = [];
    records.forEach((record) => {
      if (record.type !== "childList" || record.removedNodes.length === 0) return;
      Array.from(record.removedNodes).forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (!node.classList.contains("mobile-matrix-page")) return;
        const idx = Number(node.dataset.pageIndexBeforeRemove);
        if (Number.isInteger(idx)) removedIndices.push(idx);
      });
    });
    const emptiedIndices = removeEmptyPages();
    refreshAfterMutation([...removedIndices, ...emptiedIndices]);
  }).observe(track, { childList: true, subtree: true });

  updateIndicator();

  return {
    addMatrixGroup,
    reindexPages: () => {
      getPages().forEach((page, index) => {
        page.dataset.pageIndexBeforeRemove = String(index);
      });
      updateIndicator();
    },
    markPageIndicesBeforeMutation: () => {
      getPages().forEach((page, index) => {
        page.dataset.pageIndexBeforeRemove = String(index);
      });
    },
    goToIndex,
  };
}

function initOperatorPad(tokenManager, runCalc) {
  const operatorPad = document.querySelector(".operator-pad");
  if (!operatorPad) return;

  const addBinaryToken = (op) => {
    if (op === "*") {
      const prev = tokenManager.cursorIndex > 0 ? tokenManager.tokens[tokenManager.cursorIndex - 1] : null;
      if (prev && prev.type === "binary-op" && prev.content === "*") {
        prev.content = "**";
        tokenManager.renderAll();
        return;
      }
    }
    tokenManager.addToken(op, "binary-op");
  };

  operatorPad.addEventListener("click", (e) => {
    const calc = e.target.closest(".calc-btn");
    if (calc) {
      e.preventDefault();
      runCalc();
      return;
    }
    const btn = e.target.closest(".op-btn");
    if (!btn || !operatorPad.contains(btn)) return;
    const op = btn.getAttribute("data-op") ?? "";
    if (op === "*" || op === "**" || op === "+" || op === "-" || op === "/") {
      e.preventDefault();
      addBinaryToken(op);
      return;
    }
    const typeHint = Array.from(btn.classList).find(
      (c) => c !== "op-btn" && ["binary-op", "operation-func", "analysis-func", "scalar-op-btn", "paren"].includes(c)
    );
    tokenManager.addToken(op, typeHint || "operation-func");
  });

}

function initMobileApp() {
  const expressionBarEl = document.querySelector(".expression-bar");
  const resultLog = document.querySelector("[data-mobile-result-log]");
  const matrixViewport = document.querySelector("[data-mobile-matrix-viewport]");
  const matrixTrack = document.querySelector("[data-mobile-matrix-track]");
  const pageIndicator = document.querySelector("[data-mobile-page-indicator]");
  const prevBtn = document.querySelector('[data-mobile-nav="prev"]');
  const nextBtn = document.querySelector('[data-mobile-nav="next"]');
  const addMatrixBtn = document.querySelector("[data-mobile-add-matrix]");
  const clearBtn = document.querySelector(".clear-btn");
  const backspaceBtn = document.querySelector(".mobile-backspace-btn");
  const equalsBtn = document.querySelector(".mobile-equals-btn");
  const valToggleBtn = document.querySelector("[data-mobile-val-toggle]");
  const parenButtons = document.querySelectorAll("[data-mobile-paren]");
  const scalarWrap = document.getElementById("mobileScalarWrap");
  const scalarInput = document.querySelector("[data-mobile-scalar-input]");
  const scalarInsertBtn = document.querySelector("[data-mobile-scalar-insert]");
  const scalarError = document.querySelector("[data-mobile-scalar-error]");

  if (
    !expressionBarEl ||
    !resultLog ||
    !matrixViewport ||
    !matrixTrack ||
    !pageIndicator ||
    !prevBtn ||
    !nextBtn ||
    !addMatrixBtn ||
    !scalarWrap ||
    !scalarInput
  ) {
    return;
  }

  const tokenManager = new TokenManager(".expression-bar", {
    onInputError: (message) => {
      renderLatestResult(
        resultLog,
        tokenManager.getPreviewTokensForDisplay(),
        { type: "error", message }
      );
    },
  });
  setTokenManager(tokenManager);
  initHelp();
  const { commitScalarFromInput, showScalarError } = createScalarCommitter({
    tokenManager,
    scalarInput,
    scalarError,
  });

  if (valToggleBtn && scalarWrap) {
    const isExpanded = valToggleBtn.getAttribute("aria-expanded") === "true";
    scalarWrap.classList.toggle("is-collapsed", !isExpanded);
  }

  const pager = createMobilePager({
    viewport: matrixViewport,
    track: matrixTrack,
    indicator: pageIndicator,
    prevBtn,
    nextBtn,
  });

  function addMatrix() {
    const zeroMatrix = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => "0"));
    const group = renderGroup(zeroMatrix, false, "");
    pager.addMatrixGroup(group);
    pager.reindexPages();
  }

  matrixTrack.addEventListener(
    "click",
    (e) => {
      const deleteItem = e.target.closest(".matrix-menu-item");
      if (!deleteItem || deleteItem.textContent?.trim() !== "削除") return;
      pager.markPageIndicesBeforeMutation();
    },
    true
  );

  addMatrixBtn.addEventListener("click", addMatrix);
  clearBtn?.addEventListener("click", () => {
    tokenManager.clearAll();
    showScalarError("");
    scalarInput.focus({ preventScroll: true });
  });
  scalarInsertBtn?.addEventListener("click", () => {
    commitScalarFromInput();
    scalarInput.focus({ preventScroll: true });
  });
  backspaceBtn?.addEventListener("click", () => {
    tokenManager.deletePrevToken();
    showScalarError("");
    expressionBarEl.focus({ preventScroll: true });
  });
  valToggleBtn?.addEventListener("click", () => {
    const expanded = valToggleBtn.getAttribute("aria-expanded") === "true";
    const nextExpanded = !expanded;
    valToggleBtn.setAttribute("aria-expanded", nextExpanded ? "true" : "false");
    scalarWrap.classList.toggle("is-collapsed", !nextExpanded);
    if (nextExpanded) scalarInput.focus({ preventScroll: true });
    else expressionBarEl.focus({ preventScroll: true });
  });
  parenButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const paren = btn.getAttribute("data-mobile-paren");
      if (!paren) return;
      tokenManager.addToken(paren, "paren");
      expressionBarEl.focus({ preventScroll: true });
    });
  });

  let isRunning = false;
  async function runCalc() {
    if (isRunning) return;
    isRunning = true;
    clearMatrixErrorHighlights();
    const calcButtons = document.querySelectorAll(".calc-btn");
    calcButtons.forEach((btn) => {
      btn.disabled = true;
      btn.textContent = "……";
    });
    try {
      const flush = tokenManager.flushLiteralDraftForSubmit();
      const previewTokens = tokenManager.getPreviewTokensForDisplay();
      if (!flush.ok) {
        renderLatestResult(
          resultLog,
          previewTokens,
          { type: "error", code: "INVALID_LITERAL", message: flush.message }
        );
        return;
      }

      const tokensData = getTokensData(tokenManager);
      for (const t of tokensData) {
        if ((t.type === "scalar" || t.type === "symbol") && !isValidScalarTokenContent(t.content)) {
          renderLatestResult(
            resultLog,
            previewTokens,
            { type: "error", code: "INVALID_SCALAR", message: "不正な値があります" }
          );
          return;
        }
      }

      const matricesData = getMatricesData(tokensData, matrixTrack);
      const result = await fetchParsedTokens(tokensData, matricesData);
      renderLatestResult(resultLog, tokensData, result);
      if (result.type === "error") highlightMatrixCellError(result);
    } finally {
      calcButtons.forEach((btn) => {
        btn.disabled = false;
        btn.textContent = "=";
      });
      isRunning = false;
    }
  }

  equalsBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    runCalc();
  });

  initOperatorTabs();
  initOperatorPad(tokenManager, runCalc);

  // MobileではDesktop前提のグローバルキーボード実行を無効化する。

  addMatrix();
}

window.addEventListener("DOMContentLoaded", initMobileApp);
