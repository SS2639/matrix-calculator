const HELP_CONTENT_URL = "/static/help.html";

export function initHelp() {
  const helpOverlay = document.getElementById("helpOverlay");
  const helpBtn = document.querySelector(".help-btn");
  const helpClose = document.querySelector(".help-close");
  const helpContent = document.querySelector(".help-content");

  if (!helpOverlay || !helpContent) return;
  let lastFocusedElement = null;
  const focusableSelectors = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  // ヘルプ本文を別ファイルから読み込む
  fetch(HELP_CONTENT_URL)
    .then((res) => (res.ok ? res.text() : Promise.reject(new Error("Failed to load help"))))
    .then((html) => {
      helpContent.innerHTML = html;
    })
    .catch(() => {
      helpContent.textContent = "ヘルプを読み込めませんでした。";
    });

  function openHelp() {
    lastFocusedElement = document.activeElement;
    helpOverlay.classList.add("is-open");
    helpOverlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("help-open");
    helpClose?.focus({ preventScroll: true });
  }

  function closeHelp() {
    helpOverlay.classList.remove("is-open");
    helpOverlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("help-open");
    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
      lastFocusedElement.focus({ preventScroll: true });
    }
  }

  if (helpBtn) helpBtn.addEventListener("click", openHelp);
  if (helpClose) helpClose.addEventListener("click", closeHelp);

  helpOverlay.addEventListener("click", (e) => {
    if (e.target === helpOverlay) closeHelp();
  });

  document.addEventListener("keydown", (e) => {
    if (!helpOverlay.classList.contains("is-open")) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeHelp();
      return;
    }
    if (e.key !== "Tab") return;
    const focusables = Array.from(helpOverlay.querySelectorAll(focusableSelectors))
      .filter((el) => !el.hasAttribute("disabled"));
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}
