// Insert > Page Number (FN_PGNUMBER_WIZARD, SwPageNumberDlg) and the page style's number format.
import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ExecutePageNumberWizard, SwPageNumberDlgInit } from '../../src/lo/sw/source/uibase/shells/textfld.ts';
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

describe('Page Number wizard', () => {
  it('turns the footer on and centres the page number in it, as one undo step', () => {
    const sh = pages();
    const dlg = SwPageNumberDlgInit(sh);
    expect(dlg).toMatchObject({ m_aPageNumberPosition: 1, m_aPageNumberAlignment: 1, m_nPageNumberType: NumberingType.ARABIC });
    ExecutePageNumberWizard(sh, dlg);
    expect(area(sh, 'footer')).toEqual(['center:1', 'center:2', 'center:3']);
    sh.Undo();
    expect(sh.IsHeaderOn(false)).toBe(false);
  });

  it('adds the page total and a page style number format in the header', () => {
    const sh = pages();
    ExecutePageNumberWizard(sh, { ...SwPageNumberDlgInit(sh), m_aPageNumberPosition: 0, m_aPageNumberAlignment: 2, m_bMirrorOnEvenPages: false, m_bIncludePageTotal: true, m_nPageNumberType: NumberingType.ROMAN_UPPER });
    expect(sh.GetCurPageDesc().m_nNumType).toBe(NumberingType.ROMAN_UPPER);
    expect(area(sh, 'header')).toEqual(['right:I / III', 'right:II / III', 'right:III / III']);
  });

  it('puts the number above existing header text and replaces it when run again', () => {
    const sh = pages(1);
    sh.ChangeHeaderOrFooter(true, true);
    sh.Insert('Title');
    ExecutePageNumberWizard(sh, { ...SwPageNumberDlgInit(sh), m_aPageNumberPosition: 0, m_aPageNumberAlignment: 0 });
    expect(area(sh, 'header')).toEqual(['left:1|left:Title']);
    ExecutePageNumberWizard(sh, { ...SwPageNumberDlgInit(sh), m_aPageNumberPosition: 0, m_aPageNumberAlignment: 2, m_bIncludePageTotal: true });
    expect(area(sh, 'header')).toEqual(['right:1 / 1|left:Title']);
  });

  it('mirrors the number on even pages', () => {
    const sh = pages(4);
    ExecutePageNumberWizard(sh, { ...SwPageNumberDlgInit(sh), m_aPageNumberAlignment: 2 });
    expect(area(sh, 'footer')).toEqual(['right:1', 'left:2', 'right:3', 'left:4']);
  });

  it('fits the footer into the bottom margin', () => {
    const sh = pages(1);
    const before = sh.GetCurPageDesc().nBottom;
    ExecutePageNumberWizard(sh, { ...SwPageNumberDlgInit(sh), m_bFitIntoExistingMargins: true });
    const pd = sh.GetCurPageDesc();
    expect(pd.nBottom + pd.nFooterMinHeight).toBe(before);
    expect(pd.bFooterEatSpacing).toBe(true);
  });

  it('keeps the page style number format through ODT and DOCX', async () => {
    const sh = pages(1);
    ExecutePageNumberWizard(sh, { ...SwPageNumberDlgInit(sh), m_nPageNumberType: NumberingType.ROMAN_LOWER });
    const odt = (await ImportODT(await ExportODT(sh.m_pDoc))).doc;
    expect(odt.m_aPageDesc.m_nNumType).toBe(NumberingType.ROMAN_LOWER);
    const docx = (await ImportDOCX(await ExportDOCX(sh.m_pDoc))).doc;
    expect(docx.m_aPageDesc.m_nNumType).toBe(NumberingType.ROMAN_LOWER);
  });
});
