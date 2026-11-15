// The suite's shared shell: suite-wide settings taken over from Writer's old keys, per-app
// keymap stores, and each app's UI data through the shared factory.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import writerUi from '../../src/writer/generated/upstream-ui.json';
import calcUi from '../../src/calc/generated/upstream-ui.json';
import { KeymapStore, SHELL_KEYMAP_EDITS, overlayKeymap } from '../../src/shell/keymaps.ts';
import { DEFAULT_KEYMAP, LIBREOFFICE_KEYMAP } from '../../src/writer/keymaps.ts';
import { createAppUi, type UpstreamUi } from '../../src/shell/ui/labels.ts';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

describe('suite settings', () => {
  let store: MemoryStorage;
  beforeEach(() => { store = new MemoryStorage(); vi.stubGlobal('localStorage', store); vi.resetModules(); });
  afterEach(() => vi.unstubAllGlobals());

  it("take over Writer's old key once, and keep it from coming back", async () => {
    store.setItem('writer:author', 'Ada');
    const { suiteKey } = await import('../../src/shell/settings.ts');
    expect(suiteKey('author')).toBe('officetab:author');
    expect(store.getItem('officetab:author')).toBe('Ada');
    expect(store.getItem('writer:author')).toBeNull();
    store.setItem('officetab:author', 'Grace');
    expect(store.getItem(suiteKey('author'))).toBe('Grace');
  });

  it('prefer a suite key already set over an old one', async () => {
    store.setItem('writer:icon-theme', 'colibre');
    store.setItem('officetab:icon-theme', 'fluent');
    const { suiteKey } = await import('../../src/shell/settings.ts');
    expect(store.getItem(suiteKey('icon-theme'))).toBe('fluent');
  });
});

describe('per-app keymaps', () => {
  it("keep Writer's map under its own key, and another app's under its own", () => {
    const s = new MemoryStorage();
    const calcDefault = overlayKeymap({ ...(calcUi.shortcuts as Record<string, string>) }, SHELL_KEYMAP_EDITS);
    const calc = new KeymapStore(s, { ids: ['default'], maps: { default: calcDefault } }, 'calc:keymap');
    calc.bind('Q_MOD1_MOD2', '.uno:Bold');
    expect(s.data.has('calc:keymap')).toBe(true);
    expect(s.data.has('writer:keymap')).toBe(false);
    expect(DEFAULT_KEYMAP.S_SHIFT_MOD1).toBe('.uno:ExportTo');
    expect(LIBREOFFICE_KEYMAP.S_SHIFT_MOD1).toBe('.uno:SaveAs');
  });
});

describe('app UI data', () => {
  const store = (ui: UpstreamUi) => new KeymapStore(null, { ids: ['default'], maps: { default: overlayKeymap(ui.shortcuts, SHELL_KEYMAP_EDITS) } }, 'x:keymap');
  for (const [name, json] of [['writer', writerUi], ['calc', calcUi]] as const) {
    it(`${name}: the File menu has the shell's entries and the Window menu is Menu`, () => {
      const ui = createAppUi(json as UpstreamUi, store(json as UpstreamUi));
      const file = ui.menubar.find((m) => m.cmd === '.uno:PickList')!;
      const cmds = file.items!.map((i) => i.cmd);
      expect(cmds).toContain('app:SaveVersion');
      expect(cmds).toContain('.uno:ExportTo');
      expect(cmds).not.toContain('.uno:Quit');
      expect(ui.menubar.some((m) => m.cmd === 'app:MenuMode')).toBe(true);
      expect(ui.notebookbar.length).toBeGreaterThan(3);
      expect(ui.shortcutText('.uno:Save')).not.toBe('');
    });
  }
});
