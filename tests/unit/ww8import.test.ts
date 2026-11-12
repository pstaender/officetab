// Word 97-2003 import (sw/source/filter/ww8): the compound document, the text and its properties.
// The documents are LibreOffice's test files (sw/qa/filter/ww8/data, sw/qa/extras/ww8import/data).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Storage, IsStorageFile } from '../../src/lo/sot/source/sdstor/storage.ts';
import { ImportDOC } from '../../src/lo/sw/source/filter/ww8/ww8par.ts';
import type { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';
import type { SwTableNode } from '../../src/lo/sw/inc/node.ts';
import { SwStartNodeType } from '../../src/lo/sw/inc/ndtyp.ts';
import { NumberingType } from '../../src/lo/i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';

const file = (name: string) => new Uint8Array(readFileSync(new URL(`./data/ww8/${name}`, import.meta.url)));
const paras = (doc: SwDoc) => { const n = doc.GetNodes(); const o: SwTextNode[] = []; for (let k: SwTextNode | null = n.FirstTextNode(); k; k = n.GoNext(k.GetIndex())) o.push(k); return o; };

describe('compound document', () => {
  it('lists and reads the streams of a .doc', () => {
    const b = file('3endnotes.doc');
    expect(IsStorageFile(b)).toBe(true);
    const stg = new Storage(b);
    expect(stg.GetNames()).toEqual(expect.arrayContaining(['WordDocument', '1Table', '\u0005SummaryInformation']));
    // The WordDocument stream starts with the FIB's magic number.
    const word = stg.OpenStream('WordDocument')!;
    expect(word[0] | (word[1]! << 8)).toBe(0xa5ec);
  });
});

describe('ImportDOC', () => {
  it('reads the text with its paragraph and character properties', async () => {
    const { doc, lost } = await ImportDOC(file('3endnotes.doc'));
    const ps = paras(doc).filter((p) => p.GetText());
    expect(ps[0]!.GetText()).toMatch(/^“Fancy Franchises”: The Mid-Victorian Quest for Electoral No/);
    // Centred and bold; an indented quotation in 9 pt; its source right-aligned in italics.
    expect(ps[0]!.m_aSet.RES_PARATR_ADJUST).toBe('center');
    expect(ps[0]!.GetCharAttrAt('RES_CHRATR_WEIGHT', 1)).toBe(true);
    expect(ps[1]!.m_aSet.RES_LR_SPACE).toMatchObject({ left: 720 });
    expect(ps[1]!.GetCharAttrAt('RES_CHRATR_FONTSIZE', 1)).toBe(180);
    expect(ps[2]!.m_aSet.RES_PARATR_ADJUST).toBe('right');
    expect(ps[2]!.GetCharAttrAt('RES_CHRATR_POSTURE', 1)).toBe(true);
    // The style sheet's default font, the document language, US letter pages.
    expect(doc.m_aDefaults).toMatchObject({ RES_CHRATR_FONT: 'Times New Roman', RES_CHRATR_LANGUAGE: 'en-US' });
    expect([doc.m_aPageDesc.nWidth, doc.m_aPageDesc.nHeight]).toEqual([12240, 15840]);
    // The font table's families (FFN ff): Times New Roman is a roman (serif) font, and ODT keeps it.
    expect(doc.m_aFontFamilies.get('Times New Roman')).toBe('roman');
    const { ImportODT, ExportODT } = await import('../../src/lo/sw/source/filter/xml/odt.ts');
    expect((await ImportODT(await ExportODT(doc))).doc.m_aFontFamilies.get('Times New Roman')).toBe('roman');
    // What is not ported yet is reported.
    expect(lost).toContain('endnotes');
  });

  it('reads tables, keeping differently positioned ones apart (InEqualApo)', async () => {
    const { doc, lost } = await ImportDOC(file('n816593.doc'));
    const n = doc.GetNodes();
    const tables: SwTableNode[] = [];
    for (let i = 0; i < n.Count(); i++) if (n.node(i).IsTableNode()) tables.push(n.node(i) as SwTableNode);
    // LibreOffice's testN816593: two tables, not merged into one.
    expect(tables.length).toBe(2);
    const cellText = (t: SwTableNode) => t.m_pTable.GetTabSortBoxes().map((b) => (n.GoNext(b.m_pStartNode!.GetIndex()) as SwTextNode).GetText());
    expect(cellText(tables[0]!)[0]).toBe('First table');
    expect(cellText(tables[1]!)[0]).toBe('Second table');
    expect(tables[0]!.m_pTable.GetTabLines()[0]!.m_aBoxes.length).toBe(2);
    expect(lost.join()).not.toMatch(/tables/);
  });

  it('reads the header with its page number field', async () => {
    const { doc } = await ImportDOC(file('3endnotes.doc'));
    const n = doc.GetNodes();
    const header = n.FindAreaSection(SwStartNodeType.SwHeaderStartNode, 'default', doc.m_aPageDesc.m_aName)!;
    const para = n.GoNext(header.GetIndex())!;
    // PAGE is a page number field, not the number Word last showed.
    expect(para.m_aHints.some((h) => h.aAttrs.RES_TXTATR_FIELD?.type === 'PageNumber')).toBe(true);
  });

  it('refuses what is not a Word 97-2003 document', async () => {
    await expect(ImportDOC(new TextEncoder().encode('Word 2 document'))).rejects.toThrow(/not a Word 97-2003 document/);
  });
});

describe('ImportDOC lists', () => {
  it('reads the list levels: numbering types, number texts, bullets (tdf104239)', async () => {
    const { doc } = await ImportDOC(file('tdf104239_chapterNumbering.doc'));
    const byText = new Map(paras(doc).map((p) => [p.GetText(), p]));
    const level = (t: string) => {
      const p = byText.get(t)!;
      return doc.FindNumRulePtr(p.GetAttr('RES_PARATR_NUMRULE'))!.Get(p.GetAttr('RES_PARATR_LIST_LEVEL'));
    };
    // A. I. a. i. •, then 1.1.1.1.1.1: the levels' formats as Word's chapter numbering has them.
    expect(level('Heading 1').GetNumberingType()).toBe(NumberingType.CHARS_UPPER_LETTER_N);
    expect(level('Heading 1').m_sListFormat).toBe(' %1%.');
    expect(level('Heading 2').GetNumberingType()).toBe(NumberingType.ROMAN_UPPER);
    expect(level('Heading 4').GetNumberingType()).toBe(NumberingType.ROMAN_LOWER);
    expect(level('Heading 5').GetNumberingType()).toBe(NumberingType.CHAR_SPECIAL);
    expect(level('Heading 5').GetBulletChar()).toBe('•');
    expect(level('Heading 6').m_sListFormat).toBe('%1%.%2%.%3%.%4%.%5%.%6%');
  });
});
