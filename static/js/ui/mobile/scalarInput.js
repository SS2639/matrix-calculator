export function createScalarCommitter({ tokenManager, scalarInput, scalarError }) {
  function showScalarError(message) {
    if (!scalarError) return;
    scalarError.textContent = message || "";
  }

  function commitScalarFromInput() {
    const value = String(scalarInput?.value ?? "");
    if (!value) {
      showScalarError("");
      return { ok: false, reason: "EMPTY" };
    }
    showScalarError("");
    tokenManager.addToken(value, "scalar");
    scalarInput.value = "";
    return { ok: true };
  }

  return { commitScalarFromInput, showScalarError };
}
