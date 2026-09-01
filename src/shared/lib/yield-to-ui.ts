/**
 * Defers to the next event-loop turn — used at the START of a mutation's
 * async DB work, AFTER its optimistic cache update has already run
 * synchronously in `onMutate`. Without this, awaiting straight into a
 * `db.transaction(...)` call can starve the JS thread before React ever
 * gets a chance to actually PAINT the pending state change: `await`ing a
 * promise only yields a microtask turn, which isn't guaranteed to be enough
 * for React Native's rendering pipeline to flush a frame, so the UI can
 * appear to sit frozen until the (possibly slow) DB round-trip resolves —
 * even though the optimistic update was applied first in code order. A
 * macrotask via `setTimeout` forces a real yield back to the event loop in
 * between, so the optimistic UI update actually reaches the screen before
 * the DB write is even started.
 */
export function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Runs `run` after the frame currently being built has actually painted.
 *
 * `yieldToUI` above buys a paint for work that is ALREADY async; this is for
 * the other case — a synchronous, expensive state update you want to happen
 * strictly after a cheap one has reached the screen. React batches every
 * `setState` in a tick into one commit, so a cheap local update and an
 * expensive global one issued together are painted together, at the expensive
 * one's cost. Deferring the expensive half through here splits them into two
 * commits, so the cheap one is on screen while the expensive one is still
 * being rendered.
 *
 * `rAF` gets us to the frame boundary; the nested `setTimeout` puts the work
 * in a fresh macrotask AFTER it, so it can't extend the frame it was waiting
 * on — a plain `rAF(run)` still runs inside that frame's JS work and would
 * delay the very paint it was supposed to follow.
 */
export function afterPaint(run: () => void): void {
  requestAnimationFrame(() => setTimeout(run, 0));
}
