// MathML export (SmXMLExport): the content.xml of a formula object. The expected MathML is
// LibreOffice's own: `soffice --convert-to odf` of a .mml file carrying the formula as its
// StarMath annotation, and the formula objects of specs/writer/math.docx converted to ODT.
import { describe, expect, it } from 'vitest';
import { ExportMathML } from '../../src/lo/starmath/source/mathml/mathmlexport.ts';
import { ImportMathMLString } from '../../src/lo/starmath/source/mathml/mathmlimport.ts';
import { SmFormat } from '../../src/lo/starmath/source/format.ts';

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><semantics>';
/** The presentation MathML between <semantics> and the annotation. */
const body = (xml: string): string => {
  expect(xml.startsWith(HEAD)).toBe(true);
  return xml.slice(HEAD.length, xml.indexOf('<annotation '));
};

// [StarMath text, LibreOffice's presentation MathML]
const CASES: [string, string][] = [
  ["sum from{i=1} to n i^2",
    "<mrow><munderover><mo stretchy=\"false\">∑</mo><mrow><mi>i</mi><mo stretchy=\"false\">=</mo><mn>1</mn></mrow><mi>n</mi></munderover><msup><mi>i</mi><mn>2</mn></msup></mrow>"],
  ["left( a right) + left[ b right] + (c) + lbrace x rbrace",
    "<mrow><mrow><mo fence=\"true\" form=\"prefix\" stretchy=\"true\">(</mo><mrow><mi>a</mi></mrow><mo fence=\"true\" form=\"postfix\" stretchy=\"true\">)</mo></mrow><mo stretchy=\"false\">+</mo><mrow><mo fence=\"true\" form=\"prefix\" stretchy=\"true\">[</mo><mrow><mi>b</mi></mrow><mo fence=\"true\" form=\"postfix\" stretchy=\"true\">]</mo></mrow><mo stretchy=\"false\">+</mo><mrow><mo fence=\"true\" form=\"prefix\" stretchy=\"false\">(</mo><mrow><mi>c</mi></mrow><mo fence=\"true\" form=\"postfix\" stretchy=\"false\">)</mo></mrow><mo stretchy=\"false\">+</mo><mrow><mo fence=\"true\" form=\"prefix\" stretchy=\"false\">{</mo><mrow><mi>x</mi></mrow><mo fence=\"true\" form=\"postfix\" stretchy=\"false\">}</mo></mrow></mrow>"],
  ["matrix{a # b ## c # d}",
    "<mtable><mtr><mtd><mi>a</mi></mtd><mtd><mi>b</mi></mtd></mtr><mtr><mtd><mi>c</mi></mtd><mtd><mi>d</mi></mtd></mtr></mtable>"],
  ["hat a + vec b + overline{xy} + underline z + widehat{abc} + overstrike q",
    "<mrow><mover accent=\"true\"><mi>a</mi><mo stretchy=\"false\">^</mo></mover><mo stretchy=\"false\">+</mo><mover accent=\"true\"><mi>b</mi><mo stretchy=\"false\">⃗</mo></mover><mo stretchy=\"false\">+</mo><mover accent=\"true\"><mi mathvariant=\"italic\">xy</mi><mo>¯</mo></mover><mo stretchy=\"false\">+</mo><munder accentunder=\"true\"><mi>z</mi><mo>̲</mo></munder><mo stretchy=\"false\">+</mo><mover accent=\"true\"><mi mathvariant=\"italic\">abc</mi><mo stretchy=\"true\">^</mo></mover><mo stretchy=\"false\">+</mo><menclose notation=\"horizontalstrike\"><mi>q</mi></menclose></mrow>"],
  ["sin x + func f(x) + ln x",
    "<mrow><mi>sin</mi><mrow><mi>x</mi><mo stretchy=\"false\">+</mo><mi mathvariant=\"normal\">f</mi></mrow><mrow><mrow><mo fence=\"true\" form=\"prefix\" stretchy=\"false\">(</mo><mrow><mi>x</mi></mrow><mo fence=\"true\" form=\"postfix\" stretchy=\"false\">)</mo></mrow><mo stretchy=\"false\">+</mo><mi>ln</mi></mrow><mi>x</mi></mrow>"],
  ["\"hello world\" + 3.14 + abc",
    "<mrow><mtext>hello world</mtext><mo stretchy=\"false\">+</mo><mn>3.14</mn><mo stretchy=\"false\">+</mo><mi mathvariant=\"italic\">abc</mi></mrow>"],
  ["int from a to b f(x) dx + lim from {x->0} y",
    "<mrow><mrow><munderover><mo stretchy=\"false\">∫</mo><mi>a</mi><mi>b</mi></munderover><mi>f</mi></mrow><mrow><mo fence=\"true\" form=\"prefix\" stretchy=\"false\">(</mo><mrow><mi>x</mi></mrow><mo fence=\"true\" form=\"postfix\" stretchy=\"false\">)</mo></mrow><mrow><mi mathvariant=\"italic\">dx</mi><mo stretchy=\"false\">+</mo><mrow><munder><mi>lim</mi><mrow><mi>x</mi><mo stretchy=\"false\">→</mo><mn>0</mn></mrow></munder><mi>y</mi></mrow></mrow></mrow>"],
  ["a ~ b ` c",
    "<mrow><mi>a</mi><mspace width=\"2em\"/><mi>b</mi><mspace width=\"0.5em\"/><mi>c</mi></mrow>"],
  ["a newline b",
    "<mtable><mtr><mtd><mi>a</mi></mtd></mtr><mtr><mtd><mi>b</mi></mtd></mtr></mtable>"],
  ["stack{a#b#c} + binom a b",
    "<mrow><mtable><mtr><mtd><mi>a</mi></mtd></mtr><mtr><mtd><mi>b</mi></mtd></mtr><mtr><mtd><mi>c</mi></mtd></mtr></mtable><mo stretchy=\"false\">+</mo><mtable><mtr><mtd><mi>a</mi></mtd></mtr><mtr><mtd><mi>b</mi></mtd></mtr></mtable></mrow>"],
  ["{a} overbrace {b} + a wideslash b + a widebslash b",
    "<mrow><mover><mover><mi>a</mi><mo stretchy=\"true\">⏞</mo></mover><mi>b</mi></mover><mo stretchy=\"false\">+</mo><mfrac bevelled=\"true\"><mi>a</mi><mi>b</mi></mfrac><mo stretchy=\"false\">+</mo><mrow><mi>a</mi><mo>∖</mo><mi>b</mi></mrow></mrow>"],
  ["lsub a lsup b x csub c csup d + %alpha + %pi + infinity + a <= b + neg a + -a",
    "<mrow><mrow/><mmultiscripts><mi>a</mi><mprescripts/><none/><mi>b</mi></mmultiscripts><mrow><mrow><munderover><mi>x</mi><mi>c</mi><mi>d</mi></munderover><mo stretchy=\"false\">+</mo><mi>α</mi><mo stretchy=\"false\">+</mo><mi>π</mi><mo stretchy=\"false\">+</mo><mi mathvariant=\"normal\">∞</mi><mo stretchy=\"false\">+</mo><mi>a</mi></mrow><mo stretchy=\"false\">≤</mo><mrow><mi>b</mi><mo stretchy=\"false\">+</mo><mrow><mo stretchy=\"false\">¬</mo><mi>a</mi></mrow><mo stretchy=\"false\">+</mo><mrow><mo stretchy=\"false\">−</mo><mi>a</mi></mrow></mrow></mrow></mrow>"],
  ["alignl a newline alignr b",
    "<mtable><mtr><mtd columnalign=\"left\"><mi>a</mi></mtd></mtr><mtr><mtd columnalign=\"right\"><mi>b</mi></mtd></mtr></mtable>"],
  ["size *2 a + size -2 b + bold ital sans c + color rgb 255 0 0 d + color hex 00FF00 e",
    "<mrow><mrow><mstyle mathsize=\"200%\"><mi>a</mi></mstyle><mo stretchy=\"false\">+</mo><mstyle mathsize=\"10pt\"><mi>b</mi></mstyle><mo stretchy=\"false\">+</mo><mstyle mathvariant=\"bold-italic\"><mrow/></mstyle></mrow><mrow><mi>c</mi><mo stretchy=\"false\">+</mo><mstyle mathcolor=\"#FF0000\"><mi>d</mi></mstyle><mo stretchy=\"false\">+</mo><mstyle mathcolor=\"#00FF00\"><mi>e</mi></mstyle></mrow></mrow>"],
  ["\"a<b & c\" + abs x + fact n + iint x + a cdot b times c",
    "<mrow><mtext>a&lt;b &amp; c</mtext><mo stretchy=\"false\">+</mo><mrow><mo fence=\"true\" form=\"prefix\" stretchy=\"true\">|</mo><mrow><mi>x</mi></mrow><mo fence=\"true\" form=\"postfix\" stretchy=\"true\">|</mo></mrow><mo stretchy=\"false\">+</mo><mrow><mi>n</mi><mo stretchy=\"false\">!</mo></mrow><mo stretchy=\"false\">+</mo><mrow><mo stretchy=\"false\">∬</mo><mi>x</mi></mrow><mo stretchy=\"false\">+</mo><mrow><mi>a</mi><mo stretchy=\"false\">⋅</mo><mi>b</mi><mo stretchy=\"false\">×</mo><mi>c</mi></mrow></mrow>"],
  ["x^2_3 + {}^2 x + a_{i j} + mline + nospace{a b}",
    "<mrow><mrow><msubsup><mi>x</mi><mn>3</mn><mn>2</mn></msubsup><mo stretchy=\"false\">+</mo><msup><mrow/><mn>2</mn></msup></mrow><mrow><mi>x</mi><mo stretchy=\"false\">+</mo><msub><mi>a</mi><mrow><mi>i</mi><mi>j</mi></mrow></msub><mo stretchy=\"false\">+</mo><mrow/><mo stretchy=\"false\">+</mo><mrow><mi>a</mi><mi>b</mi></mrow></mrow></mrow>"],
  ["size /3 a + size *1.5 b + size 16.5 c + size +2.5 d",
    "<mrow><mstyle mathsize=\"33.3333333333333%\"><mi>a</mi></mstyle><mo stretchy=\"false\">+</mo><mstyle mathsize=\"150%\"><mi>b</mi></mstyle><mo stretchy=\"false\">+</mo><mstyle mathsize=\"16.5pt\"><mi>c</mi></mstyle><mo stretchy=\"false\">+</mo><mstyle mathsize=\"14.5pt\"><mi>d</mi></mstyle></mrow>"],
  ["<?> + 2x + x_i^2 + {} csub a + oper OP from a to b c",
    "<mrow><mrow><mi mathvariant=\"normal\">❑</mi><mo stretchy=\"false\">+</mo><mn>2</mn></mrow><mrow><mi>x</mi><mo stretchy=\"false\">+</mo><msubsup><mi>x</mi><mi>i</mi><mn>2</mn></msubsup><mo stretchy=\"false\">+</mo><munder><mrow/><mi>a</mi></munder><mo stretchy=\"false\">+</mo><mrow><munderover><mo stretchy=\"false\">O</mo><mi>a</mi><mi>b</mi></munderover><mi>c</mi></mrow></mrow></mrow>"],
  ["a over b over c + %DELTA + leslant + dlarrow + emptyset",
    "<mrow><mfrac><mfrac><mi>a</mi><mi>b</mi></mfrac><mi>c</mi></mfrac><mo stretchy=\"false\">+</mo><mi mathvariant=\"normal\">Δ</mi><mo stretchy=\"false\">+</mo><mrow/><mo stretchy=\"false\">+</mo><mo stretchy=\"false\">⇐</mo><mo stretchy=\"false\">+</mo><mi mathvariant=\"normal\">∅</mi></mrow>"],
  ["2×3",
    "<mrow><mn>2</mn><mi>×</mi><mn>3</mn></mrow>"],
  ["1 \"/\" 2\" \"",
    "<mrow><mn>1</mn><mtext>/</mtext><mn>2</mn><mtext> </mtext></mrow>"],
  ["{1} over {a} \"+\"b",
    "<mrow><mfrac><mn>1</mn><mi>a</mi></mfrac><mtext>+</mtext><mi>b</mi></mrow>"],
  ["{sin } ^ {\"-\"1 } {x}",
    "<mrow><msup><mi>sin</mi><mrow><mtext>-</mtext><mn>1</mn></mrow></msup><mi>x</mi></mrow>"],
  ["{∂} over {∂x} left (f left (x,y right ) right )",
    "<mrow><mfrac><mi>∂</mi><mrow><mi>∂</mi><mi>x</mi></mrow></mfrac><mrow><mo fence=\"true\" form=\"prefix\" stretchy=\"true\">(</mo><mrow><mrow><mi>f</mi><mrow><mo fence=\"true\" form=\"prefix\" stretchy=\"true\">(</mo><mrow><mrow><mi>x</mi><mi>,</mi><mi>y</mi></mrow></mrow><mo fence=\"true\" form=\"postfix\" stretchy=\"true\">)</mo></mrow></mrow></mrow><mo fence=\"true\" form=\"postfix\" stretchy=\"true\">)</mo></mrow></mrow>"],
  ["left (matrix {1 # 0 # 0 ## 0 # 1 # 0 ## 0 # 0 # 1}  right )",
    "<mrow><mo fence=\"true\" form=\"prefix\" stretchy=\"true\">(</mo><mrow><mtable><mtr><mtd><mn>1</mn></mtd><mtd><mn>0</mn></mtd><mtd><mn>0</mn></mtd></mtr><mtr><mtd><mn>0</mn></mtd><mtd><mn>1</mn></mtd><mtd><mn>0</mn></mtd></mtr><mtr><mtd><mn>0</mn></mtd><mtd><mn>0</mn></mtd><mtd><mn>1</mn></mtd></mtr></mtable></mrow><mo fence=\"true\" form=\"postfix\" stretchy=\"true\">)</mo></mrow>"],
  ["{x\"+\"y} underbrace {z}",
    "<munder><munder><mrow><mi>x</mi><mtext>+</mtext><mi>y</mi></mrow><mo stretchy=\"true\">⏟</mo></munder><mi>z</mi></munder>"],
  ["{x} csub {→}",
    "<munder><mi>x</mi><mi>→</mi></munder>"],
  ["acute {x}",
    "<mover accent=\"true\"><mi>x</mi><mo stretchy=\"false\">´</mo></mover>"],
  ["{x \"+\" y} overbrace {z}",
    "<mover><mover><mrow><mi>x</mi><mtext>+</mtext><mi>y</mi></mrow><mo stretchy=\"true\">⏞</mo></mover><mi>z</mi></mover>"],
  ["coprod <?>",
    "<mrow><mo stretchy=\"false\">∐</mo><mi mathvariant=\"normal\">❑</mi></mrow>"],
  ["left langle {1} over {2} right rangle",
    "<mrow><mo fence=\"true\" form=\"prefix\" stretchy=\"true\">⟨</mo><mrow><mfrac><mn>1</mn><mn>2</mn></mfrac></mrow><mo fence=\"true\" form=\"postfix\" stretchy=\"true\">⟩</mo></mrow>"],
  ["left ldline {1} over {2} right rdline",
    "<mrow><mo fence=\"true\" form=\"prefix\" stretchy=\"true\">‖</mo><mrow><mfrac><mn>1</mn><mn>2</mn></mfrac></mrow><mo fence=\"true\" form=\"postfix\" stretchy=\"true\">‖</mo></mrow>"],
  ["{a+b} over {c-d} = sqrt{x^2 + y_i} + nroot{3}{z}",
    "<mrow><mfrac><mrow><mi>a</mi><mo stretchy=\"false\">+</mo><mi>b</mi></mrow><mrow><mi>c</mi><mo stretchy=\"false\">−</mo><mi>d</mi></mrow></mfrac><mo stretchy=\"false\">=</mo><mrow><msqrt><mrow><msup><mi>x</mi><mn>2</mn></msup><mo stretchy=\"false\">+</mo><msub><mi>y</mi><mi>i</mi></msub></mrow></msqrt><mo stretchy=\"false\">+</mo><mroot><mi>z</mi><mn>3</mn></mroot></mrow></mrow>"],
];

describe('MathML export', () => {
  it('writes the document as LibreOffice does', () => {
    expect(ExportMathML('{a} rsub {2}')).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><semantics>' +
      '<msub><mi>a</mi><mn>2</mn></msub><annotation encoding="StarMath 5.0">{a} rsub {2}</annotation>' +
      '</semantics></math>',
    );
    // characters and the annotation are escaped as the SAX writer does
    expect(ExportMathML('"it\'s" <= "a<b & c"')).toContain(
      '<mtext>it&apos;s</mtext><mo stretchy="false">≤</mo><mtext>a&lt;b &amp; c</mtext></mrow>' +
      '<annotation encoding="StarMath 5.0">&quot;it&apos;s&quot; &lt;= &quot;a&lt;b &amp; c&quot;</annotation>',
    );
  });

  it('text mode and right to left on the math element', () => {
    const aFormat = new SmFormat();
    aFormat.bIsTextmode = true;
    aFormat.bIsRightToLeft = true;
    expect(ExportMathML('a', aFormat)).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML" dir="rtl"><semantics><mi>a</mi>');
  });

  it('an empty formula', () => {
    expect(ExportMathML('')).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"/>');
  });

  for (const [text, mml] of CASES) {
    it(text, () => expect(body(ExportMathML(text))).toBe(mml));
  }

  it('imports back to the same text', () => {
    for (const [text] of CASES) expect(ImportMathMLString(ExportMathML(text))).toBe(text);
    expect(ImportMathMLString(ExportMathML('a newline b'))).toBe('a newline b');
  });
});
