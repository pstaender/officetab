import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { GetNumRuleFromPool, SwNumRule } from '../../src/lo/sw/inc/numrule.ts';
import { NumberingType, toRoman, makeNumberingString } from '../../src/lo/i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';

const mono: TextMeasurer = {
  GetTextWidth: (_f: FontDesc, t: string) => t.length * 100,
  GetFontMetric: () => ({ ascent: 200, descent: 40 }),
};

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
const goTo = (sh: SwWrtShell, i: number) => { const n = nodes(sh)[i]!; sh.SelectRange(n, 0, 0); };

describe('number strings', () => {
  it('formats roman numerals and letters like i18npool', () => {
    expect([1, 4, 9, 14, 40, 90, 400, 1994, 2026].map(toRoman)).toEqual(['I', 'IV', 'IX', 'XIV', 'XL', 'XC', 'CD', 'MCMXCIV', 'MMXXVI']);
    expect([1, 26, 27, 28, 52, 53].map((n) => makeNumberingString(NumberingType.CHARS_UPPER_LETTER, n))).toEqual(['A', 'Z', 'AA', 'AB', 'AZ', 'BA']);
    expect([1, 27, 28].map((n) => makeNumberingString(NumberingType.CHARS_LOWER_LETTER_N, n))).toEqual(['a', 'aa', 'bb']);
  });

  it('expands list formats with upper levels', () => {
    const r = new SwNumRule('x');
    const f = r.Get(2).Clone();
    f.SetIncludeUpperLevels(3);
    f.SetListFormat('(', ')', 2);
    r.Set(2, f);
    expect(r.Get(2).GetListFormat()).toBe('(%1%.%2%.%3%)');
    expect(r.MakeNumString([2, 1, 3])).toBe('(2.1.3)');
    expect(r.MakeNumString([4])).toBe('4.');
  });

  it('builds the pool list styles', () => {
    const ivx = GetNumRuleFromPool('Numbering ivx');
    expect(ivx.MakeNumString([3])).toBe('iii.');
    expect(ivx.Get(0).GetNumAdjust()).toBe('right');
    expect(GetNumRuleFromPool('Numbering ABC').MakeNumString([28])).toBe('AB.');
  });
});

describe('lists', () => {
  it('numbers, toggles off and undoes', () => {
    const sh = shell('one', 'two', 'three');
    sh.SelAll();
    sh.ToggleNum(true);
    expect(labels(sh)).toEqual(['1.', '2.', '3.']);
    expect(sh.SelectionHasNumber()).toBe(true);
    sh.ToggleNum(false); // switching kind changes the list's level format
    expect(labels(sh)).toEqual(['•', '•', '•']);
    sh.ToggleNum(false);
    expect(labels(sh)).toEqual([null, null, null]);
    sh.Undo();
    expect(labels(sh)).toEqual(['•', '•', '•']);
    sh.Undo();
    expect(labels(sh)).toEqual(['1.', '2.', '3.']);
    sh.Undo();
    expect(labels(sh)).toEqual([null, null, null]);
  });

  it('continues the previous list across empty paragraphs only', () => {
    const sh = shell('a', 'b', '', 'c', 'text', 'd');
    goTo(sh, 0); sh.ToggleNum(true);
    goTo(sh, 1); sh.ToggleNum(true);
    goTo(sh, 3); sh.ToggleNum(true);
    goTo(sh, 5); sh.ToggleNum(true);
    expect(labels(sh)).toEqual(['1.', '2.', null, '3.', null, '1.']);
  });

  it('demotes, promotes and restarts sub-levels', () => {
    const sh = shell('a', 'b', 'c', 'd');
    sh.SelAll();
    sh.ToggleNum(true);
    goTo(sh, 1); expect(sh.NumUpDown(true)).toBe(true);
    goTo(sh, 2); sh.NumUpDown(true);
    expect(labels(sh)).toEqual(['1.', '1.', '2.', '2.']);
    goTo(sh, 0); expect(sh.NumUpDown(false)).toBe(false);
  });

  it('counts phantoms for skipped levels and supports restart and uncounted entries', () => {
    const sh = shell('a', 'b', 'c', 'd');
    sh.SelAll();
    sh.ToggleNum(true);
    goTo(sh, 1); sh.NumOrNoNum(false);
    expect(labels(sh)).toEqual(['1.', '', '2.', '3.']);
    goTo(sh, 3); sh.SetNumRuleStart(true);
    expect(labels(sh)).toEqual(['1.', '', '2.', '1.']);
  });

  it('places the label at the first line indent and text at the list tab', () => {
    const sh = shell('item');
    sh.ToggleNum(true);
    const frame = sh.m_pRoot.pages[0]!.frames[0]!;
    const line = frame.lines[0]!;
    // Default rule level 0: indent at 720, first line -360, tab at 720. Label "1." is 200 wide.
    expect(line.nX).toBe(360);
    expect(line.portions[0]).toMatchObject({ kind: 'number', aExpand: '1.', nWidth: 360 });
    sh.SttDoc();
    expect(sh.GetCharRect()!.Left()).toBe(frame.nLeft + 720);
  });

  it('survives an ODT round trip', async () => {
    const sh = shell('a', 'b', 'c', 'd');
    sh.SelAll();
    sh.ToggleNum(true);
    goTo(sh, 1); sh.NumUpDown(true);
    goTo(sh, 3); sh.SetCurNumRuleByName('Numbering IVX');
    const { doc, lost } = await ImportODT(await ExportODT(sh.m_pDoc));
    expect(lost).toEqual([]);
    const sh2 = new SwWrtShell(doc, mono);
    expect(labels(sh2)).toEqual(['1.', '1.', '2.', 'I.']);
    expect(nodes(sh2).map((n) => n.GetAttr('RES_PARATR_LIST_LEVEL'))).toEqual([0, 1, 0, 0]);
  });
});

describe('list export nesting', () => {
  it('round-trips siblings at nested levels without spurious lists', async () => {
    const sh = shell('a', 'b', 'c', 'd', 'e', 'f');
    sh.SelAll();
    sh.ToggleNum(true);
    const levels = [0, 1, 1, 2, 1, 0];
    nodes(sh).forEach((n, i) => { n.m_aSet.RES_PARATR_LIST_LEVEL = levels[i]!; n.m_nVersion++; });
    sh.m_pDoc.Changed();
    const { doc } = await ImportODT(await ExportODT(sh.m_pDoc));
    const sh2 = new SwWrtShell(doc, mono);
    expect(nodes(sh2).map((n) => n.GetAttr('RES_PARATR_LIST_LEVEL'))).toEqual(levels);
    expect(labels(sh2)).toEqual(['1.', '1.', '2.', '1.', '3.', '2.']);
  });
});

describe('Format > Lists (SwListShell)', () => {
  /** A numbered list "A", "A1" (level 2), "A2" (level 2), "B", "C". */
  const outline = () => {
    const sh = shell('A', 'A1', 'A2', 'B', 'C');
    sh.SelAll(); sh.ToggleNum(true);
    for (const i of [1, 2]) { goTo(sh, i); sh.NumUpDown(true); }
    return sh;
  };
  const texts = (sh: SwWrtShell) => nodes(sh).map((n) => n.GetText());
  const levels = (sh: SwWrtShell) => nodes(sh).map((n) => n.GetAttr('RES_PARATR_LIST_LEVEL'));

  it('moves an item down and up with its sub-items (MoveNumParas)', () => {
    const sh = outline();
    goTo(sh, 0);
    expect(sh.MoveNumParas(true, false)).toBe(true);
    expect(texts(sh)).toEqual(['B', 'A', 'A1', 'A2', 'C']);
    expect(labels(sh)).toEqual(['1.', '2.', '1.', '2.', '3.']);
    goTo(sh, 1);
    sh.MoveNumParas(true, true);
    expect(texts(sh)).toEqual(['A', 'A1', 'A2', 'B', 'C']);
    sh.Undo();
    expect(texts(sh)).toEqual(['B', 'A', 'A1', 'A2', 'C']);
  });

  it('demotes and promotes an item with its sub-items', () => {
    const sh = outline();
    goTo(sh, 0);
    sh.MoveNumParas(false, false);
    expect(levels(sh)).toEqual([1, 2, 2, 0, 0]);
    sh.MoveNumParas(false, true);
    expect(levels(sh)).toEqual([0, 1, 1, 0, 0]);
  });

  it('moves a single paragraph without its sub-items (MoveParagraph)', () => {
    const sh = outline();
    goTo(sh, 3);
    sh.MoveParagraph(-1);
    expect(texts(sh)).toEqual(['A', 'A1', 'B', 'A2', 'C']);
    // The cursor stays in the moved paragraph.
    expect(sh.m_pCursor.GetPoint().GetNode().GetText()).toBe('B');
    goTo(sh, 0);
    expect(sh.MoveParagraph(-1)).toBe(false);
  });

  it('jumps to the next and previous item on the same level, over sub-items', () => {
    const sh = outline();
    goTo(sh, 0);
    sh.GotoNextNum();
    expect(sh.m_pCursor.GetPoint().GetNode().GetText()).toBe('B');
    sh.GotoPrevNum();
    expect(sh.m_pCursor.GetPoint().GetNode().GetText()).toBe('A');
  });

  it('inserts an unnumbered entry and adds a paragraph to the list before it', () => {
    const sh = outline();
    goTo(sh, 3);
    sh.SelectRange(nodes(sh)[3]!, 1, 1);
    sh.NoNum();
    expect(texts(sh)).toEqual(['A', 'A1', 'A2', 'B', '', 'C']);
    expect(labels(sh)).toEqual(['1.', '1.', '2.', '2.', '', '3.']);
    // A paragraph after other text joins the earlier list (Add to List).
    sh.SelectRange(nodes(sh)[5]!, 1, 1);
    sh.SplitNode(); sh.Insert('plain'); sh.DelNumRules(); sh.SplitNode(); sh.Insert('D'); sh.DelNumRules();
    expect(sh.CanContinueNumbering()).toBe(true);
    sh.ContinueNumbering();
    expect(labels(sh).slice(-3)).toEqual(['3.', null, '4.']);
  });
});
