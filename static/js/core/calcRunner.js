import { displayResult } from "./displayResult.js";
import { cancelCalcRequest, fetchParsedTokens } from "./api.js";
import { startRunningTimer } from "./runningTimer.js";

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
  resultLog.prepend(indicator);
  return startRunningTimer({
    onTick: (text) => {
      indicator.textContent = text;
    },
    onStop: () => {
      indicator.remove();
    },
  });
}

export function createCalcRunner({
  tokenManager,
  matricesContainer,
  resultLog,
  matricesRoot = document,
  resolveMatrixNameById,
  appendResult = true,
  showRunningIndicator = true,
  onRunningTimeText,
  onRunStateChange,
}) {
  let isRunning = false;
  let isCancelling = false;
  /** @type {AbortController | null} */
  let abortController = null;
  let activeRequestId = null;

  const notifyRunState = () => {
    if (typeof onRunStateChange !== "function") return;
    if (isCancelling) onRunStateChange("cancelling");
    else if (isRunning) onRunStateChange("running");
    else onRunStateChange("idle");
  };

  const run = async () => {
    if (!resultLog || isRunning) return;
    isRunning = true;
    isCancelling = false;
    abortController = new AbortController();
    activeRequestId = `calc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    notifyRunState();
    clearMatrixErrorHighlights();
    const stopRunningTimer = showRunningIndicator
      ? createRunningTimer(resultLog)
      : (typeof onRunningTimeText === "function"
        ? startRunningTimer({
          onTick: (text) => onRunningTimeText(text),
          onStop: () => onRunningTimeText(""),
        })
        : () => {});

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

      const matricesData = buildMatricesData(tokensData, matricesRoot);
      const result = await fetchParsedTokens(tokensData, matricesData, {
        signal: abortController.signal,
        requestId: activeRequestId,
      });
      if (!appendResult) resultLog.innerHTML = "";
      if (result.type === "error") {
        if (result.code === "REQUEST_ABORTED") return;
        showError(tokensData, result, matricesContainer, resultLog, { resolveMatrixNameById, matricesRoot });
        return;
      }
      displayResult(tokensData, result, matricesContainer, resultLog, { resolveMatrixNameById });
    } finally {
      abortController = null;
      activeRequestId = null;
      isCancelling = false;
      stopRunningTimer();
      isRunning = false;
      notifyRunState();
    }
  };

  const cancel = () => {
    if (!isRunning || !abortController) return false;
    isCancelling = true;
    notifyRunState();
    void cancelCalcRequest(activeRequestId).then((cancelResult) => {
      if (!cancelResult || cancelResult.status !== "ok" || cancelResult.cancelled !== true) {
        console.warn("cancel request was not confirmed by server", cancelResult);
      }
    });
    abortController.abort();
    return true;
  };

  return {
    run,
    cancel,
    isRunning: () => isRunning,
  };
}
