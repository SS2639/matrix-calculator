export function initMobileOperatorPad(tokenManager, runCalc) {
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
