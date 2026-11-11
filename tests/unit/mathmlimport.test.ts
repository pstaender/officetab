// MathML import (SmXMLImport + SmNodeToTextVisitor): the StarMath text of a formula. The expected
// texts are LibreOffice's own, from `soffice --convert-to odf` of the MathML as a .mml file.
import { describe, expect, it } from 'vitest';
import { ImportMathML, ImportMathMLString } from '../../src/lo/starmath/source/mathml/mathmlimport.ts';
import { childElements, parseXml } from '../../src/lo/xmloff/source/core/xmlparse.ts';

const NS = 'xmlns="http://www.w3.org/1998/Math/MathML"';
const mml = (body: string): string => ImportMathMLString(`<math ${NS}>${body}</math>`);

describe('MathML import', () => {
  it('takes the StarMath annotation when there is one', () => {
    expect(mml(
      '<semantics><mfrac><mn>1</mn><mn>4</mn></mfrac>' +
      '<annotation encoding="StarMath 5.0">{ 1 } over { 4 }</annotation></semantics>',
    )).toBe('{ 1 } over { 4 }');
    // Another encoding is ignored, the text comes from the tree.
    expect(mml('<semantics><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow><annotation encoding="TeX">x+1</annotation></semantics>'))
      .toBe('{ x + 1 }');
  });

  it('accepts the math element itself', () => {
    const root = childElements(parseXml(`<math ${NS} display="block"><mfrac><mn>1</mn><mn>4</mn></mfrac></math>`))[0]!;
    expect(ImportMathML(root)).toBe('{ frac { 1 } { 4 } }');
  });

  it('fractions', () => {
    expect(mml('<mfrac><mn>1</mn><mn>4</mn></mfrac>')).toBe('{ frac { 1 } { 4 } }');
    expect(mml('<mfrac><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><mn>2</mn></mfrac>')).toBe('{ frac { { a + b } } { 2 } }');
  });

  it('scripts', () => {
    expect(mml('<msup><mi>x</mi><mn>2</mn></msup>')).toBe('x ^ 2');
    expect(mml('<msub><mi>x</mi><mi>i</mi></msub>')).toBe('x _ i');
    expect(mml('<msubsup><mi>x</mi><mi>i</mi><mn>2</mn></msubsup>')).toBe('x ^ 2 _ i');
    expect(mml('<msup><msup><mi>x</mi><mn>2</mn></msup><mn>3</mn></msup>')).toBe('x ^ 2 ^ 3');
    expect(mml('<mmultiscripts><mi>X</mi><mi>a</mi><mi>b</mi><none/><mi>c</mi><mprescripts/><mi>d</mi><none/></mmultiscripts>'))
      .toBe('X ^ b _ a ^ c lsub d');
  });

  it('roots', () => {
    expect(mml('<msqrt><mi>x</mi><mo>+</mo><mn>1</mn></msqrt>')).toBe('sqrt { x + 1 }');
    expect(mml('<mroot><mi>x</mi><mn>3</mn></mroot>')).toBe('nroot 3 x');
    expect(mml('<mrow><msqrt></msqrt><mrow></mrow></mrow>')).toBe('{ sqrt { } { } }');
  });

  it('brackets', () => {
    expect(mml('<mrow><mo fence="true">(</mo><mi>a</mi><mo>+</mo><mi>b</mi><mo fence="true">)</mo></mrow>')).toBe('{ ( a + b ) }');
    expect(mml('<mrow><mo stretchy="true">(</mo><mi>a</mi><mo>+</mo><mi>b</mi><mo stretchy="true">)</mo></mrow>'))
      .toBe('left ( { a + b } right )');
    // Upstream takes the closing bracket from the opening one when only that is stretchy.
    expect(mml('<mrow><mo stretchy="true">(</mo><mi>a</mi><mo>+</mo><mi>b</mi></mrow>')).toBe('left ( { a + b } right (');
    expect(mml('<mfenced open="[" close="]"><mi>a</mi><mi>b</mi></mfenced>')).toBe('left [ { a b } right ]');
    expect(mml('<mrow><mi>f</mi><mfenced><mi>a</mi><mi>b</mi><mi>c</mi></mfenced></mrow>'))
      .toBe('{ f left ( { a uoper ) b uoper ) c } right ) }');
  });

  it('under and over scripts', () => {
    expect(mml('<munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><msub><mi>a</mi><mi>i</mi></msub>'))
      .toBe('sum csup n csub { i = 1 } newline a _ i');
    expect(mml('<mrow><munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><msub><mi>a</mi><mi>i</mi></msub></mrow>'))
      .toBe('{ sum csup n csub { i = 1 } a _ i }');
    expect(mml('<mrow><mover accent="true"><mi>x</mi><mo>^</mo></mover><mover><mi>x</mi><mo>¯</mo></mover>' +
      '<munder><mi>lim</mi><mrow><mi>x</mi><mo>→</mo><mn>0</mn></mrow></munder></mrow>'))
      .toBe('{ x x csup ¯ nitalic lim csub { x toward 0 } }');
  });

  it('tables', () => {
    expect(mml('<mtable><mtr><mtd><mn>1</mn></mtd><mtd><mn>2</mn></mtd></mtr>' +
      '<mtr><mtd><mn>3</mn></mtd><mtd><mi>x</mi><mo>+</mo><mn>1</mn></mtd></mtr></mtable>'))
      .toBe('matrix{ 1 # 2 ## 3 # { x + 1 } }');
  });

  it('identifiers: one letter italic, longer ones and mathvariant normal upright', () => {
    expect(mml('<mrow><mi>x</mi><mi>sin</mi><mi mathvariant="normal">x</mi><mi mathvariant="bold">y</mi><mi fontstyle="italic">ab</mi></mrow>'))
      .toBe('{ x nitalic sin nitalic x bold y nitalic ab }');
  });

  it('text and strings', () => {
    expect(mml('<mrow><mtext>if </mtext><ms>s</ms><mi>x</mi></mrow>')).toBe('{ "if" ""s"" x }');
  });

  it('operators', () => {
    expect(mml('<mrow><mi>a</mi><mo>+</mo><mi>b</mi><mo>−</mo><mi>c</mi><mo>=</mo><mi>d</mi><mo>×</mo><mi>e</mi>' +
      '<mo>,</mo><mo>sin</mo><mo>≤</mo><mo>→</mo><mo>∞</mo><mo>·</mo><mo>-</mo></mrow>'))
      .toBe('{ a + b - c = d times e , nitalic s <= toward infinity · - }');
  });

  it('style, spaces, phantoms and actions', () => {
    expect(mml('<mrow><mstyle mathcolor="red"><mi>x</mi></mstyle><mstyle mathcolor="#123456" mathsize="200%"><mi>y</mi><mi>z</mi></mstyle>' +
      '<mstyle mathsize="12pt" fontweight="bold"><mi>w</mi></mstyle></mrow>'))
      .toBe('{ color red x color rgb 18 52 86 size *2 { y z } size 12 bold w }');
    expect(mml('<mrow><mi>a</mi><mspace width="1em"/><mi>b</mi><mspace width="4.5em"/><mi>c</mi></mrow>')).toBe('{ a `` b ~~` c }');
    expect(mml('<mrow><mphantom><mi>x</mi></mphantom><menclose><mi>y</mi></menclose><mpadded><mi>a</mi><mi>b</mi></mpadded>' +
      '<maction selection="2"><mi>p</mi><mi>q</mi></maction><merror><mi>e</mi></merror></mrow>'))
      .toBe('{ phantom x y { a b } q }');
  });

  it('puts the children of math after the first on lines of their own', () => {
    expect(mml('<mi>x</mi><mo>+</mo><mn>1</mn>')).toBe('x newline + newline 1');
  });

  it('reads prefixed MathML and skips foreign elements', () => {
    expect(ImportMathMLString(
      '<m:math xmlns:m="http://www.w3.org/1998/Math/MathML"><m:mrow><m:mi>a</m:mi><m:mo>=</m:mo>' +
      '<x:foo xmlns:x="urn:other"><m:mi>b</m:mi></x:foo><m:mn>2</m:mn></m:mrow></m:math>',
    )).toBe('{ a = 2 }');
    expect(ImportMathMLString(
      '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
      'xmlns:math="http://www.w3.org/1998/Math/MathML"><math:math><math:semantics><math:mi>x</math:mi>' +
      '<math:annotation math:encoding="StarMath 5.0">x</math:annotation></math:semantics></math:math></office:document-content>',
    )).toBe('x');
    expect(ImportMathMLString('<p/>')).toBe('');
  });
});
