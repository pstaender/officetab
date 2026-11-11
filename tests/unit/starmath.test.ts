// LibreOffice Math: the formula parser (SmParser5), arranging the node tree, and drawing it.
import { describe, expect, it } from 'vitest';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';
import { SmParser5 } from '../../src/lo/starmath/source/parse5.ts';
import { SmDocShell } from '../../src/lo/starmath/source/document.ts';
import { SmNodeType, type SmNode } from '../../src/lo/starmath/source/node.ts';

// Glyphs half as wide as high; ink from the cap height to the baseline.
export const measurer: TextMeasurer = {
  GetTextWidth: (f: FontDesc, t: string) => [...t].length * f.size * 0.5,
  GetFontMetric: (f: FontDesc) => ({ ascent: Math.round(f.size * 0.9), descent: Math.round(f.size * 0.25) }),
  GetTextBoundRect: (f: FontDesc, t: string) => (t.trim() ? { left: 0, top: -f.size * 0.7, right: [...t].length * f.size * 0.5, bottom: 0 } : null),
};

const tree = (n: SmNode | null, d = 0): string => {
  if (!n) return 'null';
  const name = Object.keys(SmNodeType).find((k) => SmNodeType[k as keyof typeof SmNodeType] === n.GetType());
  const kids = Array.from({ length: n.GetNumSubNodes() }, (_, i) => tree(n.GetSubNode(i), d + 1));
  const text = (n as unknown as { GetText?: () => string }).GetText?.() || (n.GetType() === SmNodeType.Text ? n.GetToken().aText : '');
  return kids.length ? `${name}(${kids.join(', ')})` : `${name}${text ? `"${text}"` : ''}`;
};

describe('SmParser5', () => {
  const parse = (s: string) => tree(new SmParser5().Parse(s).GetSubNode(0)!.GetSubNode(0));
  it('parses fractions, sums, roots and brackets', () => {
    expect(parse('{1} over {4}')).toBe('BinVer(Text"1", Rectangle, Text"4")');
    expect(parse('a + b')).toBe('BinHor(Text"a", Math"+", Text"b")');
    expect(parse('sqrt{x}')).toBe('Root(null, RootSymbol"√", Text"x")');
    expect(parse('left( a right)')).toBe('Brace(Math"(", Bracebody(Text"a"), Math")")');
    expect(parse('sum from {i=1} to n i')).toMatch(/^Oper\(SubSup\(Math"∑"/);
    expect(parse('x^2')).toBe('SubSup(Text"x", null, null, null, Text"2", null, null)');
    expect(parse('%alpha')).toBe('Special');
    expect(parse('matrix{1 # 2 ## 3 # 4}')).toMatch(/^Matrix\(/);
    expect(parse('x_2n')).toBe('SubSup(Text"x", null, null, Expression(Text"2", Text"n"), null, null, null)');
  });

  it('turns unexpected input into error nodes', () => {
    const p = new SmParser5();
    p.Parse('a over');
    expect(p.GetError()).not.toBeNull();
    expect(new SmParser5().Parse('{a').GetSubNode(0)).toBeTruthy();
  });
});

describe('SmDocShell', () => {
  it('arranges a fraction with the numerator above the line above the denominator', () => {
    const doc = new SmDocShell('{1} over {4}');
    const size = doc.GetSize(measurer);
    const f = doc.GetFormulaTree()!.GetSubNode(0)!.GetSubNode(0)!;
    const [num, line, den] = [0, 1, 2].map((i) => f.GetSubNode(i)!);
    expect(num.GetBottom()).toBeLessThan(line.GetTop());
    expect(line.GetBottom()).toBeLessThan(den.GetTop());
    expect(size.height).toBeGreaterThan(2 * 240);
    expect(size.width).toBeGreaterThan(0);
    // the baseline is at the fraction line's middle
    expect(doc.GetBaseline(measurer)).toBeGreaterThan(num.GetBottom() - f.GetTop());
  });

  it('arranges every construct without failing', () => {
    for (const s of ['a^2 + b^2 = c^2', 'int from a to b f(x) dx', 'nroot{3}{x}', 'lim from {n -> infinity} a_n', 'abs{-x}', 'binom a b', 'stack{a # b}',
      'left lbrace stack{a # b} right none', 'overline{abc}', 'vec a', 'widevec{abc}', 'a wideslash b', 'color red x', 'size 20 x', 'bold x', 'func f(x)',
      '"text" ~ x', 'underbrace{a+b} csub n', 'a newline b', '{}', '', '<?> over <?>', 'x lsup 2 lsub 3', 'evaluate{x} from 0 to 1', 'a over', '((']) {
      const doc = new SmDocShell(s);
      const sz = doc.GetSize(measurer);
      expect(sz.width, s).toBeGreaterThan(0);
      expect(sz.height, s).toBeGreaterThan(0);
    }
  });

  it('draws text, the fraction line and the root bar', () => {
    const calls: string[] = [];
    const ctx = {
      font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt', textBaseline: 'alphabetic', textAlign: 'left',
      save() {}, restore() {}, translate() {}, scale() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() { calls.push('stroke'); },
      measureText: (t: string) => ({ width: [...t].length * 120 }),
      fillText: (t: string) => calls.push(`text ${t}`),
      fillRect: () => calls.push('rect'),
    };
    new SmDocShell('sqrt{{1} over {4}}').DrawFormula(ctx as never, measurer, 0, 0);
    expect(calls).toEqual(['text √', 'rect', 'text 1', 'rect', 'text 4']);
  });
});
