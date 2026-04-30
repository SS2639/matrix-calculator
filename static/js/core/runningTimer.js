export function startRunningTimer({
  intervalMs = 100,
  format = (elapsedSec) => `実行中: ${elapsedSec.toFixed(1)}秒`,
  onTick,
  onStop,
}) {
  const startedAtMs = Date.now();
  const emit = () => {
    const elapsedSec = (Date.now() - startedAtMs) / 1000;
    onTick?.(format(elapsedSec), elapsedSec);
  };

  emit();
  const timerId = window.setInterval(emit, intervalMs);
  return () => {
    window.clearInterval(timerId);
    onStop?.();
  };
}
