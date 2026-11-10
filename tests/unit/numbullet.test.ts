// Format > Bullets and Numbering: the tab pages (cui numpages) and applying their rule.
import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwNumRule } from '../../src/lo/sw/inc/numrule.ts';
import { NumberingType } from '../../src/lo/i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import {
  ALL_LEVELS, BulletPick, OutlinePick, SameForLevels, SetAlignAt, SetIncludeUpperLevels, SetIndentAt, SetNumberType,
  SetPrefixSuffix, SingleNumPick, StandardPositions,
} from '../../src/lo/cui/source/tabpages/numpages.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };

function shell(...paras: string[]) {
  const sh = new SwWrtShell(new SwDoc(), mono);
  paras.forEach((p, i) => { if (i) sh.SplitNode(); sh.Insert(p); });
  return sh;
}
const nodes = (sh: SwWrtShell): SwTextNode[] => {
  const out: SwTextNode[] = [];
  const ns = sh.m_pDoc.GetNodes();
  for (let n: SwTextNode | null = ns.FirstTextNode(); n; n = ns.GoNext(n.GetIndex())) out.push(n);
  return out;
};
const labels = (sh: SwWrtShell) => nodes(sh).map((n) => sh.m_pRoot.m_aNums.get(n)?.label ?? null);

describe('Bullets and Numbering tab pages', () => {
  it('picks a bullet for the levels in the mask (SvxBulletPickTabPage)', () => {
    const r = BulletPick(new SwNumRule('x'), 1 << 1, 3);
    expect(r.Get(1).GetBulletChar()).toBe('►');
    expect(r.Get(1).GetBulletFont()).toBe('OpenSymbol');
    expect(r.Get(1).GetNumberingType()).toBe(NumberingType.CHAR_SPECIAL);
    expect(r.Get(0).GetNumberingType()).toBe(NumberingType.ARABIC);
  });

  it('picks a numbering, dropping the blank prefixes of the locale data (SvxSingleNumPickTabPage)', () => {
    const r = SingleNumPick(new SwNumRule('x'), ALL_LEVELS, 2);
    expect(r.Get(0).GetListFormat()).toBe('(%1%)');
    expect(r.Get(4).GetListFormat()).toBe('(%5%)');
    expect(SingleNumPick(r, 1, 3).Get(0).GetNumberingType()).toBe(NumberingType.ROMAN_UPPER);
    expect(SingleNumPick(r, 1, 3).Get(0).GetListFormat()).toBe('%1%.');
  });

  it('sets every level from an outline, the last one repeated (SvxNumPickTabPage)', () => {
    // ISO 2145: all upper levels shown, separated by full stops.
    const r = OutlinePick(new SwNumRule('x'), 6);
    expect(r.Get(0).GetListFormat()).toBe(' %1% ');
    expect(r.Get(2).GetListFormat()).toBe(' %1%.%2%.%3% ');
    expect(r.MakeNumString([2, 1, 3])).toBe(' 2.1.3 ');
    // I.A.1.a.i.: the sixth level is a bullet, and the levels after it are too.
    const m = OutlinePick(new SwNumRule('x'), 0);
    expect([0, 1, 2].map((l) => m.Get(l).GetNumberingType())).toEqual([NumberingType.ROMAN_UPPER, NumberingType.CHARS_UPPER_LETTER, NumberingType.ARABIC]);
    expect(m.Get(9).GetBulletChar()).toBe('•');
    expect(m.Get(9).GetBulletFont()).toBe('StarSymbol');
  });

  it('customizes type, prefix, suffix and sublevels (SvxNumOptionsTabPage)', () => {
    let r = SetNumberType(new SwNumRule('x'), 1 << 1, NumberingType.CHARS_LOWER_LETTER, '', ')');
    expect(r.Get(1).GetListFormat()).toBe('%2%)');
    r = SetIncludeUpperLevels(r, 1 << 1, 5);
    expect(r.Get(1).GetIncludeUpperLevels()).toBe(2);
    expect(r.Get(1).GetListFormat()).toBe('%1%.%2%)');
    r = SetPrefixSuffix(r, 1 << 1, '[', ']');
    expect(r.MakeNumString([3, 2])).toBe('[3.b]');
    r = SetNumberType(r, 1 << 1, NumberingType.CHAR_SPECIAL, '', '');
    expect(r.Get(1).GetIncludeUpperLevels()).toBe(1);
    expect(r.Get(1).GetBulletFont()).toBe('OpenSymbol');
  });

  it('positions labels: aligned at keeps the indent, indent at keeps the alignment (SvxNumPositionTabPage)', () => {
    let r = SetAlignAt(new SwNumRule('x'), 1, 567);
    expect([r.Get(0).GetIndentAt(), r.Get(0).GetFirstLineIndent()]).toEqual([720, 567 - 720]);
    r = SetIndentAt(r, 1, 1134);
    expect([r.Get(0).GetIndentAt(), r.Get(0).GetIndentAt() + r.Get(0).GetFirstLineIndent()]).toEqual([1134, 567]);
    expect(SameForLevels(r, 0b11, (f) => f.GetIndentAt())).toBe(false);
    r = StandardPositions(r, ALL_LEVELS);
    expect([r.Get(0).GetIndentAt(), r.Get(0).GetFirstLineIndent()]).toEqual([720, -360]);
  });
});

describe('SwEditShell::SetCurNumRule', () => {
  it('starts a new list with the rule, counted', () => {
    const sh = shell('a', 'b');
    sh.SelAll();
    expect(sh.GetNumRuleAtCurrentSelection()).toBeUndefined();
    sh.SetCurNumRule(SingleNumPick(new SwNumRule(sh.m_pDoc.GetUniqueNumRuleName()), ALL_LEVELS, 0), true);
    expect(labels(sh)).toEqual(['1)', '2)']);
    sh.Undo();
    expect(labels(sh)).toEqual([null, null]);
  });

  it('changes the rule of the selection for every paragraph in it, and keeps a list style a list style', () => {
    const sh = shell('a', 'b', 'c');
    sh.SelAll(); sh.ToggleNum(true);
    const n = nodes(sh);
    sh.SelectRange(n[1]!, 0, 0);
    const rule = sh.GetNumRuleAtCurrentSelection()!;
    sh.SetCurNumRule(SingleNumPick(rule, ALL_LEVELS, 3), false);
    expect(labels(sh)).toEqual(['I.', 'II.', 'III.']);
    sh.Undo();
    expect(labels(sh)).toEqual(['1.', '2.', '3.']);

    sh.SelAll();
    sh.SetCurNumRuleByName('Numbering 123');
    const style = sh.GetNumRuleAtCurrentSelection()!;
    expect(style.IsAutoRule()).toBe(false);
    const changed = BulletPick(style, ALL_LEVELS, 0);
    changed.SetAutoRule(true);
    sh.SetCurNumRule(changed, false);
    expect(sh.m_pDoc.FindNumRulePtr('Numbering 123')!.IsAutoRule()).toBe(false);
    expect(labels(sh)).toEqual(['●', '●', '●']);
  });
});
