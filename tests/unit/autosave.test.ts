import { describe, expect, it } from 'vitest';
import { AutosaveDelay, SAVE_MAX_WAIT_MS, SAVE_PAUSE_MS } from '../../src/app/autosave.ts';

describe('autosave timing', () => {
  it('stores a document that stores quickly at once', () => {
    expect(AutosaveDelay(20, 1000, 1000)).toBe(0);
  });

  it('waits for a pause in typing when storing takes long', () => {
    expect(AutosaveDelay(250, 1000, 1000)).toBe(SAVE_PAUSE_MS);
    // Each key starts the pause anew...
    expect(AutosaveDelay(250, 1000, 1500)).toBe(SAVE_PAUSE_MS);
  });

  it('but stores at least every SAVE_MAX_WAIT_MS while typing goes on', () => {
    expect(AutosaveDelay(250, 1000, 1000 + SAVE_MAX_WAIT_MS - 300)).toBe(300);
    expect(AutosaveDelay(250, 1000, 1000 + SAVE_MAX_WAIT_MS + 50)).toBe(0);
  });
});
