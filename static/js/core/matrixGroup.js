import { addRow, removeRow, addCol, removeCol } from "./matrixLogic.js";

let matrixCount = 0;
const MATRIX_CELL_MAX_LENGTH = 24;
const MATRIX_CELL_MIN_CH = 6;
const MATRIX_CELL_MAX_CH = 18;
let tokenManagerRef = null;

function normalizeRenderOptions(options = {}) {
  return {
    enableEnterCellNavigation: options.enableEnterCellNavigation === true,
  };
}

export function setTokenManager(manager) {
  tokenManagerRef = manager;
}

function fitMatrixCellWidth(input) {
  const nextCh = Math.min(
    MATRIX_CELL_MAX_CH,
    Math.max(MATRIX_CELL_MIN_CH, (input.value ?? "").length + 1)
  );
  input.style.width = `${nextCh}ch`;
}

function setupMatrixCellInput(input) {
  input.maxLength = MATRIX_CELL_MAX_LENGTH;
  fitMatrixCellWidth(input);
  const table = input.closest("table");
  const enableEnterCellNavigation = table?.dataset.enableEnterCellNavigation === "1";
  if (input.dataset.autosizeBound !== "1") {
    input.addEventListener("input", () => fitMatrixCellWidth(input));
    input.dataset.autosizeBound = "1";
  }
  if (enableEnterCellNavigation && input.dataset.enterNavBound !== "1") {
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;

      const currentTd = input.closest("td");
      const currentTr = input.closest("tr");
      const table = input.closest("table");
      if (!currentTd || !currentTr || !table) return;

      const rowIndex = currentTr.rowIndex;
      const colIndex = currentTd.cellIndex;
      const rows = table.rows;
      const currentRow = rows[rowIndex];
      if (!currentRow) return;

      let nextInput = null;
      if (colIndex + 1 < currentRow.cells.length) {
        nextInput = currentRow.cells[colIndex + 1]?.querySelector("input[type=text]");
      } else if (rowIndex + 1 < rows.length) {
        nextInput = rows[rowIndex + 1]?.cells[0]?.querySelector("input[type=text]");
      }

      if (!nextInput) return;
      e.preventDefault();
      nextInput.focus({ preventScroll: true });
      nextInput.select();
    });
    input.dataset.enterNavBound = "1";
  }
}

function refreshAllMatrixCellInputs(table) {
  table.querySelectorAll("input[type=text]").forEach((input) => {
    setupMatrixCellInput(input);
  });
}

/** 他の行列ブロックで使っている名前（trim 済み）を集める */
function collectOtherMatrixNames(excludeMatrixId) {
  const names = new Set();
  document.querySelectorAll(".matrix-group").forEach((g) => {
    if (g.dataset.matrixId === excludeMatrixId) return;
    const inp = g.querySelector(".matrix-name");
    if (inp && inp.value.trim() !== "") names.add(inp.value.trim());
  });
  return names;
}

/**
 * 他と重複しない名前にする。空なら M{id} をベースにする。
 * 重複時は base_2, base_3, … を試す。
 */
function makeUniqueMatrixName(desired, excludeMatrixId) {
  let base = (desired ?? "").trim();
  if (base === "") base = `M${excludeMatrixId}`;
  const others = collectOtherMatrixNames(excludeMatrixId);
  if (!others.has(base)) return base;
  let n = 2;
  let candidate = `${base}_${n}`;
  while (others.has(candidate)) {
    n++;
    candidate = `${base}_${n}`;
  }
  return candidate;
}

export function renderMatrix(matrix, readOnly = false, options = {}) {
  const renderOptions = normalizeRenderOptions(options);
  const table = document.createElement("table");
  table.className = "matrix-table";
  table.dataset.enableEnterCellNavigation = renderOptions.enableEnterCellNavigation ? "1" : "0";

  const fragment = document.createDocumentFragment();
  matrix.forEach(row => {
    const tr = document.createElement("tr");
    row.forEach(cell => {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.type = "text";
      input.value = cell;
      setupMatrixCellInput(input);
      input.disabled = readOnly;
      td.appendChild(input);
      tr.appendChild(td);
    });
    fragment.appendChild(tr);
  });
  table.appendChild(fragment);

  return table;
}

export function renderGroup(matrix, readOnly = false, matrixName = "", options = {}) {
  const renderOptions = normalizeRenderOptions(options);
  matrixCount++;
  const group = document.createElement("div");
  group.className = "matrix-group";
  group.dataset.matrixId = matrixCount;
  group.classList.toggle("read-only", readOnly);
  const initialMatrixName = makeUniqueMatrixName(matrixName, group.dataset.matrixId);

  // 名前入力
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = initialMatrixName;
  nameInput.className = "matrix-name";
  nameInput.addEventListener("change", () => {
    const unique = makeUniqueMatrixName(nameInput.value, group.dataset.matrixId);
    if (unique !== nameInput.value) nameInput.value = unique;
    tokenManagerRef?.updateMatrixName(group.dataset.matrixId, unique);
  });
  if (readOnly) nameInput.disabled = true;

  // マトリックス（表本体のみ横スクロール対象にする）
  const matrixTable = renderMatrix(matrix, readOnly, renderOptions);
  const matrixTableScroll = document.createElement("div");
  matrixTableScroll.className = "matrix-table-scroll";
  matrixTableScroll.appendChild(matrixTable);

  // ボタン作成ヘルパー
  const makeBtn = (label, className, onClick) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.classList.add(...className.split(" "));
    btn.addEventListener("click", onClick);
    return btn;
  };

  // 行・列操作ボタン
  const rowsCtrl = document.createElement("div");
  rowsCtrl.className = "rows-control";
  rowsCtrl.append(
    makeBtn("+", "add-row-btn", () => {
      addRow(matrixTable);
      refreshAllMatrixCellInputs(matrixTable);
    }),
    makeBtn("-", "remove-row-btn", () => removeRow(matrixTable))
  );
  rowsCtrl.querySelectorAll("button").forEach(btn => btn.disabled = readOnly);

  const colsCtrl = document.createElement("div");
  colsCtrl.className = "cols-control";
  colsCtrl.append(
    makeBtn("+", "add-col-btn", () => {
      addCol(matrixTable);
      refreshAllMatrixCellInputs(matrixTable);
    }),
    makeBtn("-", "remove-col-btn", () => removeCol(matrixTable))
  );
  colsCtrl.querySelectorAll("button").forEach(btn => btn.disabled = readOnly);

  const tokenBtn = makeBtn("+", "icon-btn token-btn", () =>
    tokenManagerRef?.addToken(nameInput.value, "matrix", group.dataset.matrixId)
  );
  const setReadOnlyState = (nextReadOnly) => {
    group.classList.toggle("read-only", nextReadOnly);
    nameInput.disabled = nextReadOnly;
    matrixTable.querySelectorAll("input").forEach(input => (input.disabled = nextReadOnly));
    rowsCtrl.querySelectorAll("button").forEach(btn => (btn.disabled = nextReadOnly));
    colsCtrl.querySelectorAll("button").forEach(btn => (btn.disabled = nextReadOnly));
    lockMenuItem.textContent = nextReadOnly ? "ロック解除" : "ロック";
  };

  const actionsCol = document.createElement("div");
  actionsCol.className = "matrix-group-actions";

  const menuWrap = document.createElement("div");
  menuWrap.className = "matrix-menu-wrap";

  const menuTriggerBtn = document.createElement("button");
  menuTriggerBtn.type = "button";
  menuTriggerBtn.className = "icon-btn matrix-menu-trigger";
  menuTriggerBtn.textContent = "⋮";
  menuTriggerBtn.setAttribute("aria-label", "行列メニュー");
  menuTriggerBtn.setAttribute("aria-expanded", "false");
  menuTriggerBtn.title = "行列メニュー";

  const menu = document.createElement("div");
  menu.id = `matrix-menu-${group.dataset.matrixId}`;
  menu.className = "matrix-menu";
  menu.hidden = true;
  menuTriggerBtn.setAttribute("aria-controls", menu.id);

  const makeMenuItem = (label, onClick) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "matrix-menu-item";
    item.textContent = label;
    item.addEventListener("click", (e) => {
      e.preventDefault();
      onClick();
    });
    return item;
  };

  const menuItems = [];
  let globalMenuListenersAttached = false;

  const attachGlobalMenuListeners = () => {
    if (globalMenuListenersAttached) return;
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onDocKeydown, true);
    globalMenuListenersAttached = true;
  };
  const detachGlobalMenuListeners = () => {
    if (!globalMenuListenersAttached) return;
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onDocKeydown, true);
    globalMenuListenersAttached = false;
  };

  const closeMenu = ({ restoreFocus = false } = {}) => {
    menu.hidden = true;
    menuTriggerBtn.setAttribute("aria-expanded", "false");
    detachGlobalMenuListeners();
    if (restoreFocus) menuTriggerBtn.focus({ preventScroll: true });
  };
  const openMenu = () => {
    menu.hidden = false;
    menuTriggerBtn.setAttribute("aria-expanded", "true");
    attachGlobalMenuListeners();
    menuItems[0]?.focus({ preventScroll: true });
  };
  const toggleMenu = ({ restoreFocusOnClose = false } = {}) => {
    if (menu.hidden) openMenu();
    else closeMenu({ restoreFocus: restoreFocusOnClose });
  };

  const deleteMenuItem = makeMenuItem("削除", () => {
    closeMenu();
    group.remove();
  });
  const lockMenuItem = makeMenuItem("", () => {
    setReadOnlyState(!group.classList.contains("read-only"));
    closeMenu();
  });
  const duplicateMenuItem = makeMenuItem("複製", () => {
    const copiedMatrix = Array.from(matrixTable.rows, (row) =>
      Array.from(row.cells, (cell) => {
        const input = cell.querySelector("input");
        return input ? input.value : "";
      })
    );
    const cloned = renderGroup(copiedMatrix, false, nameInput.value, renderOptions);
    const container = group.parentElement;
    if (container) container.prepend(cloned);
    closeMenu();
  });

  menuItems.push(deleteMenuItem, lockMenuItem, duplicateMenuItem);
  menu.append(deleteMenuItem, lockMenuItem, duplicateMenuItem);
  menuWrap.append(menuTriggerBtn, menu);
  actionsCol.append(menuWrap, tokenBtn);

  const onDocClick = (e) => {
    if (!menuWrap.contains(e.target)) closeMenu();
  };
  const onDocKeydown = (e) => {
    if (e.key === "Escape") closeMenu({ restoreFocus: true });
  };
  menuTriggerBtn.addEventListener("click", (e) => {
    e.preventDefault();
    toggleMenu({ restoreFocusOnClose: true });
  });

  setReadOnlyState(readOnly);
  group.append(nameInput, matrixTableScroll, rowsCtrl, colsCtrl, actionsCol);
  return group;
}
