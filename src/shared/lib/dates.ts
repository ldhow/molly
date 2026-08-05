/** Local-timezone YYYY-MM-DD for an epoch-ms timestamp. */
export function toLocalDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Add `delta` days to a YYYY-MM-DD string (local, DST-safe via noon anchor). */
export function addDays(localDate: string, delta: number): string {
  const [y, m, d] = localDate.split("-").map(Number);
  const anchor = new Date(y, m - 1, d, 12);
  anchor.setDate(anchor.getDate() + delta);
  return toLocalDate(anchor.getTime());
}

/** MM:SS (or H:MM:SS above an hour) for a countdown. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "1h 20m" / "45m" for stat displays. */
export function formatMinutes(totalMinutes: number): string {
  const min = Math.round(totalMinutes);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
