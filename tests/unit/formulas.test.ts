// Formulas in Writer: Math objects anchored as characters, from and to DOCX (OMML) and ODT
// (MathML objects), their size and baseline in the line, and editing them.
import { describe, expect, it } from 'vitest';
import { writeZip, readZip } from '../../src/lo/package/source/zipapi/zip.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import { ExportDOCX } from '../../src/lo/sw/source/filter/ww8/docxexport.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';
import type { SwFlyCnt } from '../../src/lo/sw/inc/hintids.ts';
import { measurer } from './starmath.test.ts';

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const FRAC = '<m:oMath><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>4</m:t></m:r></m:den></m:f></m:oMath>';

async function docx(body: string): Promise<{ doc: SwDoc; lost: string[] }> {
  const enc = new TextEncoder();
  const r = await ImportDOCX(await writeZip([
    { name: 'word/document.xml', data: enc.encode(`<w:document ${NS}><w:body>${body}</w:body></w:document>`) },
    { name: 'word/styles.xml', data: enc.encode(`<w:styles ${NS}/>`) },
  ]));
  return { doc: r.doc, lost: [...r.lost] };
}
const formulas = (doc: SwDoc): { node: SwTextNode; fly: SwFlyCnt }[] => {
  const out: { node: SwTextNode; fly: SwFlyCnt }[] = [];
  for (const node of doc.allText()) for (let i = 0; i < node.Len(); i++) { const fly = node.GetCharAttrAt('RES_TXTATR_FLYCNT', i); if (fly?.math) out.push({ node, fly }); }
  return out;
};

describe('Formulas from DOCX', () => {
  it('reads m:oMath as a formula in the line, aligned to the baseline', async () => {
    const { doc, lost } = await docx(`<w:p><w:r><w:t xml:space="preserve">Colour </w:t></w:r>${FRAC}<w:r><w:t xml:space="preserve"> blue.</w:t></w:r></w:p>`);
    expect(lost).toEqual([]);
    const [f] = formulas(doc);
    expect(f!.fly.math).toEqual({ m_sText: '{1} over {4}', m_bBaseline: true });
    expect(f!.node.GetText().replace(/[^\w .]/g, '#')).toBe('Colour # blue.');
  });

  it('centres a paragraph of m:oMathPara unless it says otherwise', async () => {
    const { doc } = await docx(`<w:p><m:oMathPara>${FRAC}</m:oMathPara></w:p><m:oMathPara><m:oMathParaPr><m:jc m:val="left"/></m:oMathParaPr>${FRAC}</m:oMathPara>`);
    const f = formulas(doc);
    expect(f.length).toBe(2);
    expect(f[0]!.node.GetAttr('RES_PARATR_ADJUST')).toBe('center');
    expect(f[1]!.node.GetAttr('RES_PARATR_ADJUST')).toBe('left');
  });

  it('lays out the formula with its baseline on the line baseline', async () => {
    const { doc } = await docx(`<w:p><w:r><w:t>x</w:t></w:r>${FRAC}</w:p>`);
    const sh = new SwWrtShell(doc, measurer);
    const line = sh.m_pRoot.pages[0]!.frames[0]!.lines[0]!;
    const p = line.portions.find((q) => q.pFly)!;
    // the fraction reaches above and below the text: the line is higher than a text line
    expect(p.pFly!.height).toBeGreaterThan(2 * 240);
    expect(p.pFly!.m_nAscent).toBeGreaterThan(0);
    expect(p.pFly!.m_nAscent).toBeLessThan(p.pFly!.height);
    expect(line.nAscent).toBeGreaterThanOrEqual(p.pFly!.m_nAscent!);
    expect(line.nHeight).toBeGreaterThanOrEqual(p.pFly!.height);
  });

  it('writes the formula back as m:oMath', async () => {
    const { doc } = await docx(`<w:p>${FRAC}</w:p>`);
    const out = await readZip(await ExportDOCX(doc));
    const xml = new TextDecoder().decode(out.get('word/document.xml'));
    expect(xml).toContain('<m:oMath');
    expect(xml).toContain('<m:f>');
    const again = await ImportDOCX(await ExportDOCX(doc));
    expect(formulas(again.doc)[0]!.fly.math!.m_sText).toBe('{1} over {4}');
  });
});

describe('Formulas in ODT', () => {
  it('saves a formula as an embedded MathML object and reads it back', async () => {
    const doc = new SwDoc();
    const sh = new SwWrtShell(doc, measurer);
    sh.Insert('a ');
    sh.InsertObjectStarMath('sqrt{x^2 + 1}');
    const bytes = await ExportODT(doc);
    const files = await readZip(bytes);
    const content = new TextDecoder().decode(files.get('content.xml'));
    expect(content).toMatch(/<draw:frame[^>]*text:anchor-type="as-char"[^>]*><draw:object xlink:href="\.\/Object 1"/);
    expect(new TextDecoder().decode(files.get('Object 1/content.xml'))).toContain('<annotation encoding="StarMath 5.0">sqrt{x^2 + 1}</annotation>');
    expect(new TextDecoder().decode(files.get('META-INF/manifest.xml'))).toContain('manifest:full-path="Object 1/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.formula"');
    const back = (await ImportODT(bytes)).doc;
    expect(formulas(back)[0]!.fly.math).toEqual({ m_sText: 'sqrt{x^2 + 1}', m_bBaseline: true });
  });

  it('reads a formula without annotation (as Word writes ODT) from its MathML', async () => {
    const enc = new TextEncoder();
    const C = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"';
    const bytes = await writeZip([
      { name: 'mimetype', data: enc.encode('application/vnd.oasis.opendocument.text') },
      { name: 'content.xml', data: enc.encode(`<office:document-content ${C}><office:automatic-styles><style:style style:family="graphic" style:name="a12"><style:graphic-properties style:vertical-pos="middle"/></style:style></office:automatic-styles><office:body><office:text><text:p>Colour <draw:frame draw:style-name="a12" text:anchor-type="as-char" svg:width="0.1in" svg:height="0.375in"><draw:object xlink:href="Object 1/"/></draw:frame> blue.</text:p></office:text></office:body></office:document-content>`) },
      { name: 'Object 1/content.xml', data: enc.encode('<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mfrac><mn>1</mn><mn>4</mn></mfrac></math>') },
    ]);
    const r = await ImportODT(bytes);
    expect([...r.lost]).toEqual([]);
    expect(formulas(r.doc)[0]!.fly.math).toEqual({ m_sText: '{ frac { 1 } { 4 } }', m_eVertOrient: 'center' });
  });
});

describe('Editing formulas', () => {
  it('inserts a formula, changes its text and undoes both', () => {
    const doc = new SwDoc();
    const sh = new SwWrtShell(doc, measurer);
    const name = sh.InsertObjectStarMath('a over b');
    expect(sh.IsOLEMath()).toBe(true);
    expect(sh.GetFlyFrameFormat()!.m_aName).toBe(name);
    expect(sh.SetFormulaText('a over c')).toBe(true);
    expect(formulas(doc)[0]!.fly.math!.m_sText).toBe('a over c');
    sh.Undo();
    expect(formulas(doc)[0]!.fly.math!.m_sText).toBe('a over b');
    sh.Undo();
    expect(formulas(doc)).toEqual([]);
  });
});
