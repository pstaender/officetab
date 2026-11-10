import { describe, expect, it } from 'vitest';
import { SwDoc, SwPosition } from '../../src/lo/sw/inc/doc.ts';
import { SwPaM } from '../../src/lo/sw/inc/pam.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';

function setup(text = '') {
  const doc = new SwDoc();
  const pam = new SwPaM(new SwPosition(doc.GetNodes().FirstTextNode(), 0));
  if (text) doc.InsertString(pam, text);
  return { doc, pam };
}
const paras = (doc: SwDoc) => {
  const out: string[] = [];
  for (let n: SwTextNode | null = doc.GetNodes().FirstTextNode(); n; n = doc.GetNodes().GoNext(n.GetIndex())) out.push(n.GetText());
  return out;
};
const select = (pam: SwPaM, a: [SwTextNode, number], b: [SwTextNode, number]) => { pam.GetMark().Assign(...a); pam.GetPoint().Assign(...b); };

describe('SwTextNode hints follow SwTextNode::Update', () => {
  it('expands a hint ending at the insert position and shifts one starting there', () => {
    const { doc, pam } = setup('abcdef');
    const n = pam.GetPoint().GetNode();
    n.SetAttr(0, 3, { RES_CHRATR_WEIGHT: true });
    n.SetAttr(3, 6, { RES_CHRATR_POSTURE: true });
    n.InsertText('XX', 3);
    expect(n.m_aHints.map((h) => [h.nStart, h.nEnd])).toEqual([[0, 5], [5, 8]]);
    expect(doc).toBeTruthy();
  });

  it('pulls the first hint over text inserted at paragraph start', () => {
    const { pam } = setup('abc');
    const n = pam.GetPoint().GetNode();
    n.SetAttr(0, 3, { RES_CHRATR_WEIGHT: true });
    n.InsertText('Z', 0);
    expect(n.m_aHints.map((h) => [h.nStart, h.nEnd])).toEqual([[0, 4]]);
  });

  it('shrinks and drops hints on erase', () => {
    const { pam } = setup('abcdefgh');
    const n = pam.GetPoint().GetNode();
    n.SetAttr(1, 3, { RES_CHRATR_WEIGHT: true });
    n.SetAttr(5, 7, { RES_CHRATR_POSTURE: true });
    n.EraseText(0, 4);
    expect(n.m_aHints.map((h) => [h.nStart, h.nEnd])).toEqual([[1, 3]]);
  });

  it('splits runs when overlapping attributes are applied and merges equal neighbours', () => {
    const { pam } = setup('abcdef');
    const n = pam.GetPoint().GetNode();
    n.SetAttr(0, 4, { RES_CHRATR_WEIGHT: true });
    n.SetAttr(2, 6, { RES_CHRATR_POSTURE: true });
    expect(n.m_aHints.map((h) => [h.nStart, h.nEnd, Object.keys(h.aAttrs).length])).toEqual([[0, 2, 1], [2, 4, 2], [4, 6, 1]]);
    n.ResetAttr(2, 4, ['RES_CHRATR_POSTURE']);
    expect(n.m_aHints.map((h) => [h.nStart, h.nEnd])).toEqual([[0, 4], [4, 6]]);
  });
});

describe('SwDoc editing', () => {
  it('splits, joins across paragraphs and keeps the cursor valid', () => {
    const { doc, pam } = setup('hello world');
    pam.GetPoint().Assign(pam.GetPoint().GetNode(), 5);
    pam.DeleteMark();
    doc.SplitNode(pam);
    doc.InsertString(pam, 'middle');
    doc.SplitNode(pam);
    expect(paras(doc)).toEqual(['hello', 'middle', ' world']);
    const first = doc.GetNodes().FirstTextNode();
    const last = doc.GetNodes().LastTextNode();
    select(pam, [first, 2], [last, 3]);
    doc.DeleteAndJoin(pam);
    expect(paras(doc)).toEqual(['herld']);
    expect(pam.GetPoint().GetContentIndex()).toBe(2);
    expect(pam.HasMark()).toBe(false);
  });

  it('undoes and redoes a multi-paragraph delete exactly', () => {
    const { doc, pam } = setup('one');
    doc.SplitNode(pam); doc.InsertString(pam, 'two');
    doc.SplitNode(pam); doc.InsertString(pam, 'three');
    const first = doc.GetNodes().FirstTextNode();
    first.SetAttr(0, 3, { RES_CHRATR_WEIGHT: true });
    select(pam, [first, 1], [doc.GetNodes().LastTextNode(), 2]);
    doc.DeleteAndJoin(pam);
    expect(paras(doc)).toEqual(['oree']);
    doc.Undo(pam);
    expect(paras(doc)).toEqual(['one', 'two', 'three']);
    expect(doc.GetNodes().FirstTextNode().m_aHints).toEqual([{ nStart: 0, nEnd: 3, aAttrs: { RES_CHRATR_WEIGHT: true } }]);
    doc.Redo(pam);
    expect(paras(doc)).toEqual(['oree']);
  });

  it('undoes a paragraph split back to one node', () => {
    const { doc, pam } = setup('ab');
    pam.GetPoint().Assign(pam.GetPoint().GetNode(), 1); pam.DeleteMark();
    doc.SplitNode(pam);
    expect(paras(doc)).toEqual(['a', 'b']);
    doc.Undo(pam);
    expect(paras(doc)).toEqual(['ab']);
    expect(pam.GetPoint().GetContentIndex()).toBe(1);
    doc.Redo(pam);
    expect(paras(doc)).toEqual(['a', 'b']);
  });

  it('groups consecutive typing into one undo step, broken at word boundaries', () => {
    const { doc, pam } = setup();
    for (const c of 'abc') doc.InsertString(pam, c);
    doc.InsertString(pam, ' ');
    for (const c of 'de') doc.InsertString(pam, c);
    expect(paras(doc)).toEqual(['abc de']);
    doc.Undo(pam);
    expect(paras(doc)).toEqual(['abc ']);
    doc.Undo(pam);
    expect(paras(doc)).toEqual(['abc']);
    doc.Undo(pam);
    expect(paras(doc)).toEqual(['']);
  });

  it('keeps attributes of typed text across undo and redo', () => {
    const { doc, pam } = setup();
    doc.InsertString(pam, 'b', { RES_CHRATR_WEIGHT: true });
    doc.Undo(pam);
    expect(paras(doc)).toEqual(['']);
    doc.Redo(pam);
    expect(doc.GetNodes().FirstTextNode().GetCharAttrAt('RES_CHRATR_WEIGHT', 0)).toBe(true);
  });

  it('tracks the modified state across undo and save', () => {
    const { doc, pam } = setup();
    expect(doc.IsModified()).toBe(false);
    doc.InsertString(pam, 'a');
    expect(doc.IsModified()).toBe(true);
    doc.SetUnmodified();
    expect(doc.IsModified()).toBe(false);
    doc.InsertString(pam, ' ');
    expect(doc.IsModified()).toBe(true);
    doc.Undo(pam);
    expect(doc.IsModified()).toBe(false);
  });

  it('gives the follow style only when splitting at paragraph end', () => {
    const { doc, pam } = setup('Title');
    doc.SetTextFormatColl(pam, doc.FindTextFormatCollByName('Heading 1')!);
    doc.SplitNode(pam);
    expect(pam.GetPoint().GetNode().GetTextColl().GetName()).toBe('Text Body');
    expect(doc.GetNodes().FirstTextNode().GetTextColl().GetName()).toBe('Heading 1');
  });
});

describe('clone formatting', () => {
  it('copies character and paragraph formatting to the word clicked or the selection', async () => {
    const { SwWrtShell } = await import('../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts');
    const mono = { GetTextWidth: (_f: unknown, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('bold');
    sh.SplitNode();
    sh.Insert('plain word');
    const [a, b] = [sh.m_pDoc.GetNodes().FirstTextNode(), sh.m_pDoc.GetNodes().LastTextNode()];
    sh.SelectRange(a, 0, 4);
    sh.SetCharAttr({ RES_CHRATR_WEIGHT: true, RES_CHRATR_COLOR: '#ff0000' });
    sh.SetParaAttr({ RES_PARATR_ADJUST: 'center' });
    sh.SelectRange(a, 2, 2);
    const f = sh.CopyFormat();
    expect(f.chars).toEqual({ RES_CHRATR_WEIGHT: true, RES_CHRATR_COLOR: '#ff0000' });
    sh.SelectRange(b, 7, 7);
    sh.PasteFormat(f);
    expect(b.GetCharAttrAt('RES_CHRATR_WEIGHT', 7)).toBe(true);
    expect(b.GetCharAttrAt('RES_CHRATR_WEIGHT', 2)).toBe(false);
    expect(b.GetAttr('RES_PARATR_ADJUST')).toBe('center');
  });
});
