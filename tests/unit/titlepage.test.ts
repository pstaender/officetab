// Format > Title Page (SwTitlePageDlg).
import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { SwTitlePageDlgInit, SwTitlePageDlgOK } from '../../src/lo/sw/source/ui/misc/titlepage.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };

/** Pages "A", "B", "C", "D", each starting with a page break. */
function pages() {
  const sh = new SwWrtShell(new SwDoc(), mono);
  ['A', 'B', 'C', 'D'].forEach((p, i) => { if (i) sh.InsertPageBreak(null); sh.Insert(p); });
  return sh;
}
const layout = (sh: SwWrtShell) => sh.m_pRoot.pages.map((p) => `${p.pDesc.m_aName}:${p.nVirtNum}:${p.frames.filter((f) => !f.pArea).map((f) => f.node.GetText()).join('')}`);

describe('Title Page', () => {
  it('turns the first page into a title page and restarts the numbering after it', () => {
    const sh = pages();
    const dlg = SwTitlePageDlgInit(sh);
    expect(dlg.settings).toMatchObject({ bUseExisting: true, nPageCount: 1, bRestartNumbering: false, bSetPageNumber: false });
    SwTitlePageDlgOK(sh, dlg, { ...dlg.settings, bRestartNumbering: true, nRestartNumber: 1 }, true);
    expect(layout(sh)).toEqual(['First Page:1:A', 'Default Page Style:1:B', 'Default Page Style:2:C', 'Default Page Style:3:D']);
    // One undo step.
    sh.Undo();
    expect(layout(sh)).toEqual(['Default Page Style:1:A', 'Default Page Style:2:B', 'Default Page Style:3:C', 'Default Page Style:4:D']);
  });

  it('gives a second title page the Index style and reads the title pages back', () => {
    const sh = pages();
    const dlg = SwTitlePageDlgInit(sh);
    SwTitlePageDlgOK(sh, dlg, { ...dlg.settings, nPageCount: 2, bSetPageNumber: true, nSetPageNumber: 5 }, true);
    expect(layout(sh)).toEqual(['First Page:5:A', 'Index:6:B', 'Default Page Style:7:C', 'Default Page Style:8:D']);
    expect(SwTitlePageDlgInit(sh).settings).toMatchObject({ nPageCount: 2, bSetPageNumber: true, nSetPageNumber: 5 });
  });

  it('inserts new title pages at a page', () => {
    const sh = pages();
    const dlg = SwTitlePageDlgInit(sh);
    SwTitlePageDlgOK(sh, dlg, { ...dlg.settings, bUseExisting: false, nPageCount: 1, nPageStart: 3 }, false);
    expect(layout(sh)).toEqual(['Default Page Style:1:A', 'Default Page Style:2:B', 'First Page:3:', 'Default Page Style:4:C', 'Default Page Style:5:D']);
    // The cursor is on the new title page.
    expect(sh.GetPageNumber()).toBe(3);
  });
});
