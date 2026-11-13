// Help > Search Commands: sfx2's MenuContentHandler over a menu configuration.
import { describe, expect, it } from 'vitest';
import { MenuContentHandler, type CurrentEntry, type MenuConfigEntry } from '../../src/lo/sfx2/source/commandpopup/CommandPopup.ts';

const MENU: MenuConfigEntry[] = [
  { cmd: '.uno:PickList', items: [{ cmd: '.uno:Save' }, { sep: true }, { cmd: '.uno:TemplateMenu', items: [{ cmd: '.uno:SaveAsTemplate' }, { cmd: '.uno:Hidden', visible: false }] }] },
  { cmd: '.uno:FormatMenu', items: [{ cmd: '.uno:Bold' }, { cmd: '.uno:Disabled' }] },
];
const LABELS: Record<string, string> = {
  '.uno:PickList': 'File', '.uno:Save': 'Save', '.uno:TemplateMenu': 'Templates', '.uno:SaveAsTemplate': 'Save as Template...',
  '.uno:Hidden': 'Save Hidden', '.uno:FormatMenu': 'Format', '.uno:Bold': 'Bold', '.uno:Disabled': 'Save Disabled',
};
const handler = (rtl = false) => new MenuContentHandler(MENU, {
  GetLabelForCommand: (c) => LABELS[c] ?? '', GetTooltipForCommand: (c) => `Tip ${LABELS[c]}`,
  IsAvailable: (c) => !['.uno:Disabled', '.uno:TemplateMenu', '.uno:PickList', '.uno:FormatMenu'].includes(c), bRTL: rtl,
});
const find = (h: MenuContentHandler, text: string) => { const l: CurrentEntry[] = []; h.findInMenu(text, l); return l; };

describe('MenuContentHandler', () => {
  it('finds the enabled, visible commands whose label contains the text, case-insensitively', () => {
    const r = find(handler(), 'SAVE');
    expect(r.map((e) => e.m_aCommandURL)).toEqual(['.uno:Save', '.uno:SaveAsTemplate']);
    expect(r[1]).toMatchObject({ m_aMenuLabel: 'Save as Template...', m_aTooltip: 'Tip Save as Template...', m_aMenuPath: 'File ▸ Templates', m_aFullLabelWithPath: ' ▸ Save as Template...' });
  });

  it('matches only after the start of a top-level label, and lists each label once', () => {
    // indexOf(...) > 0: the top-level menus themselves never match.
    expect(find(handler(), 'file')).toEqual([]);
    expect(find(handler(), 'o').map((e) => e.m_aCommandURL)).toEqual(['.uno:Bold']);
  });

  it('uses the right-to-left separator', () => {
    expect(find(handler(true), 'template')[0]!.m_aMenuPath).toBe('File ◂ Templates');
  });
});
