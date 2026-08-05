import { GRACE_MS } from "../constants";
import type { ActiveSession, ForegroundJudgment } from "../types";

/**
 * Pure, timestamp-based session judgments. JS timers are throttled or
 * suspended in the background, so nothing here relies on intervals having
 * fired — every decision derives from `now` versus stored timestamps.
 */

export function plannedEndOf(session: ActiveSession): number {
  return session.startedAt + session.plannedMinutes * 60_000;
}

export function isFinished(session: ActiveSession, now: number): boolean {
  return now >= plannedEndOf(session);
}

export function progressOf(session: ActiveSession, now: number): number {
  const total = session.plannedMinutes * 60_000;
  return Math.min(1, Math.max(0, (now - session.startedAt) / total));
}

export function secondsLeftOf(session: ActiveSession, now: number): number {
  return Math.max(0, Math.ceil((plannedEndOf(session) - now) / 1000));
}

/**
 * Judge a session when the app returns to the foreground.
 * Order matters:
 *  1. finished before leaving → completed
 *  2. away within grace → continue (fish survives)
 *  3. away too long → failed
 */
export function judgeForeground(
  session: ActiveSession,
  now: number,
  graceMs: number = GRACE_MS,
): ForegroundJudgment {
  if (session.backgroundedAt === null) {
    return isFinished(session, now)
      ? { kind: "completed" }
      : { kind: "continue", clearBackgrounded: false };
  }
  if (session.backgroundedAt >= plannedEndOf(session)) {
    return { kind: "completed" };
  }
  if (now - session.backgroundedAt <= graceMs) {
    return { kind: "continue", clearBackgrounded: true };
  }
  return { kind: "failed" };
}

/**
 * Judge an orphaned snapshot on cold launch (app was killed).
 * With a recorded `backgroundedAt` the normal foreground rules apply; a
 * missing one means the app crashed while foregrounded — be lenient only if
 * the planned time had already elapsed.
 */
export function judgeColdStart(
  session: ActiveSession,
  now: number,
  graceMs: number = GRACE_MS,
): ForegroundJudgment {
  if (session.backgroundedAt !== null) {
    return judgeForeground(session, now, graceMs);
  }
  return isFinished(session, now) ? { kind: "completed" } : { kind: "failed" };
}
