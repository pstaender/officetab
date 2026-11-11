import { describe, expect, it } from 'vitest';
import {
  DocumentType, eFormulaAlign, ExportOMML, OoxmlVersion,
} from '../../src/lo/starmath/source/ooxmlexport.ts';
import { SmOoxmlImport } from '../../src/lo/starmath/source/ooxmlimport.ts';
import { childElements, parseXml } from '../../src/lo/xmloff/source/core/xmlparse.ts';

const NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const oMath = (s: string) => `<m:oMath xmlns:m="${NS}">${s}</m:oMath>`;
const r = (t: string) => `<m:r><m:t xml:space="preserve">${t}</m:t></m:r>`;

function roundTrip(rText: string): string {
  const root = parseXml(`<w xmlns:m="${NS}">${ExportOMML(rText)}</w>`);
  const e = childElements(childElements(root)[0]!).find((c) => c.name === 'm:oMath')!;
  return new SmOoxmlImport(e).ConvertToStarMath();
}

describe('SmOoxmlExport', () => {
  it('fractions: over, and / as a linear fraction', () => {
    expect(ExportOMML('{a} over {b}')).toBe(oMath(`<m:f><m:num>${r('a')}</m:num><m:den>${r('b')}</m:den></m:f>`));
    expect(ExportOMML('a / b')).toBe(oMath(`<m:f><m:fPr><m:type m:val="lin"/></m:fPr><m:num>${r('a')}</m:num><m:den>${r('b')}</m:den></m:f>`));
  });

  it('sub- and superscripts', () => {
    expect(ExportOMML('x^2')).toBe(oMath(`<m:sSup><m:e>${r('x')}</m:e><m:sup>${r('2')}</m:sup></m:sSup>`));
    expect(ExportOMML('x_i')).toBe(oMath(`<m:sSub><m:e>${r('x')}</m:e><m:sub>${r('i')}</m:sub></m:sSub>`));
    expect(ExportOMML('x_i^2')).toBe(oMath(`<m:sSubSup><m:e>${r('x')}</m:e><m:sub>${r('i')}</m:sub><m:sup>${r('2')}</m:sup></m:sSubSup>`));
    expect(ExportOMML('x lsub i lsup j')).toBe(oMath(`<m:sPre><m:sub>${r('i')}</m:sub><m:sup>${r('j')}</m:sup><m:e>${r('x')}</m:e></m:sPre>`));
    // right and left scripts nest: the right ones outside
    expect(ExportOMML('x lsub i lsup j ^2')).toBe(oMath(`<m:sSup><m:e><m:sPre><m:sub>${r('i')}</m:sub><m:sup>${r('j')}</m:sup><m:e>${r('x')}</m:e></m:sPre></m:e><m:sup>${r('2')}</m:sup></m:sSup>`));
    expect(ExportOMML('x csub a')).toBe(oMath(`<m:limLow><m:e>${r('x')}</m:e><m:lim>${r('a')}</m:lim></m:limLow>`));
    expect(ExportOMML('x csup a')).toBe(oMath(`<m:limUpp><m:e>${r('x')}</m:e><m:lim>${r('a')}</m:lim></m:limUpp>`));
  });

  it('roots', () => {
    expect(ExportOMML('sqrt{x}')).toBe(oMath(`<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${r('x')}</m:e></m:rad>`));
    expect(ExportOMML('nroot{3}{x}')).toBe(oMath(`<m:rad><m:deg>${r('3')}</m:deg><m:e>${r('x')}</m:e></m:rad>`));
  });

  it('n-ary operators, with and without limits, and lim', () => {
    expect(ExportOMML('sum from {i=1} to n i')).toBe(oMath(
      `<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub>${r('i')}${r('=')}${r('1')}</m:sub><m:sup>${r('n')}</m:sup><m:e>${r('i')}</m:e></m:nary>`));
    expect(ExportOMML('int x')).toBe(oMath(
      `<m:nary><m:naryPr><m:chr m:val="∫"/><m:subHide m:val="1"/><m:supHide m:val="1"/></m:naryPr><m:sub/><m:sup/><m:e>${r('x')}</m:e></m:nary>`));
    expect(ExportOMML('prod from k x')).toBe(oMath(
      `<m:nary><m:naryPr><m:chr m:val="∏"/><m:supHide m:val="1"/></m:naryPr><m:sub>${r('k')}</m:sub><m:sup/><m:e>${r('x')}</m:e></m:nary>`));
    expect(ExportOMML('lim from {x->0} f')).toBe(oMath(
      `<m:func><m:fName><m:limLow><m:e>${r('lim')}</m:e><m:lim>${r('x')}${r('→')}${r('0')}</m:lim></m:limLow></m:fName><m:e>${r('f')}</m:e></m:func>`));
  });

  it('braces, with separators and none', () => {
    expect(ExportOMML('left( a+b right)')).toBe(oMath(
      `<m:d><m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr><m:e>${r('a')}${r('+')}${r('b')}</m:e></m:d>`));
    expect(ExportOMML('left lbrace a mline b right rbrace')).toBe(oMath(
      `<m:d><m:dPr><m:begChr m:val="{"/><m:sepChr m:val="|"/><m:endChr m:val="}"/></m:dPr><m:e>${r('a')}</m:e><m:e>${r('b')}</m:e></m:d>`));
    expect(ExportOMML('left none a right )')).toBe(oMath(
      `<m:d><m:dPr><m:begChr m:val=""/><m:endChr m:val=")"/></m:dPr><m:e>${r('a')}</m:e></m:d>`));
  });

  it('vertical braces', () => {
    expect(ExportOMML('{a} overbrace {b}')).toBe(oMath(
      `<m:limUpp><m:e><m:groupChr><m:groupChrPr><m:chr m:val="⏞"/><m:pos m:val="top"/><m:vertJc m:val="bot"/></m:groupChrPr><m:e>${r('a')}</m:e></m:groupChr></m:e><m:lim>${r('b')}</m:lim></m:limUpp>`));
    expect(ExportOMML('{a} underbrace {b}')).toBe(oMath(
      `<m:limLow><m:e><m:groupChr><m:groupChrPr><m:chr m:val="⏟"/><m:pos m:val="bot"/><m:vertJc m:val="top"/></m:groupChrPr><m:e>${r('a')}</m:e></m:groupChr></m:e><m:lim>${r('b')}</m:lim></m:limLow>`));
  });

  it('matrix and stack', () => {
    expect(ExportOMML('matrix{a # b ## c # d}')).toBe(oMath(
      `<m:m><m:mr><m:e>${r('a')}</m:e><m:e>${r('b')}</m:e></m:mr><m:mr><m:e>${r('c')}</m:e><m:e>${r('d')}</m:e></m:mr></m:m>`));
    expect(ExportOMML('stack{a # b}')).toBe(oMath(`<m:eqArr><m:e>${r('a')}</m:e><m:e>${r('b')}</m:e></m:eqArr>`));
    // more than one line: the table itself is a vertical stack
    expect(ExportOMML('a newline b')).toBe(oMath(`<m:eqArr><m:e>${r('a')}</m:e><m:e>${r('b')}</m:e></m:eqArr>`));
  });

  it('attributes: accents, bars and overstrike', () => {
    const acc = (c: string, b: string) => `<m:acc><m:accPr><m:chr m:val="${c}"/></m:accPr><m:e>${r(b)}</m:e></m:acc>`;
    expect(ExportOMML('vec a + hat b + bar c')).toBe(oMath(`${acc('⃗', 'a')}${r('+')}${acc('^', 'b')}${r('+')}${acc('¯', 'c')}`));
    expect(ExportOMML('overline a')).toBe(oMath(`<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${r('a')}</m:e></m:bar>`));
    expect(ExportOMML('underline a')).toBe(oMath(`<m:bar><m:barPr><m:pos m:val="bot"/></m:barPr><m:e>${r('a')}</m:e></m:bar>`));
    expect(ExportOMML('overstrike a')).toBe(oMath(
      `<m:borderBox><m:borderBoxPr><m:hideTop m:val="1"/><m:hideBot m:val="1"/><m:hideLeft m:val="1"/><m:hideRight m:val="1"/><m:strikeH m:val="1"/></m:borderBoxPr><m:e>${r('a')}</m:e></m:borderBox>`));
  });

  it('text, functions, symbols, blanks and escaping', () => {
    expect(ExportOMML('"text"')).toBe(oMath(`<m:r><m:rPr><m:lit/><m:nor/></m:rPr><m:t xml:space="preserve">text</m:t></m:r>`));
    expect(ExportOMML('sin x')).toBe(oMath(`${r('sin')}${r('x')}`));
    expect(ExportOMML('%alpha')).toBe(oMath(r('α')));
    expect(ExportOMML('a ~ b')).toBe(oMath(`${r('a')}${r(' ')}${r('b')}`));
    expect(ExportOMML('a < b')).toBe(oMath(`${r('a')}${r('&lt;')}${r('b')}`));
    expect(ExportOMML('"a&b"')).toBe(oMath(`<m:r><m:rPr><m:lit/><m:nor/></m:rPr><m:t xml:space="preserve">a&amp;b</m:t></m:r>`));
    // a placeholder is left out: Word shows its own
    expect(ExportOMML('<?> over b')).toBe(oMath(`<m:f><m:num></m:num><m:den>${r('b')}</m:den></m:f>`));
  });

  it('aligned formulas and the Word 2007 font hack', () => {
    expect(ExportOMML('a', eFormulaAlign.CENTER)).toBe(
      `<m:oMathPara xmlns:m="${NS}"><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr><m:oMath>${r('a')}</m:oMath></m:oMathPara>`);
    expect(ExportOMML('a', eFormulaAlign.LEFT, OoxmlVersion.ISOIEC_29500_2008, DocumentType.DOCUMENT_PPTX)).toBe(oMath(r('a')));
    expect(ExportOMML('a', eFormulaAlign.INLINE, OoxmlVersion.ECMA_376_1ST_EDITION)).toBe(oMath(
      `<m:r><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr><m:t xml:space="preserve">a</m:t></m:r>`));
  });

  it('round-trips through SmOoxmlImport', () => {
    expect(roundTrip('{a} over {b}')).toBe('{a} over {b}');
    expect(roundTrip('a / b')).toBe('{a} / {b}');
    expect(roundTrip('x^2')).toBe('{x} ^ {2}');
    expect(roundTrip('x_i^2')).toBe('{x} rsub {i} rsup {2}');
    expect(roundTrip('sqrt{x}')).toBe('sqrt {x}');
    expect(roundTrip('nroot{3}{x}')).toBe('nroot {3} {x}');
    expect(roundTrip('int from 0 to 1 x')).toBe('int from {0} to {1} {x}');
    expect(roundTrip('matrix{a # b ## c # d}')).toBe('matrix {a # b ## c # d}');
    expect(roundTrip('left lbrace a mline b right rbrace')).toBe('left lbrace a mline b right rbrace');
    expect(roundTrip('"text"')).toBe('"text"');
    expect(roundTrip('sin x')).toBe('sin x');
    expect(roundTrip('underline a')).toBe('underline {a}');
    expect(roundTrip('overstrike a')).toBe('overstrike {a}');
    expect(roundTrip('stack{a # b}')).toBe('stack { a # b }');
  });
});
