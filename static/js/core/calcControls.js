export function setCalcButtonsStopMode(buttons, isStopMode) {
  buttons.forEach((btn) => {
    btn.textContent = isStopMode ? "停止" : "=";
    btn.classList.toggle("is-stop", isStopMode);
    btn.setAttribute("aria-label", isStopMode ? "計算停止" : "計算");
  });
}

export function createRunOrCancelHandler(calcRunner, options = {}) {
  const { confirmMessage = "計算を停止しますか？", runAction } = options;
  const run = typeof runAction === "function" ? runAction : () => calcRunner.run();
  return async () => {
    if (calcRunner.isRunning()) {
      const shouldStop = window.confirm(confirmMessage);
      if (!shouldStop) return;
      calcRunner.cancel();
      return;
    }
    await run();
  };
}
