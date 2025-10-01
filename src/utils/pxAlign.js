export function pxAlign(element, options = {}) {
  if (!element) {
    return;
  }

  const {
    width = 320,
    height = 40,
    radius = 20,
    scaleFactor,
  } = options;

  const deviceScale = typeof scaleFactor === "number" ? scaleFactor : window.devicePixelRatio || 1;
  const align = (value) => Math.round(value * deviceScale) / deviceScale;

  const alignedWidth = align(width);
  const alignedHeight = align(height);
  const alignedRadius = align(radius);

  element.style.width = `${alignedWidth}px`;
  element.style.height = `${alignedHeight}px`;
  element.style.borderRadius = `${alignedRadius}px`;
  element.style.setProperty("--capsule-width", `${alignedWidth}px`);
  element.style.setProperty("--capsule-height", `${alignedHeight}px`);
  element.style.setProperty("--capsule-radius", `${alignedRadius}px`);
  element.style.setProperty(
    "--capsule-shadow-blur",
    `min(24px, ${Math.max(8, Math.round(alignedHeight * 0.6))}px)`
  );
}

export function getAlignmentMetrics() {
  const deviceScale = window.devicePixelRatio || 1;
  return {
    scaleFactor: deviceScale,
  };
}
