// Word 97-2003 import (sw/source/filter/ww8): the compound document, the text and its properties.
// The documents are LibreOffice's test files (sw/qa/filter/ww8/data, sw/qa/extras/ww8import/data).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Storage, IsStorageFile } from '../../src/lo/sot/source/sdstor/storage.ts';
import { ImportDOC } from '../../src/lo/sw/source/filter/ww8/ww8par.ts';
import type { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';

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
    // What is not ported yet is reported.
    expect(lost).toEqual(expect.arrayContaining(['endnotes', 'headers and footers']));
  });

  it('reports tables, whose cells are kept as paragraphs', async () => {
    const { doc, lost } = await ImportDOC(file('n816593.doc'));
    expect(paras(doc).map((p) => p.GetText())).toEqual(expect.arrayContaining(['First table', 'Second table']));
    expect(lost).toContain('tables (their cells are kept as paragraphs)');
  });

  it('refuses what is not a Word 97-2003 document', async () => {
    await expect(ImportDOC(new TextEncoder().encode('Word 2 document'))).rejects.toThrow(/not a Word 97-2003 document/);
  });
});
