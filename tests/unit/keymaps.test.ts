import { describe, expect, it } from 'vitest';
import ui from '../../src/writer/generated/upstream-ui.json';
import {
  DEFAULT_KEYMAP, KEYMAPS, KEYMAP_TEMPLATES, KeymapStore, LIBREOFFICE_KEYMAP, MS_MAC_KEYMAP, MS_WINDOWS_KEYMAP,
  browserUses, commandForEvent, detectBrowser, eventKeyNames, exportKeymap, importKeymap, isKeyName, keyText, keymapChoice, menuKeys,
  type KeyEventLike,
} from '../../src/writer/keymaps.ts';

const ev = (code: string, key: string, m: Partial<KeyEventLike> = {}): KeyEventLike =>
  ({ code, key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...m });

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

describe('keymap templates', () => {
  it('leaves Shift+Ctrl+R to the browser by default, but not in LibreOffice', () => {
    expect(DEFAULT_KEYMAP.R_SHIFT_MOD1).toBeUndefined();
    expect(LIBREOFFICE_KEYMAP.R_SHIFT_MOD1).toBe('.uno:Ruler');
    expect(DEFAULT_KEYMAP.DIVIDE_MOD1).toBe('.uno:CommandPopup');
  });

  it('opens Find & Replace with Ctrl+F by default, not the browser find bar', () => {
    expect(DEFAULT_KEYMAP.F_MOD1).toBe('.uno:SearchDialog');
    expect(DEFAULT_KEYMAP.H_MOD1).toBe('.uno:SearchDialog');
    expect(LIBREOFFICE_KEYMAP.F_MOD1).toBeUndefined();
  });

  it('are all different and recognised', () => {
    for (const id of KEYMAP_TEMPLATES) expect(keymapChoice({ ...KEYMAPS[id] })).toBe(id);
    expect(keymapChoice({ ...DEFAULT_KEYMAP, Q_MOD1_MOD2: '.uno:Bold' })).toBe('custom');
  });

  it('bind only key names and upstream or application commands', () => {
    const known = new Set(Object.keys(ui.labels));
    for (const id of KEYMAP_TEMPLATES) for (const [k, cmd] of Object.entries(KEYMAPS[id])) {
      expect(isKeyName(k), k).toBe(true);
      expect(cmd.startsWith('app:') || known.has(cmd), `${id} ${k} ${cmd}`).toBe(true);
    }
  });

  it("have Word's keys", () => {
    expect(MS_WINDOWS_KEYMAP.D_MOD1).toBe('.uno:FontDialog');
    expect(MS_WINDOWS_KEYMAP.E_SHIFT_MOD1).toBe('.uno:TrackChanges');
    expect(MS_WINDOWS_KEYMAP.M_MOD1_MOD2).toBe('.uno:InsertAnnotation');
    expect(MS_WINDOWS_KEYMAP.F9_MOD1).toBeUndefined();
    expect(MS_MAC_KEYMAP.A_MOD1_MOD2).toBe('.uno:InsertAnnotation');
    expect(MS_MAC_KEYMAP.D_SHIFT_MOD3).toBe('.uno:InsertDateField');
    expect(MS_MAC_KEYMAP.B_MOD1).toBe('.uno:Bold');
  });
});

describe('key names', () => {
  it('name letters by their place and with modifiers in order', () => {
    expect(eventKeyNames(ev('KeyR', 'R', { shiftKey: true, ctrlKey: true }), false)).toEqual(['R_SHIFT_MOD1']);
    expect(eventKeyNames(ev('KeyR', '®', { altKey: true, metaKey: true }), true)).toEqual(['R_MOD1_MOD2']);
    expect(eventKeyNames(ev('KeyD', 'd', { ctrlKey: true, shiftKey: true }), true)).toEqual(['D_SHIFT_MOD3']);
    expect(eventKeyNames(ev('KeyB', 'b', { metaKey: true }), false)).toEqual([]);
    expect(eventKeyNames(ev('F12', 'F12', { shiftKey: true }), false)).toEqual(['F12_SHIFT']);
  });

  it('name characters by the character first, without its Shift', () => {
    // "/" is Shift+7 on a German keyboard.
    expect(eventKeyNames(ev('Digit7', '/', { shiftKey: true, ctrlKey: true }), false)).toEqual(['7_SHIFT_MOD1', 'DIVIDE_MOD1']);
    expect(commandForEvent(DEFAULT_KEYMAP, ev('Digit7', '/', { shiftKey: true, ctrlKey: true }), false)?.cmd).toBe('.uno:CommandPopup');
    expect(commandForEvent(DEFAULT_KEYMAP, ev('Slash', '/', { ctrlKey: true }), false)?.cmd).toBe('.uno:CommandPopup');
    expect(eventKeyNames(ev('Period', '>', { shiftKey: true, ctrlKey: true }), false)).toEqual(['GREATER_MOD1', 'POINT_SHIFT_MOD1']);
    expect(commandForEvent(MS_WINDOWS_KEYMAP, ev('Period', '>', { shiftKey: true, ctrlKey: true }), false)?.cmd).toBe('.uno:Grow');
    // Shift+Ctrl+- types "_", which has no name of its own: the key's place counts.
    expect(commandForEvent(LIBREOFFICE_KEYMAP, ev('Minus', '_', { shiftKey: true, ctrlKey: true }), false)?.cmd).toBe('.uno:InsertHardHyphen');
    expect(commandForEvent(MS_MAC_KEYMAP, ev('Minus', '–', { altKey: true, metaKey: true }), true)?.cmd).toBe('.uno:InsertSoftHyphen');
  });

  it('show as menus show them', () => {
    expect(keyText('S_SHIFT_MOD1', false)).toBe('Shift+Ctrl+S');
    expect(keyText('S_SHIFT_MOD1', true)).toBe('⇧⌘S');
    expect(keyText('BRACKETLEFT_MOD1', false)).toBe('Ctrl+[');
    expect(keyText('DIVIDE_MOD1', true)).toBe('⌘/');
    expect(menuKeys(DEFAULT_KEYMAP, false).get('.uno:Bold')).toBe('B_MOD1');
    expect(menuKeys(DEFAULT_KEYMAP, false).get('.uno:Ruler')).toBeUndefined();
  });
});

describe('browser keys', () => {
  it('know the browser', () => {
    expect(detectBrowser('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140.0 Safari/537.36')).toBe('chrome');
    expect(detectBrowser('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0')).toBe('edge');
    expect(detectBrowser('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0')).toBe('firefox');
    expect(detectBrowser('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15')).toBe('safari');
  });

  it('warn of reload, and of keys the browser keeps', () => {
    expect(browserUses('R_SHIFT_MOD1', 'chrome', false)).toEqual([{ action: 'hardReload', blocked: false }]);
    expect(browserUses('T_MOD1', 'firefox', true)[0]?.blocked).toBe(true);
    expect(browserUses('C_MOD1_MOD2', 'chrome', true).map((u) => u.action)).toEqual(['devTools']);
    expect(browserUses('C_MOD1_MOD2', 'chrome', false)).toEqual([]);
    expect(browserUses('B_MOD1', 'chrome', false)).toEqual([]);
    expect(browserUses('A_SHIFT_MOD1', 'safari', true)).toEqual([]);
  });
});

describe('keymap files and storage', () => {
  it('export and import', () => {
    const m = { ...DEFAULT_KEYMAP, Q_MOD1_MOD2: '.uno:Bold' };
    expect(importKeymap(exportKeymap(m, 'custom'))).toEqual(m);
    expect(importKeymap('{"B_MOD1": ".uno:Bold"}')).toEqual({ B_MOD1: '.uno:Bold' });
    expect(() => importKeymap('{"b": ".uno:Bold"}')).toThrow();
    expect(() => importKeymap('{"B_MOD1": "javascript:alert(1)"}')).toThrow();
    expect(() => importKeymap('[1]')).toThrow();
  });

  it('keeps the map and the last custom one', () => {
    const s = new MemoryStorage();
    const k = new KeymapStore(s);
    expect(k.choice).toBe('default');
    expect(k.hasCustom).toBe(false);
    k.choose('msWindows');
    expect(k.choice).toBe('msWindows');
    expect(k.bind('Q_MOD1_MOD2', '.uno:Bold')).toBeUndefined();
    expect(k.choice).toBe('custom');
    expect(k.bind('B_MOD1', '.uno:Italic')).toBe('.uno:Bold');
    k.choose('default');
    expect(s.data.has('writer:keymap')).toBe(false);
    const again = new KeymapStore(s);
    expect(again.choice).toBe('default');
    expect(again.hasCustom).toBe(true);
    again.choose('custom');
    expect(again.map.B_MOD1).toBe('.uno:Italic');
    again.unbind('B_MOD1');
    expect(new KeymapStore(s).map.B_MOD1).toBeUndefined();
  });
});
