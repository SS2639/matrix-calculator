const UI_STORAGE_KEY = "matrixCalc.ui.preference";
const VALID_UI_MODES = new Set(["desktop", "mobile"]);

function getQueryUiMode() {
  const params = new URLSearchParams(window.location.search);
  const ui = (params.get("ui") || "").trim().toLowerCase();
  return VALID_UI_MODES.has(ui) ? ui : null;
}

function getCurrentUiMode() {
  const ui = (document.body?.dataset.uiMode || "").trim().toLowerCase();
  return VALID_UI_MODES.has(ui) ? ui : null;
}

function buildSwitchUrl(targetUi) {
  const url = new URL(window.location.href);
  url.searchParams.set("ui", targetUi);
  return url.toString();
}

function getSavedUiMode() {
  try {
    const saved = (window.localStorage.getItem(UI_STORAGE_KEY) || "").trim().toLowerCase();
    return VALID_UI_MODES.has(saved) ? saved : null;
  } catch {
    return null;
  }
}

function saveUiMode(uiMode) {
  try {
    window.localStorage.setItem(UI_STORAGE_KEY, uiMode);
  } catch {
    // localStorage が使えない環境では保存をスキップする。
  }
}

function applySavedPreferenceIfNeeded() {
  const queryUi = getQueryUiMode();
  if (queryUi) return;

  const currentUi = getCurrentUiMode();
  const savedUi = getSavedUiMode();
  if (!currentUi || !savedUi || savedUi === currentUi) return;
  window.location.replace(buildSwitchUrl(savedUi));
}

function initSwitchButtons() {
  const currentUi = getCurrentUiMode();
  const buttons = document.querySelectorAll("[data-ui-switch-target]");
  buttons.forEach((button) => {
    const targetUi = (button.getAttribute("data-ui-switch-target") || "").trim().toLowerCase();
    if (!VALID_UI_MODES.has(targetUi)) return;
    if (currentUi && targetUi === currentUi) {
      button.disabled = true;
      return;
    }
    button.addEventListener("click", () => {
      saveUiMode(targetUi);
      window.location.assign(buildSwitchUrl(targetUi));
    });
  });
}

applySavedPreferenceIfNeeded();
initSwitchButtons();
