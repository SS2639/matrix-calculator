import { renderMatrix, renderGroup } from './matrixGroup.js';

function createTextDiv(text) {
  const div = document.createElement("div");
  div.className = "text-div";
  div.textContent = text;
  return div;
}

function createTimestampDiv(now = new Date()) {
  const div = document.createElement("div");
  div.className = "result-group-timestamp";
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  div.textContent = `${hh}:${mm}:${ss}`;
  return div;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function is2dMatrix(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((row) => Array.isArray(row))
  );
}

function getMatrixNameById(matrixId) {
  if (!matrixId) return "";
  const group = Array.from(document.querySelectorAll(".matrix-group")).find(
    (el) => el.getAttribute("data-matrix-id") === String(matrixId)
  );
  if (!group) return "";
  const nameInput = group.querySelector(".matrix-name");
  const name = nameInput?.value?.trim() ?? "";
  return name || "";
}

function formatErrorMessageWithMatrixName(message, matrixId) {
  if (!message || !matrixId) return message;
  const matrixName = getMatrixNameById(matrixId);
  if (!matrixName) return message;

  // 例: 「行列1の...」「行列 1 の...」を「行列Aの...」へ統一置換
  const idPattern = escapeRegExp(String(matrixId));
  const withSpace = new RegExp(`行列\\s*${idPattern}(?=\\s*の|\\s|$)`, "g");
  return message.replace(withSpace, `行列${matrixName}`);
}

/**
 * 表示用行列ブロック（行列のみ横スクロール）。
 * 「追加」は各行列の右側に配置する。
 */
function createMatrixBlock(matrix, matrixName, appendTarget) {
  const block = document.createElement("div");
  block.className = "matrix-block";
  const matrixScroll = document.createElement("div");
  matrixScroll.className = "result-matrix-scroll";
  matrixScroll.appendChild(renderMatrix(matrix, true));
  block.appendChild(matrixScroll);

  if (appendTarget) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "追加";
    btn.className = "matrix-btn result-log-matrix-btn";
    if (matrixName) btn.title = `${matrixName} をワークスペースへ追加`;
    btn.addEventListener("click", () => {
      appendTarget.appendChild(renderGroup(matrix, true, matrixName));
    });
    block.appendChild(btn);
  }

  return block;
}

function renderResultItem(exprStr, item, matricesContainer) {
  const resultGroup = document.createElement("div");
  resultGroup.classList.add("result-group");

  const body = document.createElement("div");
  body.className = "result-group-body";

  const toolbar = document.createElement("div");
  toolbar.className = "result-group-toolbar";

  switch (item.type) {
    case "scalar":
      body.appendChild(createTextDiv(`${exprStr} = ${item.value}`));
      break;

    case "matrix":
      body.appendChild(createTextDiv(`${exprStr} =`));
      body.appendChild(createMatrixBlock(item.values, "Result", matricesContainer));
      break;

    case "error":
      resultGroup.classList.add("error");
      body.appendChild(
        createTextDiv(
          `${exprStr} → ${formatErrorMessageWithMatrixName(item.message, item.matrixId)}${item.code ? ` [${item.code}]` : ""}`
        )
      );
      break;

    case "eig":
      if (
        Array.isArray(item.eigenvalues) &&
        Array.isArray(item.eigenvectors) &&
        item.eigenvectors.length > 0 &&
        item.eigenvectors.every((vec) => Array.isArray(vec))
      ) {
        body.appendChild(createTextDiv(`${exprStr} = 固有値: ${item.eigenvalues.join(", ")}`));
        const eigenMatrix = item.eigenvectors[0].map((_, rowIndex) =>
          item.eigenvectors.map((vec) => vec[rowIndex])
        );
        if (is2dMatrix(eigenMatrix)) {
          body.appendChild(createTextDiv("P"));
          body.appendChild(createMatrixBlock(eigenMatrix, "P", matricesContainer));
        } else {
          body.appendChild(createTextDiv(`${exprStr} → 固有ベクトルの形式が不正です`));
        }
      } else {
        body.appendChild(createTextDiv(`${exprStr} → 固有値分解の結果形式が不正です`));
      }
      break;

    case "QR":
      body.appendChild(createTextDiv(exprStr));
      body.appendChild(createTextDiv("Q"));
      body.appendChild(createMatrixBlock(item.Q, "Q", matricesContainer));
      body.appendChild(createTextDiv("R"));
      body.appendChild(createMatrixBlock(item.R, "R", matricesContainer));
      break;

    case "LU":
      body.appendChild(createTextDiv(exprStr));
      body.appendChild(createTextDiv("L"));
      body.appendChild(createMatrixBlock(item.L, "L", matricesContainer));
      body.appendChild(createTextDiv("U"));
      body.appendChild(createMatrixBlock(item.U, "U", matricesContainer));
      break;

    case "SVD":
      body.appendChild(createTextDiv(exprStr));
      body.appendChild(createTextDiv("U"));
      body.appendChild(createMatrixBlock(item.U, "U", matricesContainer));
      body.appendChild(createTextDiv("Σ"));
      body.appendChild(createMatrixBlock(item.S, "S", matricesContainer));
      body.appendChild(createTextDiv("V"));
      body.appendChild(createMatrixBlock(item.V, "V", matricesContainer));
      break;

    case "jord":
      body.appendChild(createTextDiv(exprStr));
      body.appendChild(createTextDiv("P"));
      body.appendChild(createMatrixBlock(item.P, "P", matricesContainer));
      body.appendChild(createTextDiv("J"));
      body.appendChild(createMatrixBlock(item.J, "J", matricesContainer));
      break;

    default:
      body.appendChild(createTextDiv(`${exprStr} は不明な結果形式 (${item.type})`));
      break;
  }

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.textContent = "x";
  deleteBtn.className = "icon-btn delete-btn result-log-delete-btn";
  deleteBtn.setAttribute("aria-label", "この結果を削除");
  deleteBtn.addEventListener("click", () => {
    resultGroup.remove();
  });
  toolbar.appendChild(deleteBtn);

  /* 本文を先に（式が上）。ツールバーは CSS で右上固定（本文の横スクロールの対象外） */
  resultGroup.appendChild(body);
  resultGroup.appendChild(toolbar);
  resultGroup.appendChild(createTimestampDiv());

  return resultGroup;
}

export function displayResult(tokensData, result, matricesContainer, resultLog) {
  const exprStr = tokensData.map((t) => t.content).join(" ");
  const item = renderResultItem(exprStr, result, matricesContainer);
  const firstResultGroup = resultLog.querySelector(".result-group");
  if (firstResultGroup) {
    resultLog.insertBefore(item, firstResultGroup);
    return;
  }
  resultLog.appendChild(item);
}
