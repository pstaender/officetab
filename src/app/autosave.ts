// When autosave stores a change: at once for a document that stores quickly; for one that takes
// long to store (each store writes it all), once typing pauses (a debounce), yet while typing goes
// on at least every SAVE_MAX_WAIT_MS (a throttle), so that no long stretch of work stays unstored.

/** An autosave taking longer than this makes the next ones wait for a pause in typing. */
export const SLOW_SAVE_MS = 60;
/** The pause in typing autosave waits for then. */
export const SAVE_PAUSE_MS = 1000;
/** The longest autosave waits for a pause: while typing goes on, it stores this often. */
export const SAVE_MAX_WAIT_MS = 10_000;

/**
 * The delay before storing, after a change at `now`: `lastSaveMs` is how long the last store
 * took, `pendingSince` when the oldest change not stored yet was made.
 */
export function AutosaveDelay(lastSaveMs: number, pendingSince: number, now: number): number {
  if (lastSaveMs <= SLOW_SAVE_MS) return 0;
  return Math.max(0, Math.min(SAVE_PAUSE_MS, pendingSince + SAVE_MAX_WAIT_MS - now));
}
