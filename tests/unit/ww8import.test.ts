// Word 97-2003 import (sw/source/filter/ww8): the compound document, the text and its properties.
// The documents are LibreOffice's test files (sw/qa/filter/ww8/data, sw/qa/extras/ww8import/data).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Storage, IsStorageFile } from '../../src/lo/sot/source/sdstor/storage.ts';
import { ImportDOC } from '../../src/lo/sw/source/filter/ww8/ww8par.ts';
import { TranslateSprms6, WW8Fib } from '../../src/lo/sw/source/filter/ww8/ww8scan.ts';
import { NumberParagraphs } from '../../src/lo/sw/source/core/doc/list.ts';
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
    // The three endnotes, at their references, each with its text in its own section.
    const notes = ps.flatMap((p) => p.m_aHints.filter((h) => h.aAttrs.RES_TXTATR_FTN).map((h) => h.aAttrs.RES_TXTATR_FTN!));
    expect(notes.map((f) => f.endnote)).toEqual([true, true, true]);
    const n = doc.GetNodes();
    expect((n.GoNext(n.FindFootnoteSection(notes[2]!.id)!.GetIndex()) as SwTextNode).GetText()).toMatch(/Third, David Cannadine/);
    expect(lost).toEqual([]);
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

describe('ImportDOC pictures and large rows', () => {
  it('reads the inline logo of the header and a row whose properties are in the Data stream (tdf128608)', async () => {
    const { doc } = await ImportDOC(file('tdf128608_tableParaBackColor.doc'));
    const n = doc.GetNodes();
    // The header's logo: a PNG or metafile anchored as a character, with its size.
    const flys: { width: number; height: number; graphic: string }[] = [];
    for (const kind of ['default', 'first', 'left'] as const) {
      const header = n.FindAreaSection(SwStartNodeType.SwHeaderStartNode, kind, doc.m_aPageDesc.m_aName);
      for (let i = header ? header.GetIndex() + 1 : 0; header && i < header.EndOfSectionNode().GetIndex(); i++) {
        const k = n.node(i);
        if (k.IsTextNode()) for (const h of (k as SwTextNode).m_aHints) if (h.aAttrs.RES_TXTATR_FLYCNT) flys.push(h.aAttrs.RES_TXTATR_FLYCNT);
      }
    }
    expect(flys.length).toBeGreaterThan(0);
    expect(doc.m_aGraphics.get(flys[0]!.graphic)?.mime).toMatch(/^image\//);
    expect(flys[0]!.width).toBeGreaterThan(1000);
    // sprmPHugePapx: the second row's definition (seven cells) is in the Data stream.
    let table: SwTableNode | undefined;
    for (let i = 0; i < n.Count() && !table; i++) if (n.node(i).IsTableNode()) table = n.node(i) as SwTableNode;
    expect(table!.m_pTable.GetTabLines()[1]!.m_aBoxes.length).toBe(7);
  });
});

describe('ImportDOC floating objects', () => {
  it('reads floating pictures and text boxes with their text, fill and line (skipimages)', async () => {
    const { doc, lost } = await ImportDOC(file('skipimages.doc'));
    const n = doc.GetNodes();
    const flys = paras(doc).flatMap((p) => p.m_aAnchoredFlys.map((a) => a.fmt));
    // Three pictures from the drawing group's BLIP store, in three formats.
    const pics = flys.filter((f) => f.graphic !== undefined);
    expect(pics.map((f) => doc.m_aGraphics.get(f.graphic!)!.mime).sort()).toEqual(['image/jpeg', 'image/png', 'image/x-emf']);
    expect(pics[0]!.m_nWidth).toBeGreaterThan(5000);
    // Text boxes: text frames with their story's text, a white fill and the shape's line.
    const frames = flys.filter((f) => f.m_sContentId);
    expect(frames.length).toBe(3);
    const text = (id: string) => (n.GoNext(n.FindFlySection(id)!.GetIndex()) as SwTextNode).GetText();
    expect(frames.map((f) => text(f.m_sContentId!)).join('|')).toMatch(/Nam pretium turpis.*\|Lorem ipsum dolor sit amet/);
    expect(frames[2]!.m_aBackground).toBe('#ffffff');
    expect(frames[2]!.m_aBox?.top?.color).toBe('#000000');
    expect(lost).toEqual([]);
  });
});

describe('ImportDOC fields', () => {
  it('turns HYPERLINK into a link on its result (fdo77844)', async () => {
    const { doc } = await ImportDOC(file('fdo77844.doc'));
    const hints = paras(doc).flatMap((p) => p.m_aHints.filter((h) => h.aAttrs.RES_TXTATR_INETFMT).map((h) => [h.aAttrs.RES_TXTATR_INETFMT, p.GetText().slice(h.nStart, h.nEnd)]));
    expect(hints).toEqual([['https://bugs.freedesktop.org/show_bug.cgi?id=77844', 'fdo#77844']]);
  });

  it('marks a TOC field result as the index, its entries linked to their bookmarks (mw00_table_of_contents_templates)', async () => {
    const { doc } = await ImportDOC(file('mw00_table_of_contents_templates.doc'));
    const toc = paras(doc).filter((p) => p.m_aSet.RES_PARATR_TOX_ID);
    expect(toc.length).toBe(4);
    expect(doc.m_aTocSettings.get(toc[0]!.m_aSet.RES_PARATR_TOX_ID!)).toBeTruthy();
    const links = toc.flatMap((p) => p.m_aHints.map((h) => h.aAttrs.RES_TXTATR_INETFMT)).filter(Boolean);
    expect(links[0]).toMatch(/^#_Toc/);
  });
});

describe('ImportDOC comments', () => {
  it('reads comments with author, date, text and range (comments-nested)', async () => {
    const { doc, lost } = await ImportDOC(file('comments-nested.doc'));
    const hints = paras(doc).flatMap((p) => p.m_aHints);
    const notes = hints.filter((h) => h.aAttrs.RES_TXTATR_ANNOTATION).map((h) => h.aAttrs.RES_TXTATR_ANNOTATION!);
    expect(notes.map((c) => [c.author, c.text])).toEqual([['vmiklos', 'Outer'], ['Miklos Vajna', 'As in non-range.']]);
    expect(notes[0]!.date).toBe('2014-01-10T20:17:00');
    // The outer comment's range is marked; the other comment has no range.
    expect(hints.some((h) => h.aAttrs.RES_TXTATR_ANNOTMARK === notes[0]!.id)).toBe(true);
    expect(lost).toEqual([]);
  });
});

describe('ImportDOC nested tables', () => {
  it('builds a table nested in a cell, its rows ended by sprmPFInnerTtp (tdf106799)', async () => {
    const { doc, lost } = await ImportDOC(file('tdf106799.doc'));
    const n = doc.GetNodes();
    const tables: SwTableNode[] = [];
    for (let i = 0; i < n.Count(); i++) if (n.node(i).IsTableNode()) tables.push(n.node(i) as SwTableNode);
    expect(tables.length).toBe(2);
    // The inner table lies within the outer one: one cell in its first row, four in the others.
    expect(tables[1]!.GetIndex()).toBeLessThan(tables[0]!.EndOfSectionNode().GetIndex());
    expect(tables[1]!.GetTable().m_aLines.map((l) => l.m_aBoxes.length)).toEqual([1, 4, 4]);
    expect(lost).toEqual([]);
  });
});

describe('ImportDOC tracked changes', () => {
  it('reads revision marks with author and time, and turns recording on (tdf132637_protectTrackChanges)', async () => {
    const { doc } = await ImportDOC(file('tdf132637_protectTrackChanges.doc'));
    const red = paras(doc).flatMap((p) => p.m_aHints.filter((h) => h.aAttrs.RES_TXTATR_REDLINE).map((h) => [h.aAttrs.RES_TXTATR_REDLINE!, p.GetText().slice(h.nStart, h.nEnd)] as const));
    expect(red.length).toBe(2);
    expect(red[0]![0]).toMatchObject({ type: 'Insert', author: 'T', date: '2020-05-03T14:39:00' });
    expect(red[0]![1]).toMatch(/^tracked created in M/);
    expect(doc.m_pDocumentRedlineManager.m_bRecord).toBe(true);
  });
});

describe('ImportDOC Word 6 and 95', () => {
  it('translates Word 6 sprms into Word 97 ones, borders and table cells converted', () => {
    // sprmPJc (5) right, sprmCFBold (85) on, sprmCHps (99) 24 half points, sprmPBrcTop (38) single.
    const g = TranslateSprms6(new Uint8Array([5, 2, 85, 1, 99, 24, 0, 38, 0x09, 0x00]));
    expect([...g]).toEqual([0x03, 0x24, 2, 0x35, 0x08, 1, 0x43, 0x4a, 24, 0, 0x24, 0x64, 6, 1, 0, 0]);
    // sprmTDefTable (190): one cell from 0 to 1440 with a BRCVer6 on each side, as a TC80.
    const t = TranslateSprms6(new Uint8Array([190, 16, 0, 1, 0, 0, 0xa0, 0x05, 0, 0, 0x09, 0, 0x09, 0, 0x09, 0, 0x09, 0]));
    expect([...t.subarray(0, 4)]).toEqual([0x08, 0xd6, 26, 0]);
    expect([...t.subarray(4 + 5, 4 + 5 + 8)]).toEqual([0, 0, 0, 0, 6, 1, 0, 0]);
  });

  it('picks the text encoding of a Windows charset, or of the locale (GetFIBCharset)', () => {
    expect(WW8Fib.GetFIBCharset(238, 0x409)).toBe('windows-1250');
    expect(WW8Fib.GetFIBCharset(0, 0x405)).toBe('windows-1250');
    expect(WW8Fib.GetFIBCharset(0, 0x419)).toBe('windows-1251');
    expect(WW8Fib.GetFIBCharset(128, 0x409)).toBe('shift_jis');
  });

  it('reads a Word 6 document: its text, styles and sections (tdf59896)', async () => {
    const { doc, lost } = await ImportDOC(file('tdf59896.doc'));
    const ps = paras(doc);
    expect(ps.some((p) => p.GetText() === 'Welcome to the ClarisWorks 5.0 CD for Windows!')).toBe(true);
    expect(ps.length).toBeGreaterThan(80);
    expect(lost).toEqual([]);
  });

  it('reads the 16-bit text of an Asian Word 6 document with its fonts and sizes (ooo17498-1)', async () => {
    const { doc, lost } = await ImportDOC(file('ooo17498-1.doc'));
    const ps = paras(doc);
    const title = ps.find((p) => p.GetText() === '理事会開催のお知らせ')!;
    expect(title).toBeTruthy();
    // The CJK variant's sprm 111 is the font, sprm 99 the size (16 pt); font names are Shift-JIS.
    expect(title.m_aHints[0]!.aAttrs).toMatchObject({ RES_CHRATR_FONTSIZE: 320, RES_CHRATR_FONT: 'ＭＳ Ｐ明朝' });
    expect(ps.some((p) => p.GetText().includes('2001/9/2'))).toBe(true);
    expect(lost).toEqual([]);
  });
});

describe('ImportDOC Word 6 autonumbering', () => {
  it('numbers paragraphs from their ANLDs, as LibreOffice does (tdf150197_anlv2ListFormat)', async () => {
    const { doc, lost } = await ImportDOC(file('tdf150197_anlv2ListFormat.doc'));
    const ps = paras(doc);
    const nums = NumberParagraphs(doc, ps);
    const label = (t: string) => nums.get(ps.find((p) => p.GetText() === t)!)?.label;
    // LibreOffice's testTdf150197_anlv2ListFormat (Word itself shows 2.1 for the third).
    expect(label('This is 1')).toBe('1.');
    expect(label('This is 2.')).toBe('2.');
    expect(label('This is 2.1')).toBe('4.1');
    // A new numbered run after the outline restarts; the outline continues across it.
    expect(label('This is 3')).toBe('1.');
    expect(label('This is 4.1')).toBe('4.4');
    expect(lost).toEqual([]);
  });
});

describe('ImportDOC list number types', () => {
  const labels = async (name: string) => {
    const { doc, lost } = await ImportDOC(file(name));
    const ps = paras(doc);
    const nums = NumberParagraphs(doc, ps);
    return { lost, at: (i: number) => nums.get(ps[i - 1]!), label: (i: number) => nums.get(ps[i - 1]!)?.label ?? '' };
  };
  it('spells ordinals and number names (testTdf104239_chapterNumberTortureTest, _chapterNumberingLevels)', async () => {
    const t = await labels('tdf104239_chapterNumberTortureTest.doc');
    expect(t.label(3)).toBe('1st.i.a.1.I');
    expect(t.label(7)).toBe('2nd.ii');
    expect(t.lost).toEqual([]);
    const l = await labels('tdf104239_chapterNumberingLevels.doc');
    expect([l.label(1), l.label(2), l.label(3), l.label(4), l.label(8)]).toEqual(['Article I.', '1', 'First', '', '1.1.1.1.1.1.1.1.1.']);
  });
  it('pads with a zero (testArabicZeroNumbering)', async () => {
    const t = await labels('arabic-zero-numbering.doc');
    expect(t.at(1)?.fmt.GetNumberingType()).toBe(NumberingType.ARABIC_ZERO);
    expect(t.label(1)).toBe('01.');
  });
  it('counts in Chinese (testWw8Cjklist30, 31, 34, 35, testTdf118564)', async () => {
    const types = await Promise.all(['cjklist30.doc', 'cjklist31.doc', 'cjklist34.doc', 'cjklist35.doc'].map(async (f) => (await labels(f)).at(1)?.fmt.GetNumberingType()));
    expect(types).toEqual([NumberingType.TIAN_GAN_ZH, NumberingType.DI_ZI_ZH, NumberingType.NUMBER_UPPER_ZH_TW, NumberingType.NUMBER_LOWER_ZH]);
    const zh = await labels('cjklist35.doc');
    expect([zh.label(1), zh.label(10), zh.label(11)]).toEqual(['一.', '十.', '十一.']);
    const tw = await labels('cjklist34.doc');
    expect([tw.label(2), tw.label(10)]).toEqual(['貳.', '壹拾.']);
    expect((await labels('cjklist30.doc')).label(11)).toBe('11.'); // ten heavenly stems, then digits
    expect((await labels('tdf118564.doc')).at(3)?.fmt.GetNumberingType()).toBe(NumberingType.NUMBER_LOWER_ZH);
  });
});

describe('list number types round trip', () => {
  it('keeps them through ODT and DOCX', async () => {
    const { ExportODT, ImportODT } = await import('../../src/lo/sw/source/filter/xml/odt.ts');
    const { ExportDOCX } = await import('../../src/lo/sw/source/filter/ww8/docxexport.ts');
    const { ImportDOCX } = await import('../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts');
    const typeOf = async (doc: SwDoc, i: number) => { const ps = paras(doc); return NumberParagraphs(doc, ps).get(ps[i - 1]!)?.fmt.GetNumberingType(); };
    for (const [f, i, t] of [['tdf104239_chapterNumberingLevels.doc', 3, NumberingType.TEXT_ORDINAL], ['cjklist34.doc', 1, NumberingType.NUMBER_UPPER_ZH_TW], ['arabic-zero-numbering.doc', 1, NumberingType.ARABIC_ZERO]] as const) {
      const { doc } = await ImportDOC(file(f));
      expect(await typeOf((await ImportODT(await ExportODT(doc))).doc, i)).toBe(t);
      expect(await typeOf((await ImportDOCX(await ExportDOCX(doc))).doc, i)).toBe(t);
    }
  });
});
