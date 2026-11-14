import { describe, expect, it } from 'vitest';
import { SwDoc, SwPosition } from '../../src/lo/sw/inc/doc.ts';
import { SwPaM } from '../../src/lo/sw/inc/pam.ts';
import { ExportODT, ImportODT, toTwips } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { ExportText, ImportText } from '../../src/lo/sw/source/filter/ascii/ascii.ts';
import { crc32, readZip, writeZip } from '../../src/lo/package/source/zipapi/zip.ts';
import { parseXml, XmlParseError } from '../../src/lo/xmloff/source/core/xmlparse.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';

const enc = new TextEncoder();
const paraList = (doc: SwDoc) => {
  const out: SwTextNode[] = [];
  for (let n: SwTextNode | null = doc.GetNodes().FirstTextNode(); n; n = doc.GetNodes().GoNext(n.GetIndex())) out.push(n);
  return out;
};

describe('zip', () => {
  it('computes the standard CRC-32 check value', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
  });
  it('round-trips stored and deflated entries with an uncompressed first entry', async () => {
    const z = await writeZip([{ name: 'mimetype', data: enc.encode('abc'), store: true }, { name: 'ä/b.xml', data: enc.encode('x'.repeat(5000)) }]);
    expect(new TextDecoder().decode(z.subarray(30, 38))).toBe('mimetype');
    const m = await readZip(z);
    expect(new TextDecoder().decode(m.get('mimetype'))).toBe('abc');
    expect(m.get('ä/b.xml')!.length).toBe(5000);
  });
  it('rejects data that is not a zip', async () => {
    await expect(readZip(enc.encode('hello world, this is not a zip file'))).rejects.toThrow('Not a zip');
  });
});

describe('xml', () => {
  it('normalises arbitrary namespace prefixes', () => {
    const r = parseXml('<x:p xmlns:x="urn:oasis:names:tc:opendocument:xmlns:text:1.0" x:style-name="a &amp; b">t&lt;</x:p>');
    const el = r.children[0] as { name: string; attrs: Map<string, string>; children: string[] };
    expect(el.name).toBe('text:p');
    expect(el.attrs.get('text:style-name')).toBe('a & b');
    expect(el.children).toEqual(['t<']);
  });
  it('fails on unbalanced documents', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(XmlParseError);
    expect(() => parseXml('<a></b>')).toThrow(XmlParseError);
    expect(() => parseXml('</a>')).toThrow(XmlParseError);
    expect(() => parseXml('<a>')).toThrow(XmlParseError);
  });
});

describe('units', () => {
  it('converts ODF lengths to twips', () => {
    expect(toTwips('1in')).toBe(1440);
    expect(toTwips('12pt')).toBe(240);
    expect(toTwips('2.54cm')).toBe(1440);
    expect(toTwips('bogus')).toBeUndefined();
  });
});

describe('ODT round trip', () => {
  function sample() {
    const doc = new SwDoc();
    const pam = new SwPaM(new SwPosition(doc.GetNodes().FirstTextNode(), 0));
    doc.InsertString(pam, 'Heading');
    doc.SetTextFormatColl(pam, doc.FindTextFormatCollByName('Heading 1')!);
    doc.SplitNode(pam);
    doc.InsertString(pam, '  two  spaces\tand tab <&> "q"\nline ');
    const para = pam.GetPoint().GetNode();
    para.SetAttr(2, 5, { RES_CHRATR_WEIGHT: true, RES_CHRATR_COLOR: '#ff0000' });
    para.SetAttr(5, 8, { RES_CHRATR_UNDERLINE: 'double', RES_CHRATR_ESCAPEMENT: 33 });
    doc.SetParaAttr(pam, { RES_PARATR_ADJUST: 'block', RES_LR_SPACE: { left: 567, right: 283, firstLine: 142 }, RES_PARATR_LINESPACING: { rule: 'proportional', value: 150 }, RES_BREAK: 'page-before' });
    doc.SplitNode(pam);
    doc.SetParaAttr(pam, { RES_PARATR_LINESPACING: { rule: 'min', value: 400 } });
    doc.m_aPageDesc.nWidth = 16838; doc.m_aPageDesc.nHeight = 11906; doc.m_aPageDesc.nLeft = 720;
    return doc;
  }

  it('preserves text, whitespace, attributes, styles and page geometry', async () => {
    const src = sample();
    const { doc, lost } = await ImportODT(await ExportODT(src));
    expect(lost).toEqual([]);
    const [a, b, c] = paraList(doc), [sa, sb] = paraList(src);
    expect(paraList(doc).map((n) => n.GetText())).toEqual(paraList(src).map((n) => n.GetText()));
    expect(a!.GetTextColl().GetName()).toBe('Heading 1');
    expect(a!.GetAttr('RES_CHRATR_FONTSIZE')).toBe(sa!.GetAttr('RES_CHRATR_FONTSIZE'));
    expect(b!.m_aHints.map((h) => [h.nStart, h.nEnd])).toEqual(sb!.m_aHints.map((h) => [h.nStart, h.nEnd]));
    expect(b!.GetCharAttrAt('RES_CHRATR_WEIGHT', 3)).toBe(true);
    expect(b!.GetCharAttrAt('RES_CHRATR_COLOR', 3)).toBe('#ff0000');
    expect(b!.GetCharAttrAt('RES_CHRATR_UNDERLINE', 6)).toBe('double');
    expect(b!.GetCharAttrAt('RES_CHRATR_ESCAPEMENT', 6)).toBe(33);
    expect(b!.GetAttr('RES_PARATR_ADJUST')).toBe('block');
    expect(b!.GetAttr('RES_LR_SPACE')).toEqual({ left: 567, right: 283, firstLine: 142 });
    expect(b!.GetAttr('RES_PARATR_LINESPACING')).toEqual({ rule: 'proportional', value: 150 });
    expect(b!.GetAttr('RES_BREAK')).toBe('page-before');
    expect(c!.GetAttr('RES_PARATR_LINESPACING')).toEqual({ rule: 'min', value: 400 });
    expect([doc.m_aPageDesc.nWidth, doc.m_aPageDesc.nHeight, doc.m_aPageDesc.nLeft]).toEqual([16838, 11906, 720]);
    expect(doc.IsModified()).toBe(false);
  });

  it('writes the mimetype first and uncompressed, as ODF requires', async () => {
    const z = await ExportODT(sample());
    expect(new TextDecoder().decode(z.subarray(30, 38))).toBe('mimetype');
    expect(new TextDecoder().decode(z.subarray(38, 77))).toBe('application/vnd.oasis.opendocument.text');
  });

  it('reports unsupported content rather than dropping it silently', async () => {
    const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"';
    const xml = `<office:document-content ${NS}><office:body><office:text><text:p>a<draw:frame/></text:p><table:table><table:table-row><table:table-cell><text:p>cell</text:p></table:table-cell></table:table-row></table:table><text:list><text:list-item><text:p>item</text:p></text:list-item></text:list></office:text></office:body></office:document-content>`;
    const { doc, lost } = await ImportODT(await writeZip([{ name: 'content.xml', data: enc.encode(xml) }]));
    expect(paraList(doc).map((n) => n.GetText())).toEqual(['a', 'cell', 'item']);
    expect(lost.sort()).toEqual(['objects and images in formats a browser cannot show']);
  });
});

describe('plain text', () => {
  it('maps lines to paragraphs and back', () => {
    const doc = ImportText('﻿one\r\ntwo\n\nfour\n');
    expect(paraList(doc).map((n) => n.GetText())).toEqual(['one', 'two', '', 'four']);
    expect(ExportText(doc)).toBe('one\ntwo\n\nfour\n');
  });
});

describe('ODT text templates', () => {
  it('writes the template media type and reads it back', async () => {
    const dec = (b?: Uint8Array) => new TextDecoder().decode(b);
    const ott = await ExportODT(new SwDoc(), [], true);
    const files = await readZip(ott);
    expect(dec(files.get('mimetype'))).toBe('application/vnd.oasis.opendocument.text-template');
    expect(dec(files.get('META-INF/manifest.xml'))).toContain('manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.text-template"');
    expect((await ImportODT(ott)).template).toBe(true);
    const odt = await ExportODT(new SwDoc());
    expect(dec((await readZip(odt)).get('mimetype'))).toBe('application/vnd.oasis.opendocument.text');
    expect((await ImportODT(odt)).template).toBe(false);
  });
});
