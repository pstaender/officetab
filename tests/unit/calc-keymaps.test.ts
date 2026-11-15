import { describe, expect, it } from 'vitest';
import ui from '../../src/calc/generated/upstream-ui.json';
import { DEFAULT_KEYMAP, EXCEL_MAC_KEYMAP, EXCEL_WINDOWS_KEYMAP, KEYMAPS, KEYMAP_TEMPLATES, isKeyName, keymapChoice } from '../../src/calc/keymaps.ts';

describe("Calc's keymap templates", () => {
  it('are all different and recognised', () => {
    for (const id of KEYMAP_TEMPLATES) expect(keymapChoice({ ...KEYMAPS[id] })).toBe(id);
  });

  it('bind only key names and upstream or application commands', () => {
    // upstream's commands with labels, and those without (SID_AUTO_SUM) that Calc registers
    const known = new Set([...Object.keys(ui.labels), '.uno:AutoSum']);
    for (const id of KEYMAP_TEMPLATES) for (const [k, cmd] of Object.entries(KEYMAPS[id])) {
      expect(isKeyName(k), k).toBe(true);
      expect(cmd.startsWith('app:') || known.has(cmd), `${id} ${k} ${cmd}`).toBe(true);
    }
  });

  it("have Calc's navigation keys and Excel's own", () => {
    expect(DEFAULT_KEYMAP.DOWN_MOD1).toBe('.uno:GoDownToEndOfData');
    expect(DEFAULT_KEYMAP.DIVIDE_MOD1).toBe('.uno:CommandPopup');
    expect(EXCEL_WINDOWS_KEYMAP.EQUAL_MOD2).toBe('.uno:AutoSum');
    expect(EXCEL_WINDOWS_KEYMAP.R_MOD1).toBe('.uno:FillRight');
    expect(EXCEL_WINDOWS_KEYMAP['9_MOD1']).toBe('.uno:HideRow');
    expect(EXCEL_MAC_KEYMAP.T_SHIFT_MOD1).toBe('.uno:AutoSum');
    expect(EXCEL_MAC_KEYMAP.D_MOD1).toBe('.uno:FillDown');
  });
});
