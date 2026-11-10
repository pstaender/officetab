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
});
