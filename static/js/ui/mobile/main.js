import { setTokenManager, renderGroup } from "../../core/matrixGroup.js";
import { TokenManager } from "../../core/tokenManager.js";
import { displayResult } from "../../core/displayResult.js";
import { initHelp } from "../../core/help.js";
import { initOperatorTabs } from "../../core/operatorTabs.js";
import { createCalcRunner } from "../../core/calcRunner.js";
import { createRunOrCancelHandler, setCalcButtonsStopMode } from "../../core/calcControls.js";
import { createMobilePager } from "./pager.js";
import { createScalarCommitter } from "./scalarInput.js";
import { initMobileOperatorPad } from "./operatorPad.js";

function createMatrixNameResolver(rootEl) {
  return (matrixId) => {
    if (!matrixId || !rootEl) return "";
    const selector = `.matrix-group[data-matrix-id="${String(matrixId)}"] .matrix-name`;
    const input = rootEl.querySelector(selector);
    const name = input?.value?.trim() ?? "";
    return name;
  };
}


function initMobileApp() {
  const resultLog = document.querySelector("[data-mobile-result-log]");
  const resultTimer = document.querySelector("[data-mobile-result-timer]");
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
    enableBarFocus: false,
    enableKeyControls: false,
    focusExpressionBarOnPadInsert: false,
    onInputError: (message) => {
      resultLog.innerHTML = "";
      displayResult(
        tokenManager.getPreviewTokensForDisplay(),
        { type: "error", message },
        null,
        resultLog,
        { resolveMatrixNameById: createMatrixNameResolver(matrixTrack) }
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
    const group = renderGroup(zeroMatrix, false, "", { enableEnterCellNavigation: true });
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
  });
  scalarInsertBtn?.addEventListener("click", () => {
    commitScalarFromInput();
  });
  backspaceBtn?.addEventListener("click", () => {
    tokenManager.deletePrevToken();
    showScalarError("");
  });
  valToggleBtn?.addEventListener("click", () => {
    const expanded = valToggleBtn.getAttribute("aria-expanded") === "true";
    const nextExpanded = !expanded;
    valToggleBtn.setAttribute("aria-expanded", nextExpanded ? "true" : "false");
    scalarWrap.classList.toggle("is-collapsed", !nextExpanded);
  });
  parenButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const paren = btn.getAttribute("data-mobile-paren");
      if (!paren) return;
      tokenManager.addToken(paren, "paren");
    });
  });

  const resolveMatrixNameById = createMatrixNameResolver(matrixTrack);
  const calcRunner = createCalcRunner({
    tokenManager,
    matricesContainer: null,
    resultLog,
    matricesRoot: matrixTrack,
    resolveMatrixNameById,
    appendResult: false,
    showRunningIndicator: false,
    onRunningTimeText: (text) => {
      if (resultTimer) resultTimer.textContent = text;
    },
    onRunStateChange: (state) => {
      const isStopMode = state === "running" || state === "cancelling";
      if (equalsBtn) setCalcButtonsStopMode([equalsBtn], isStopMode);
    },
  });

  const runCalc = createRunOrCancelHandler(calcRunner);

  equalsBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    await runCalc();
  });

  initOperatorTabs();
  initMobileOperatorPad(tokenManager, runCalc);

  // MobileではDesktop前提のグローバルキーボード実行を無効化する。

  addMatrix();
}

window.addEventListener("DOMContentLoaded", initMobileApp);
