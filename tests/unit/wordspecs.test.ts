// Word documents from specs/writer against Word's own PDFs of them (`<name>_word.pdf`): the import
// and layout rules each difference was traced to.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { writeZip } from '../../src/lo/package/source/zipapi/zip.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import { ExportDOCX } from '../../src/lo/sw/source/filter/ww8/docxexport.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ApplyVert, type SwCellFrame } from '../../src/lo/sw/source/core/layout/pagechg.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';
import type { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';
import { Point } from '../../src/lo/tools/source/generic/gen.ts';

/** About Calibri's average advance: half the font size per character. */
const measurer: TextMeasurer = { GetTextWidth: (f: FontDesc, t: string) => [...t].length * f.size * 0.5, GetFontMetric: (f: FontDesc) => ({ ascent: f.size * 0.75, descent: f.size * 0.25 }) };
const paras = (doc: SwDoc) => {
  const nodes = doc.GetNodes(), out: SwTextNode[] = [];
  for (let i = 0; i < nodes.Count(); i++) { const n = nodes.node(i); if (n.IsTextNode()) out.push(n); }
  return out;
};
const byText = (doc: SwDoc, t: string) => paras(doc).find((p) => p.GetText().includes(t))!;
const cells = (sh: SwWrtShell) => sh.m_pRoot.pages.flatMap((p) => p.tabs.flatMap((t) => t.rows.flatMap((r) => r.cells)));
const cellOf = (sh: SwWrtShell, t: string) => cells(sh).find((c) => c.frames.some((f) => f.node.GetText().includes(t)))!;

describe('course_schedule_template.docx', async () => {
  const { doc } = await ImportDOCX(readFileSync('specs/writer/course_schedule_template.docx'));
  const sh = new SwWrtShell(doc, measurer);

  it('fits on one landscape page, as in Word', () => {
    expect(sh.m_pRoot.pages.length).toBe(1);
    const page = sh.m_pRoot.pages[0]!.aFrame;
    expect(page.Width()).toBeGreaterThan(page.Height());
  });

  it('bases styles without basedOn on the document defaults, not on Normal', () => {
    // "No Spacing" has no basedOn: Calibri 11 pt from w:docDefaults (theme minor font), while
    // Normal sets Times New Roman 12 pt.
    const cell = byText(doc, 'Kompetenzbereich');
    expect(cell.GetTextColl().GetName()).toBe('No Spacing');
    expect([cell.GetAttr('RES_CHRATR_FONT'), cell.GetAttr('RES_CHRATR_FONTSIZE')]).toEqual(['Calibri', 220]);
    expect(doc.FindTextFormatCollByName('Standard')!.GetFormatAttr('RES_CHRATR_FONT')).toBe('Times New Roman');
    // The theme's major font (Cambria) where a run asks for it.
    expect(byText(doc, 'ei Bedarf').GetCharAttrAt('RES_CHRATR_FONT', 0)).toBe('Cambria');
  });

  it('starts with the table, without an empty paragraph before it', () => {
    const nodes = doc.GetNodes();
    expect(nodes.node(nodes.BodyStart()).IsTableNode()).toBe(true);
  });

  it('gives empty paragraphs the size of their paragraph mark', () => {
    // The footer's last paragraph has a 1 pt mark (w:pPr/w:rPr/w:sz 2): Word's footer ends there.
    const footer = sh.m_pRoot.pages[0]!.frames.filter((f) => f.pArea === 'footer');
    const last = footer[footer.length - 1]!;
    expect(last.node.GetAttr('RES_CHRATR_FONTSIZE')).toBe(20);
    expect(last.nHeight).toBeLessThan(60);
  });

  it('lays out the merged btLr cell bottom to top, across its rows', () => {
    const c = cellOf(sh, 'Didaktisches');
    expect(c.box.m_aAttrs.frameDir).toBe('bt-lr');
    expect(c.aVert).toBeDefined();
    const f = c.frames[0]!;
    // The lines are as long as the merged cell is high (less the insets) ...
    expect(f.nWidth).toBeGreaterThan(c.aFrame.Width());
    expect(f.nWidth).toBeLessThanOrEqual(c.aFrame.Height());
    // ... and the text starts at the bottom of the cell and runs upwards.
    const [x0, y0] = ApplyVert(c.aVert!, f.nLeft, f.nTop);
    const [x1, y1] = ApplyVert(c.aVert!, f.nLeft + 100, f.nTop);
    expect(y1).toBeLessThan(y0);
    expect(x1).toBeCloseTo(x0);
    // The first line's start lies in the cell, near its bottom left corner.
    expect(x0).toBeGreaterThanOrEqual(c.aFrame.Left());
    expect(y0).toBeLessThanOrEqual(c.aFrame.Bottom());
    expect(y0).toBeGreaterThan(c.aFrame.Top() + c.aFrame.Height() / 2);
    // A click in the cell finds its text.
    expect(sh.m_pRoot.GetModelPositionForViewPoint(new Point(Math.round(x1) + 50, Math.round(y1) - 50)).node.GetText()).toContain('Didaktisches');
  });

  it('centres cells with w:vAlign="center" in their rows', () => {
    const c: SwCellFrame = cellOf(sh, 'K1 … K6');
    expect(c.box.m_aAttrs.vertOrient).toBe('center');
    const f = c.frames[0]!;
    const above = f.nTop - c.aFrame.Top(), below = c.aFrame.Bottom() - (f.nTop + f.nHeight);
    expect(Math.abs(above - below)).toBeLessThan(150);
  });

  it('shows footnote numbers once superscript, and the footnote text right after its number', () => {
    // The anchor run is superscript through its character style: not reduced a second time.
    const anchor = sh.m_pRoot.pages[0]!.frames.flatMap((f) => f.lines.flatMap((l) => l.portions)).find((p) => p.kind === 'field' && p.aExpand === '1')!;
    expect(anchor.font.size).toBe(Math.round((280 * 58) / 100));
    // In the footnote area: a superscript number, then the text (" Siehe ...") without a tab.
    const ftn = sh.m_pRoot.pages[0]!.frames.find((f) => f.node.GetText().includes('Siehe Bildungsstandards'))!;
    const [num, text] = ftn.lines[0]!.portions;
    expect(num!.kind).toBe('number');
    expect(num!.font.rise).toBeGreaterThan(0);
    expect(num!.font.bold).toBe(false);
    expect(text!.nX).toBeCloseTo(num!.nWidth);
  });
});

describe('course_schedule_template_word_export.dotx', () => {
  it('reads the Word template as the document it was saved from', async () => {
    const texts = (d: SwDoc) => paras(d).map((p) => p.GetText());
    const tpl = await ImportDOCX(readFileSync('specs/writer/course_schedule_template_word_export.dotx'));
    expect([...tpl.lost]).toEqual([]);
    expect(texts(tpl.doc)).toEqual(texts((await ImportDOCX(readFileSync('specs/writer/course_schedule_template.docx'))).doc));
  });
});

describe('table cell text direction and alignment', () => {
  it('keeps vertical text and vertical alignment through DOCX and ODT', async () => {
    const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const tc = (pr: string, t: string) => `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>${pr}</w:tcPr><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
    const body = `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="1500"/></w:trPr>${tc('<w:textDirection w:val="btLr"/>', 'up')}${tc('<w:textDirection w:val="tbRl"/>', 'down')}${tc('<w:vAlign w:val="bottom"/>', 'low')}</w:tr></w:tbl><w:p/>`;
    const { doc } = await ImportDOCX(await writeZip([{ name: 'word/document.xml', data: new TextEncoder().encode(`<w:document ${NS}><w:body>${body}</w:body></w:document>`) }]));
    const boxAttrs = (d: SwDoc) => {
      const sh2 = new SwWrtShell(d, measurer);
      return ['up', 'down', 'low'].map((t) => { const a = cellOf(sh2, t).box.m_aAttrs; return [a.frameDir, a.vertOrient]; });
    };
    const want = [['bt-lr', undefined], ['tb-rl', undefined], [undefined, 'bottom']];
    expect(boxAttrs(doc)).toEqual(want);
    expect(boxAttrs((await ImportODT(await ExportODT(doc))).doc)).toEqual(want);
    expect(boxAttrs((await ImportDOCX(await ExportDOCX(doc))).doc)).toEqual(want);
    // Top to bottom: the text starts at the cell's top right.
    const sh = new SwWrtShell(doc, measurer);
    const c = cellOf(sh, 'down'), f = c.frames[0]!;
    const [x, y] = ApplyVert(c.aVert!, f.nLeft, f.nTop);
    expect(x).toBeGreaterThan(c.aFrame.Left() + c.aFrame.Width() / 2);
    expect(y).toBeLessThan(c.aFrame.Top() + c.aFrame.Height() / 2);
  });
});
