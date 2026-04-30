import { renderGroup, setTokenManager } from '../../core/matrixGroup.js';
import { TokenManager } from '../../core/tokenManager.js';
import { displayResult } from '../../core/displayResult.js';
import { createCalcRunner } from '../../core/calcRunner.js';
import { createRunOrCancelHandler, setCalcButtonsStopMode } from '../../core/calcControls.js';
import { initHelp } from '../../core/help.js';
import { initOperatorTabs } from '../../core/operatorTabs.js';

function resolveMatrixNameById(matrixId) {
  if (!matrixId) return '';
  const selector = `.matrix-group[data-matrix-id="${String(matrixId)}"] .matrix-name`;
  const input = document.querySelector(selector);
  const name = input?.value?.trim() ?? '';
  return name;
}

function showInputError(message) {
  const rl = document.querySelector('.result-log');
  const mc = document.querySelector('.matrices-container');
  if (!rl || !mc) return;
  displayResult(
    tokenManager.getPreviewTokensForDisplay(),
    { type: 'error', message },
    mc,
    rl,
    { resolveMatrixNameById }
  );
}

export const tokenManager = new TokenManager('.expression-bar', {
  onInputError: showInputError,
});
setTokenManager(tokenManager);

const expressionBarEl = document.querySelector('.expression-bar');
const clearBtn = document.querySelector('.clear-btn');
const backspaceBtn = document.querySelector('.desktop-backspace-btn');
clearBtn?.addEventListener('click', () => {
  tokenManager.clearAll();
  expressionBarEl?.focus({ preventScroll: true });
});
backspaceBtn?.addEventListener('click', () => {
  tokenManager.deletePrevToken();
  expressionBarEl?.focus({ preventScroll: true });
});

// DOM要素取得
const addMatrixBtn = document.querySelector('.add-matrix-btn');
const matricesContainer = document.querySelector('.matrices-container');

// 初期行列追加
window.addEventListener('DOMContentLoaded', () => {
  if (addMatrixBtn) addMatrixBtn.click();
});

// 行列追加ボタン
if (addMatrixBtn && matricesContainer) {
  addMatrixBtn.addEventListener('click', () => {
    const zeroMatrix = Array.from({ length: 3 }, () =>
      Array.from({ length: 3 }, () => '0')
    );
    matricesContainer.prepend(renderGroup(zeroMatrix, false, ''));
  });
}

function handleOpClick(op, typeHint, btn) {
  const type =
    typeHint ||
    (Array.from(btn.classList).find((c) => c !== 'op-btn') ?? 'operation-func');
  tokenManager.insertFromPad(op, type);
}

/** 演算子・計算ボタン（委譲：クイック行複製分も対象） */
function initOperatorPadDelegation() {
  const operatorPad = document.querySelector('.operator-pad');
  if (!operatorPad) return;

  operatorPad.addEventListener('click', (e) => {
    const calc = e.target.closest('.calc-btn');
    if (calc) {
      e.preventDefault();
      runCalc();
      return;
    }
    const btn = e.target.closest('.op-btn');
    if (!btn || !operatorPad.contains(btn)) return;
    const op = btn.getAttribute('data-op') ?? '';
    const typeHint = Array.from(btn.classList).find(
      (c) =>
        c !== 'op-btn' &&
        (c === 'binary-op' ||
          c === 'operation-func' ||
          c === 'analysis-func' ||
          c === 'scalar-op-btn' ||
          c === 'paren')
    );
    handleOpClick(op, typeHint, btn);
  });
}

// DOM 構築後
initOperatorTabs();
initOperatorPadDelegation();

initHelp();

// 計算ボタン（フルパッド・クイック行の両方は委譲で処理）
const resultLog = document.querySelector('.result-log');
const calcRunner = createCalcRunner({
  tokenManager,
  matricesContainer,
  resultLog,
  resolveMatrixNameById,
  onRunStateChange: (state) => {
    const isStopMode = state === 'running' || state === 'cancelling';
    setCalcButtonsStopMode(Array.from(document.querySelectorAll('.calc-btn')), isStopMode);
  },
});

const runCalc = createRunOrCancelHandler(calcRunner);

/** `=` キーで計算（行列セル等の INPUT では無効） */
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (document.body.classList.contains('help-open')) return;
  if (e.key !== '=') return;
  e.preventDefault();
  runCalc();
});
