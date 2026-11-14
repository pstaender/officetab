// Insert > Caption for tables (SwDoc::InsertLabel) and number range fields (SwSetExpField, GST_SEQ).
import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { ExportDOCX } from '../../src/lo/sw/source/filter/ww8/docxexport.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import { NumberingType } from '../../src/lo/i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import type { SwTableNode } from '../../src/lo/sw/inc/node.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';
import { SwRect } from '../../src/lo/sw/inc/swrect.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };

/** The body's paragraphs outside tables, as displayed (fields expanded). */
const shown = (sh: SwWrtShell) => sh.m_pRoot.pages.flatMap((p) => p.frames.filter((f) => !f.pCell && !f.pArea)).map((f) =>
  f.lines.flatMap((l) => l.portions.map((p) => (p.kind === 'field' ? p.aExpand : f.node.GetText().slice(p.nStart, p.nStart + p.nLen)))).join(''));
const tables = (doc: SwDoc): SwTableNode[] => { const out: SwTableNode[] = []; const ns = doc.GetNodes(); for (let i = 0; i < ns.Count(); i++) { const n = ns.node(i); if (n.IsTableNode()) out.push(n as SwTableNode); } return out; };
const into = (sh: SwWrtShell, t: SwTableNode) => { const n = sh.m_pDoc.GetNodes().GoNext(t.GetIndex()) as SwTextNode; sh.m_pCursor.GetPoint().Assign(n, 0); sh.m_pCursor.DeleteMark(); };

function twoTables() {
  const sh = new SwWrtShell(new SwDoc(), mono);
  sh.Insert('Intro');
  sh.SplitNode();
  sh.InsertTable(1, 1, { heading: false, repeatHeading: false, borders: true });
  sh.m_pCursor.GetPoint().Assign(sh.m_pDoc.GetNodes().node(tables(sh.m_pDoc)[0]!.EndOfSectionNode().GetIndex() + 1) as SwTextNode, 0);
  sh.m_pCursor.DeleteMark();
  sh.Insert('Between');
  sh.SplitNode();
  sh.InsertTable(1, 1, { heading: false, repeatHeading: false, borders: true });
  return sh;
}

describe('Captions', () => {
  it('numbers table captions in document order, above or below the table', () => {
    const sh = twoTables();
    const [t1, t2] = tables(sh.m_pDoc);
    into(sh, t2!);
    expect(sh.InsertLabel('Table', 'Second', ': ', false)).toBe(true);
    into(sh, t1!);
    sh.InsertLabel('Table', 'First', ': ', true);
    // The caption above the first table is number 1, the later one renumbers to 2.
    expect(shown(sh)).toEqual(['Intro', 'Table 1: First', 'Between', 'Table 2: Second', '']);
    const cap = sh.m_pDoc.GetNodes().node(tables(sh.m_pDoc)[0]!.GetIndex() - 1) as SwTextNode;
    expect([cap.GetTextColl().GetName(), cap.GetAttr('RES_KEEP'), cap.GetAttr('RES_CHRATR_POSTURE')]).toEqual(['Table', true, true]);
    // Below: the table keeps with its caption.
    expect(tables(sh.m_pDoc)[1]!.m_pTable.m_aAttrs.keepWithNext).toBe(true);
    sh.Undo();
    expect(shown(sh)).toEqual(['Intro', 'Between', 'Table 1: Second', '']);
  });

  it('takes the numbering type, no category, and a new category', () => {
    const sh = twoTables();
    const [t1, t2] = tables(sh.m_pDoc);
    into(sh, t1!);
    sh.InsertLabel('Table', 'Roman', ': ', true, NumberingType.ROMAN_UPPER);
    into(sh, t2!);
    // The dialog passes no separator without a category (its field is disabled).
    sh.InsertLabel('', 'Plain', '', true);
    into(sh, tables(sh.m_pDoc)[1]!);
    sh.InsertLabel('Chart', '', ': ', false);
    expect(shown(sh)).toEqual(['Intro', 'Table I: Roman', 'Between', 'Plain', 'Chart 1', '']);
    const plain = sh.m_pDoc.GetNodes().node(tables(sh.m_pDoc)[1]!.GetIndex() - 1) as SwTextNode;
    expect(plain.GetTextColl().GetName()).toBe('Caption');
  });

  it('keeps number ranges through ODT and DOCX', async () => {
    const sh = twoTables();
    const [t1, t2] = tables(sh.m_pDoc);
    into(sh, t1!);
    sh.InsertLabel('Table', 'First', ': ', true);
    into(sh, t2!);
    sh.InsertLabel('Table', 'Second', ': ', true, NumberingType.ROMAN_LOWER);
    for (const back of [(await ImportODT(await ExportODT(sh.m_pDoc))).doc, (await ImportDOCX(await ExportDOCX(sh.m_pDoc))).doc]) {
      const sh2 = new SwWrtShell(back, mono);
      expect(shown(sh2).filter((s) => s.startsWith('Table'))).toEqual(['Table 1: First', 'Table ii: Second']);
    }
  });

  it('captions a selected graphic in a new frame that takes its place', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('Text');
    const img = sh.InsertGraphic(new Uint8Array([137, 80, 78, 71]), 'image/png', { width: 2000, height: 1000 });
    const before = sh.GetFlyFrameFormat(img)!;
    expect(sh.GetLabelType()).toBe('Object');
    expect(sh.InsertLabel('Figure', 'A cat', ': ', false)).toBe(true);
    const frame = sh.GetFlyFrameFormat()!;
    expect(frame.m_aName).not.toBe(img);
    expect(frame).toMatchObject({ m_nWidth: 2000, m_bAutoHeight: true, m_aBox: null, m_aAnchor: before.m_aAnchor, m_aHoriOrient: before.m_aHoriOrient, m_aSurround: before.m_aSurround });
    // The frame holds the graphic, as character, and the caption below it.
    const fly = sh.m_pRoot.FindFly(frame.m_aName)!.fly;
    const texts = fly.frames.map((f) => f.lines.flatMap((l) => l.portions.map((p) => (p.kind === 'field' ? p.aExpand : p.kind === 'fly' ? '[img]' : f.node.GetText().slice(p.nStart, p.nStart + p.nLen)))).join(''));
    expect(texts).toEqual(['[img]', 'Figure 1: A cat']);
    expect(fly.aFrame.Height()).toBeGreaterThan(1000);
    expect(sh.m_pDoc.GetFlyFormats().map((f) => f.name).sort()).toEqual([frame.m_aName, img].sort());
    sh.Undo();
    expect(sh.m_pDoc.GetFlyFormats().map((f) => f.name)).toEqual([img]);
  });

  it('captions a text frame inside it and a shape in a frame, and nothing as character', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('Text');
    const frame = sh.InsertTextFrame();
    sh.Insert('Inside');
    expect(sh.GetLabelType()).toBe('Fly');
    sh.InsertLabel('Text', 'Box', ': ', true);
    const sec = sh.m_pDoc.GetNodes().FindFlySection(frame)!;
    const paras = [1, 2].map((i) => (sh.m_pDoc.GetNodes().node(sec.GetIndex() + i) as SwTextNode));
    expect(paras.map((p) => p.GetText().replace(/\u0001/g, '#'))).toEqual(['Text #: Box', 'Inside']);
    expect(paras[0]!.GetTextColl().GetName()).toBe('Text');

    const sh2 = new SwWrtShell(new SwDoc(), mono);
    sh2.Insert('Text');
    const page = sh2.m_pRoot.pages[0]!.aPrt;
    const shape = sh2.InsertShape('ellipse', new SwRect(page.Left(), page.Top() + 500, 1000, 1000));
    expect(sh2.GetLabelType()).toBe('Draw');
    expect(sh2.InsertLabel('Drawing', '', ': ', false)).toBe(true);
    const made = sh2.GetFlyFrameFormat()!;
    expect(sh2.m_pRoot.FindFly(made.m_aName)!.fly.frames[0]!.lines[0]!.portions[0]!.pFly?.shape?.m_sType).toBe('ellipse');
    expect(sh2.m_pDoc.FindFlyByName(shape)?.asChar).toBeDefined();

    const sh3 = new SwWrtShell(new SwDoc(), mono);
    const img = sh3.InsertGraphic(new Uint8Array([1]), 'image/png', { width: 500, height: 500 }, true);
    sh3.SelectFly(img);
    expect(sh3.GetLabelType()).toBeNull();
    expect(sh3.InsertLabel('Figure', '', ': ', false)).toBe(false);
  });
});
