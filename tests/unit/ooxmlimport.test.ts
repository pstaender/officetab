import { describe, expect, it } from 'vitest';
import { childElements, parseXml } from '../../src/lo/xmloff/source/core/xmlparse.ts';
import { SmOoxmlImport } from '../../src/lo/starmath/source/ooxmlimport.ts';

const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function convert(body: string, ns = M): string {
  const root = parseXml(`<w:p xmlns:w="${W}" xmlns:mm="${ns}">${body.replace(/<(\/?)m:/g, '<$1mm:').replace(/ m:val=/g, ' mm:val=')}</w:p>`);
  const oMath = childElements(childElements(root)[0]!).find((e) => e.name === 'm:oMath')!;
  return new SmOoxmlImport(oMath).ConvertToStarMath();
}
const r = (t: string) => `<m:r><m:t>${t}</m:t></m:r>`;

describe('SmOoxmlImport', () => {
  it('fraction, with m:sty and w:rPr in the runs', () => {
    expect(convert(`<m:oMath><m:f><m:num><m:r><m:rPr><m:sty m:val="p"/></m:rPr><w:rPr><w:rFonts w:ascii="Cambria Math"/></w:rPr><m:t>1</m:t></m:r></m:num><m:den>${r('4')}</m:den></m:f></m:oMath>`))
      .toBe('{1} over {4}');
    expect(convert(`<m:oMath><m:f><m:fPr><m:type m:val="lin"/></m:fPr><m:num>${r('a')}</m:num><m:den>${r('b')}</m:den></m:f></m:oMath>`))
      .toBe('{a} / {b}');
    expect(convert(`<m:oMath><m:f><m:fPr><m:type m:val="noBar"/></m:fPr><m:num>${r('n')}</m:num><m:den>${r('k')}</m:den></m:f></m:oMath>`))
      .toBe('binom {n} {k}');
  });

  it('strict namespace', () => {
    expect(convert(`<m:oMath><m:f><m:num>${r('1')}</m:num><m:den>${r('2')}</m:den></m:f></m:oMath>`, 'http://purl.oclc.org/ooxml/officeDocument/math'))
      .toBe('{1} over {2}');
  });

  it('n-ary sum with sub and sup, escaping operators', () => {
    expect(convert(`<m:oMath><m:nary><m:naryPr><m:chr m:val="\u2211"/><m:limLoc m:val="undOvr"/></m:naryPr><m:sub>${r('i=1')}</m:sub><m:sup>${r('n')}</m:sup><m:e>${r('i')}</m:e></m:nary></m:oMath>`))
      .toBe('sum from {i"="1} to {n} {i}');
    expect(convert(`<m:oMath><m:nary><m:naryPr><m:subHide m:val="1"/><m:supHide m:val="1"/></m:naryPr><m:sub/><m:sup/><m:e>${r('x')}</m:e></m:nary></m:oMath>`))
      .toBe('int {x}');
  });

  it('radicals', () => {
    expect(convert(`<m:oMath><m:rad><m:deg>${r('3')}</m:deg><m:e>${r('x')}</m:e></m:rad></m:oMath>`)).toBe('nroot {3} {x}');
    expect(convert(`<m:oMath><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${r('x')}</m:e></m:rad></m:oMath>`)).toBe('sqrt {x}');
  });

  it('delimiters', () => {
    expect(convert(`<m:oMath><m:d><m:dPr><m:begChr m:val="["/><m:sepChr m:val=","/><m:endChr m:val="]"/></m:dPr><m:e>${r('a')}</m:e><m:e>${r('b')}</m:e></m:d></m:oMath>`))
      .toBe('left [a,b right ]');
    expect(convert(`<m:oMath><m:d><m:e>${r('a')}</m:e><m:e>${r('b')}</m:e></m:d></m:oMath>`)).toBe('left (a mline b right )');
    expect(convert(`<m:oMath><m:d><m:dPr><m:begChr m:val="{"/><m:endChr m:val=""/></m:dPr><m:e>${r('x')}</m:e></m:d></m:oMath>`))
      .toBe('left lbrace x right none');
  });

  it('scripts and placeholders', () => {
    expect(convert(`<m:oMath><m:sSup><m:e>${r('x')}</m:e><m:sup>${r('2')}</m:sup></m:sSup></m:oMath>`)).toBe('{x} ^ {2}');
    expect(convert(`<m:oMath><m:sSup><m:e/><m:sup>${r('2')}</m:sup></m:sSup></m:oMath>`)).toBe('<?> ^ {2}');
    expect(convert(`<m:oMath><m:sSubSup><m:e>${r('a')}</m:e><m:sub>${r('i')}</m:sub><m:sup>${r('2')}</m:sup></m:sSubSup></m:oMath>`))
      .toBe('{a} rsub {i} rsup {2}');
    expect(convert(`<m:oMath><m:sPre><m:sub>${r('1')}</m:sub><m:sup>${r('2')}</m:sup><m:e>${r('X')}</m:e></m:sPre></m:oMath>`))
      .toBe('{X} lsub {1} lsup {2}');
  });

  it('matrix and equation array', () => {
    expect(convert(`<m:oMath><m:m><m:mPr><m:mcs><m:mc/></m:mcs></m:mPr><m:mr><m:e>${r('1')}</m:e><m:e>${r('2')}</m:e></m:mr><m:mr><m:e>${r('3')}</m:e><m:e>${r('4')}</m:e></m:mr></m:m></m:oMath>`))
      .toBe('matrix {1 # 2 ## 3 # 4}');
    expect(convert(`<m:oMath><m:eqArr><m:e>${r('x')}</m:e><m:e>${r('y')}</m:e></m:eqArr></m:oMath>`)).toBe('stack { x # y }');
  });

  it('accents, bars and group characters', () => {
    expect(convert(`<m:oMath><m:acc><m:accPr><m:chr m:val="\u0303"/></m:accPr><m:e>${r('a')}</m:e></m:acc></m:oMath>`)).toBe('widetilde {a}');
    expect(convert(`<m:oMath><m:acc><m:e>${r('a')}</m:e></m:acc></m:oMath>`)).toBe('widehat {a}');
    expect(convert(`<m:oMath><m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${r('a')}</m:e></m:bar></m:oMath>`)).toBe('overline {a}');
    expect(convert(`<m:oMath><m:limLow><m:e><m:groupChr><m:e>${r('a')}</m:e></m:groupChr></m:e><m:lim>${r('n')}</m:lim></m:limLow></m:oMath>`))
      .toBe('{a} underbrace {n}');
    expect(convert(`<m:oMath><m:borderBox><m:borderBoxPr><m:strikeH m:val="on"/></m:borderBoxPr><m:e>${r('a')}</m:e></m:borderBox></m:oMath>`))
      .toBe('overstrike {a}');
  });

  it('functions', () => {
    expect(convert(`<m:oMath><m:func><m:funcPr/><m:fName><m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>sin</m:t></m:r></m:fName><m:e>${r('x')}</m:e></m:func></m:oMath>`))
      .toBe('sin {x}');
    expect(convert(`<m:oMath><m:func><m:fName><m:limLow><m:e>${r('lim')}</m:e><m:lim>${r('n\u2192\u221e')}</m:lim></m:limLow></m:fName><m:e>${r('a')}</m:e></m:func></m:oMath>`))
      .toBe('lim from {n\u2192\u221e} {a}');
  });

  it('runs: sequences, keywords, normal text, double-struck, preserved spaces', () => {
    expect(convert(`<m:oMath>${r('a')}${r('+')}${r('b')}</m:oMath>`)).toBe('a "+" b');
    expect(convert(`<m:oMath>${r('in')}</m:oMath>`)).toBe('"in"');
    expect(convert(`<m:oMath><m:r><m:rPr><m:nor/></m:rPr><m:t>if x</m:t></m:r></m:oMath>`)).toBe('"if x"');
    expect(convert(`<m:oMath><m:r><m:rPr><m:scr m:val="double-struck"/></m:rPr><m:t>R</m:t></m:r></m:oMath>`)).toBe('setR');
    expect(convert(`<m:oMath><m:r><m:t> a </m:t></m:r></m:oMath>`)).toBe('a');
    expect(convert(`<m:oMath><m:sSup><m:e><m:r><m:t xml:space="preserve"> </m:t></m:r></m:e><m:sup>${r('2')}</m:sup></m:sSup></m:oMath>`))
      .toBe('{" "} ^ {2}');
    expect(convert(`<m:oMath><m:unknown>${r('z')}</m:unknown>${r('y')}</m:oMath>`)).toBe('y');
  });
});
