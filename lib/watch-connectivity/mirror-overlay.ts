type MirrorSvg = { toDataURL: (callback: (data: string) => void, options?: object) => void };

/** Capture the actual display SVG, including its current dropout/mask/colors. */
export function captureWatchMirrorOverlay(
  svg: MirrorSvg | null,
  viewport: { width: number; height: number },
  maxWidth: number,
): Promise<string | undefined> {
  if (!svg) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const deadline = performance.now() + 500;
    const timer = setTimeout(() => reject(new Error('Watch overlay capture timed out')), 500);
    try {
      svg.toDataURL((data) => {
        clearTimeout(timer);
        // Completion can arrive before an overdue timer on a stalled JS thread.
        if (performance.now() >= deadline) {
          reject(new Error('Watch overlay capture timed out'));
          return;
        }
        resolve(data);
      }, {
        width: maxWidth,
        height: Math.round(maxWidth * viewport.height / viewport.width),
      });
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}
