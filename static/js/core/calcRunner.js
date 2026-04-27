import { displayResult } from "./displayResult.js";
import { fetchParsedTokens } from "./api.js";
import { isValidScalarTokenContent } from "./scalarValidate.js";

function clearMatrixErrorHighlights() {
  document.querySelectorAll(".matrix-cell-error").forEach((el) => {
    el.classList.remove("matrix-cell-error");
  });
}

function highlightMatrixCellError(result, matricesRoot = document) {
  if (!result || result.type !== "error") return;
  const matrixId = result.matrixId;
  const row = Number(result.row);
  const col = Number(result.col);
  if (!matrixId || !Number.isInteger(row) || !Number.isInteger(col)) return;

  const group = matricesRoot.querySelector(`.matrix-group[data-matrix-id="${matrixId}"]`);
  if (!group) return;

  const table = group.querySelector("table");
  if (!table || row < 1 || col < 1 || row > table.rows.length || col > table.rows[0].cells.length) return;

  const targetInput = table.rows[row - 1].cells[col - 1].querySelector("input");
  if (!targetInput) return;
  targetInput.classList.add("matrix-cell-error");
  targetInput.focus({ preventScroll: true });
}

function buildTokensData(tokenManager) {
  return tokenManager.tokens.map((t) => ({
    content: t.content,
    type: t.type,
    matrixId: t.matrixId
  }));
}

function buildMatricesData(tokensData, matricesRoot = document) {
  const usedMatrixIds = new Set(tokensData.filter((t) => t.type === "matrix").map((t) => t.matrixId));
  const matricesData = {};

  matricesRoot.querySelectorAll(".matrix-group").forEach((group) => {
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

function showError(tokensData, result, matricesContainer, resultLog, options = {}) {
  const { matricesRoot = document } = options;
  displayResult(tokensData, result, matricesContainer, resultLog, options);
  highlightMatrixCellError(result, matricesRoot);
}

function createRunningTimer(resultLog) {
  const indicator = document.createElement("div");
  indicator.className = "calc-running-indicator";
  indicator.textContent = "実行中: 0.0秒";
  resultLog.prepend(indicator);

  const startedAtMs = Date.now();
  const renderElapsed = () => {
    const elapsedSec = (Date.now() - startedAtMs) / 1000;
    indicator.textContent = `実行中: ${elapsedSec.toFixed(1)}秒`;
  };
  renderElapsed();
  const timerId = window.setInterval(renderElapsed, 100);

  return () => {
    window.clearInterval(timerId);
    indicator.remove();
  };
}

export function createCalcRunner({
  tokenManager,
  matricesContainer,
  resultLog,
  matricesRoot = document,
  resolveMatrixNameById,
  appendResult = true,
  showRunningIndicator = true,
  invalidScalarMessage = "不正な数値があります",
}) {
  let isRunning = false;
  return async function runCalc() {
    if (!resultLog || isRunning) return;
    isRunning = true;
    clearMatrixErrorHighlights();

    const calcButtons = document.querySelectorAll(".calc-btn");
    calcButtons.forEach((btn) => {
      btn.disabled = true;
      btn.textContent = "……";
    });

    const restoreCalcButtons = () => {
      calcButtons.forEach((btn) => {
        btn.disabled = false;
        btn.textContent = "=";
      });
    };
    const stopRunningTimer = showRunningIndicator ? createRunningTimer(resultLog) : () => {};

    try {
      const flush = tokenManager.flushLiteralDraftForSubmit();
      const previewTokens = tokenManager.getPreviewTokensForDisplay();
      if (!flush.ok) {
        if (!appendResult) resultLog.innerHTML = "";
        displayResult(
          previewTokens,
          { type: "error", code: "INVALID_LITERAL", message: flush.message },
          matricesContainer,
          resultLog,
          { resolveMatrixNameById }
        );
        return;
      }

      const tokensData = buildTokensData(tokenManager);
      for (const t of tokensData) {
        if ((t.type === "scalar" || t.type === "symbol") && !isValidScalarTokenContent(t.content)) {
          if (!appendResult) resultLog.innerHTML = "";
          displayResult(
            previewTokens,
            { type: "error", code: "INVALID_SCALAR", message: invalidScalarMessage },
            matricesContainer,
            resultLog,
            { resolveMatrixNameById }
          );
          return;
        }
      }

      const matricesData = buildMatricesData(tokensData, matricesRoot);
      const result = await fetchParsedTokens(tokensData, matricesData);
      if (!appendResult) resultLog.innerHTML = "";
      if (result.type === "error") {
        showError(tokensData, result, matricesContainer, resultLog, { resolveMatrixNameById, matricesRoot });
        return;
      }
      displayResult(tokensData, result, matricesContainer, resultLog, { resolveMatrixNameById });
    } finally {
      stopRunningTimer();
      restoreCalcButtons();
      isRunning = false;
    }
  };
}
