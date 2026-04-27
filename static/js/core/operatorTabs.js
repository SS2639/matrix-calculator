export function initOperatorTabs({
  tabSelector = ".op-tab-btn",
  panelSelector = ".operator-tab-panel",
  tabAttr = "data-tab",
  panelAttr = "data-panel",
} = {}) {
  const tabs = document.querySelectorAll(tabSelector);
  const panels = document.querySelectorAll(panelSelector);
  if (tabs.length === 0 || panels.length === 0) return;

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const id = tab.getAttribute(tabAttr);
      tabs.forEach((t) => {
        const on = t.getAttribute(tabAttr) === id;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });
      panels.forEach((p) => {
        const on = p.getAttribute(panelAttr) === id;
        p.classList.toggle("is-active", on);
      });
    });
  });
}
