// Insert > Page Number (FN_PGNUMBER_WIZARD, SwPageNumberDlg) and the page style's number format.
import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { CreateSwPageNumberDlg, ExecutePageNumberWizard } from '../../src/lo/sw/source/uibase/shells/textfld.ts';
import { DrawTextFlags, SwPageNumberDlg } from '../../src/lo/sw/source/ui/misc/pagenumberdlg.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { ExportDOCX } from '../../src/lo/sw/source/filter/ww8/docxexport.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import { NumberingType } from '../../src/lo/i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };

/** Pages "A", "B", "C", each starting with a page break. */
function pages(n = 3) {
  const sh = new SwWrtShell(new SwDoc(), mono);
  'ABCDEF'.slice(0, n).split('').forEach((p, i) => { if (i) sh.InsertPageBreak(null); sh.Insert(p); });
  return sh;
}
/** Each page's header or footer lines as shown, with their paragraphs' alignment. */
const area = (sh: SwWrtShell, a: 'header' | 'footer') => sh.m_pRoot.pages.map((p) => p.frames.filter((f) => f.pArea === a).map((f) =>
  `${f.node.GetAttr('RES_PARATR_ADJUST')}:${f.lines.flatMap((l) => l.portions.map((x) => (x.kind === 'field' ? x.aExpand : f.node.GetText().slice(x.nStart, x.nStart + x.nLen)))).join('')}`).join('|'));

/** The dialog as the user sets it, through its handlers. */
interface Settings { position?: number; alignment?: number; mirror?: boolean; total?: boolean; rangeTotal?: boolean; fit?: boolean; type?: number }
function dlg(sh: SwWrtShell, s: Settings = {}): SwPageNumberDlg {
  const pDlg = CreateSwPageNumberDlg(sh);
  if (s.position !== undefined) pDlg.PositionSelectHdl(s.position);
  if (s.alignment !== undefined) pDlg.AlignmentSelectHdl(s.alignment);
  if (s.mirror !== undefined) pDlg.MirrorOnEvenPagesToggled(s.mirror);
  if (s.total !== undefined) pDlg.IncludePageTotalChangeHdl(s.total);
  if (s.rangeTotal !== undefined) pDlg.IncludePageRangeTotalChangeHdl(s.rangeTotal);
  if (s.fit !== undefined) pDlg.FitIntoExistingMarginsToggled(s.fit);
  if (s.type !== undefined) pDlg.NumberTypeSelectHdl(s.type);
  return pDlg;
}

describe('SwPageNumberDlg', () => {
  it('starts at the bottom, centred, with the mirror box insensitive and the page style\'s numbering', () => {
    const sh = pages(1);
    const pDlg = CreateSwPageNumberDlg(sh);
    expect([pDlg.GetPageNumberPosition(), pDlg.GetPageNumberAlignment(), pDlg.GetPageNumberType()]).toEqual([1, 1, NumberingType.ARABIC]);
    expect(pDlg.m_xMirrorOnEvenPages).toEqual({ state: true, sensitive: false });
    expect(pDlg.GetMirrorOnEvenPages()).toBe(false);
    pDlg.AlignmentSelectHdl(0);
    expect(pDlg.GetMirrorOnEvenPages()).toBe(true);
  });

  it('lets only one of the two page totals be chosen', () => {
    const pDlg = new SwPageNumberDlg();
    pDlg.IncludePageTotalChangeHdl(true);
    expect(pDlg.m_xIncludePageRangeTotal.sensitive).toBe(false);
    pDlg.IncludePageTotalChangeHdl(false);
    pDlg.IncludePageRangeTotalChangeHdl(true);
    expect(pDlg.m_xIncludePageTotal.sensitive).toBe(false);
    expect(pDlg.m_xIncludePageRangeTotal.sensitive).toBe(true);
  });

  it('draws "#" where the number goes in its preview', () => {
    const pDlg = new SwPageNumberDlg();
    expect(pDlg.m_xPreviewImage).toMatchObject({ sText: '#', aRect: [7, 7, 68, 98], eFlags: DrawTextFlags.Center | DrawTextFlags.Bottom });
    pDlg.PositionSelectHdl(0);
    pDlg.AlignmentSelectHdl(2);
    pDlg.IncludePageTotalChangeHdl(true);
    expect(pDlg.m_xPreviewImage).toMatchObject({ sText: '# / #', eFlags: DrawTextFlags.Right | DrawTextFlags.Top });
  });
});

describe('Page Number wizard', () => {
  it('turns the footer on and centres the page number in it, as one undo step', () => {
    const sh = pages();
    ExecutePageNumberWizard(sh, dlg(sh));
    expect(area(sh, 'footer')).toEqual(['center:1', 'center:2', 'center:3']);
    sh.Undo();
    expect(sh.IsHeaderOn(false)).toBe(false);
  });

  it('adds the page total and a page style number format in the header', () => {
    const sh = pages();
    ExecutePageNumberWizard(sh, dlg(sh, { position: 0, alignment: 2, mirror: false, total: true, type: NumberingType.ROMAN_UPPER }));
    expect(sh.GetCurPageDesc().m_nNumType).toBe(NumberingType.ROMAN_UPPER);
    expect(area(sh, 'header')).toEqual(['right:I / III', 'right:II / III', 'right:III / III']);
  });

  it('puts the number above existing header text and replaces it when run again', () => {
    const sh = pages(1);
    sh.ChangeHeaderOrFooter(true, true);
    sh.Insert('Title');
    ExecutePageNumberWizard(sh, dlg(sh, { position: 0, alignment: 0 }));
    expect(area(sh, 'header')).toEqual(['left:1|left:Title']);
    ExecutePageNumberWizard(sh, dlg(sh, { position: 0, alignment: 2, total: true }));
    expect(area(sh, 'header')).toEqual(['right:1 / 1|left:Title']);
  });

  it('mirrors the number on even pages', () => {
    const sh = pages(4);
    ExecutePageNumberWizard(sh, dlg(sh, { alignment: 2 }));
    expect(area(sh, 'footer')).toEqual(['right:1', 'left:2', 'right:3', 'left:4']);
  });

  it('adds only the page total to the mirrored even pages, not the page range total', () => {
    const sh = pages(4);
    ExecutePageNumberWizard(sh, dlg(sh, { alignment: 0, rangeTotal: true }));
    expect(area(sh, 'footer')).toEqual(['left:1 / 4', 'right:2', 'left:3 / 4', 'right:4']);
  });

  it('leaves the cursor where it was', () => {
    const sh = pages(2);
    const nNode = sh.m_pCursor.GetPoint().GetNodeIndex(), nContent = sh.m_pCursor.GetPoint().GetContentIndex();
    ExecutePageNumberWizard(sh, dlg(sh, { position: 0 }));
    expect([sh.m_pCursor.GetPoint().GetNode().GetText(), sh.m_pCursor.GetPoint().GetContentIndex()]).toEqual(['B', nContent]);
    expect(sh.m_pCursor.GetPoint().GetNodeIndex()).toBeGreaterThan(nNode);
  });

  it('fits the header into the top margin by the Header paragraph style\'s height', () => {
    const sh = pages(1);
    const before = sh.GetCurPageDesc().nTop;
    const pStyle = sh.m_pDoc.FindTextFormatCollByName('Header')!;
    pStyle.m_aSet.RES_UL_SPACE = { upper: 50, lower: 30 };
    pStyle.m_aSet.RES_BOX = { top: { color: '#000', width: 10 }, bottom: null, left: null, right: null, padding: 20 };
    ExecutePageNumberWizard(sh, dlg(sh, { position: 0, fit: true }));
    const pd = sh.GetCurPageDesc();
    // 240 font + 80 paragraph spacing + 30 top border and padding + 20 bottom padding, after 5 mm spacing
    expect(pd.nHeaderMinHeight).toBe(283 + 240 + 80 + 30 + 20);
    expect(pd.nTop + pd.nHeaderMinHeight).toBe(before);
  });

  it('fits the footer into the bottom margin', () => {
    const sh = pages(1);
    const before = sh.GetCurPageDesc().nBottom;
    ExecutePageNumberWizard(sh, dlg(sh, { fit: true }));
    const pd = sh.GetCurPageDesc();
    expect(pd.nBottom + pd.nFooterMinHeight).toBe(before);
    expect(pd.bFooterEatSpacing).toBe(true);
  });

  it('keeps the page style number format through ODT and DOCX', async () => {
    const sh = pages(1);
    ExecutePageNumberWizard(sh, dlg(sh, { type: NumberingType.ROMAN_LOWER }));
    const odt = (await ImportODT(await ExportODT(sh.m_pDoc))).doc;
    expect(odt.m_aPageDesc.m_nNumType).toBe(NumberingType.ROMAN_LOWER);
    const docx = (await ImportDOCX(await ExportDOCX(sh.m_pDoc))).doc;
    expect(docx.m_aPageDesc.m_nNumType).toBe(NumberingType.ROMAN_LOWER);
  });
});
