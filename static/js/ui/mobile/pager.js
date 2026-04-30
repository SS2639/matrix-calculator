const SWIPE_THRESHOLD_RATIO = 0.2;

export function createMobilePager({ viewport, track, indicator, prevBtn, nextBtn }) {
  let currentIndex = 0;
  let pointerStartX = null;
  let pointerStartY = null;
  let isAnimating = false;

  function getPages() {
    return Array.from(track.querySelectorAll(".mobile-matrix-page"));
  }

  function updateIndicator() {
    const total = getPages().length;
    const visibleIndex = total === 0 ? 0 : currentIndex + 1;
    indicator.textContent = `${visibleIndex}/${total}`;
    prevBtn.disabled = total <= 1 || currentIndex <= 0;
    nextBtn.disabled = total <= 1 || currentIndex >= total - 1;
  }

  function syncCurrentIndexFromScroll() {
    const pageWidth = viewport.clientWidth;
    if (!pageWidth) return;
    const total = getPages().length;
    const nextIndex = Math.round(viewport.scrollLeft / pageWidth);
    currentIndex = Math.max(0, Math.min(total - 1, nextIndex));
    updateIndicator();
  }

  function animateScrollTo(targetLeft, durationMs = 200) {
    if (isAnimating) return;
    const startLeft = viewport.scrollLeft;
    const delta = targetLeft - startLeft;
    if (Math.abs(delta) < 1) {
      viewport.scrollLeft = targetLeft;
      return;
    }
    const startedAt = performance.now();
    isAnimating = true;
    const tick = (now) => {
      const elapsed = now - startedAt;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = 1 - (1 - progress) * (1 - progress);
      viewport.scrollLeft = startLeft + delta * eased;
      if (progress < 1) {
        requestAnimationFrame(tick);
        return;
      }
      viewport.scrollLeft = targetLeft;
      isAnimating = false;
    };
    requestAnimationFrame(tick);
  }

  function goToIndex(index, smooth = true) {
    const pages = getPages();
    if (pages.length === 0) {
      currentIndex = 0;
      updateIndicator();
      return;
    }
    const bounded = Math.max(0, Math.min(pages.length - 1, index));
    currentIndex = bounded;
    const left = viewport.clientWidth * bounded;
    if (smooth) animateScrollTo(left, 200);
    else viewport.scrollLeft = left;
    updateIndicator();
  }

  function wrapGroup(group) {
    group.querySelectorAll(".matrix-menu-item").forEach((item) => {
      if (item.textContent?.trim() === "複製") item.remove();
    });
    const page = document.createElement("div");
    page.className = "mobile-matrix-page";
    page.appendChild(group);
    track.appendChild(page);
  }

  function addMatrixGroup(group) {
    wrapGroup(group);
    goToIndex(getPages().length - 1, true);
  }

  function removeEmptyPages() {
    const pages = getPages();
    const removedPageIndices = [];
    pages.forEach((page, index) => {
      if (page.querySelector(".matrix-group")) return;
      removedPageIndices.push(index);
      page.remove();
    });
    return removedPageIndices;
  }

  function refreshAfterMutation(removedPageIndices = []) {
    const pages = getPages();
    if (pages.length === 0) {
      currentIndex = 0;
      updateIndicator();
      return;
    }
    const deletedCurrent = removedPageIndices.includes(currentIndex);
    if (!deletedCurrent) {
      currentIndex = Math.min(currentIndex, pages.length - 1);
      goToIndex(currentIndex, false);
      return;
    }
    const movedTo = currentIndex < pages.length ? currentIndex : pages.length - 1;
    goToIndex(movedTo, true);
  }

  prevBtn.addEventListener("click", () => goToIndex(currentIndex - 1, true));
  nextBtn.addEventListener("click", () => goToIndex(currentIndex + 1, true));
  viewport.addEventListener("scroll", syncCurrentIndexFromScroll);

  viewport.addEventListener("pointerdown", (e) => {
    pointerStartX = e.clientX;
    pointerStartY = e.clientY;
  });
  viewport.addEventListener("pointerup", (e) => {
    if (pointerStartX == null || pointerStartY == null) return;
    const dx = e.clientX - pointerStartX;
    const dy = e.clientY - pointerStartY;
    pointerStartX = null;
    pointerStartY = null;
    if (Math.abs(dy) > Math.abs(dx)) return;
    const threshold = viewport.clientWidth * SWIPE_THRESHOLD_RATIO;
    if (Math.abs(dx) < threshold) {
      goToIndex(currentIndex, true);
      return;
    }
    if (dx < 0) goToIndex(currentIndex + 1, true);
    else goToIndex(currentIndex - 1, true);
  });

  new MutationObserver((records) => {
    const removedIndices = [];
    records.forEach((record) => {
      if (record.type !== "childList" || record.removedNodes.length === 0) return;
      Array.from(record.removedNodes).forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (!node.classList.contains("mobile-matrix-page")) return;
        const idx = Number(node.dataset.pageIndexBeforeRemove);
        if (Number.isInteger(idx)) removedIndices.push(idx);
      });
    });
    const emptiedIndices = removeEmptyPages();
    refreshAfterMutation([...removedIndices, ...emptiedIndices]);
  }).observe(track, { childList: true, subtree: true });

  updateIndicator();

  return {
    addMatrixGroup,
    reindexPages: () => {
      getPages().forEach((page, index) => {
        page.dataset.pageIndexBeforeRemove = String(index);
      });
      updateIndicator();
    },
    markPageIndicesBeforeMutation: () => {
      getPages().forEach((page, index) => {
        page.dataset.pageIndexBeforeRemove = String(index);
      });
    },
  };
}
