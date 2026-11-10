import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };

function shell(text = 'Hello world') {
  const sh = new SwWrtShell(new SwDoc(), mono);
  sh.Insert(text);
  sh.m_pDoc.m_pDocumentRedlineManager.m_sAuthor = 'Ada';
  sh.SetRedlineOn(true);
  return sh;
}
const para = (sh: SwWrtShell) => sh.m_pCursor.GetPoint().GetNode();

describe('track changes', () => {
  it('records insertions and deletions, keeping deleted text until accepted', () => {
    const sh = shell();
    sh.SttDoc();
    sh.Insert('Oh, ');
    sh.EndDoc();
    sh.DelLeft(); sh.DelLeft(); // "ld" deleted, cursor steps over it
    sh.DelLeft();
    expect(para(sh).GetText()).toBe('Oh, Hello world');
    const table = sh.GetRedlineTable();
    expect(table.map((r) => [r.data.type, r.data.author, r.pieces.map((p) => [p.start, p.end])])).toEqual([
      ['Insert', 'Ada', [[0, 4]]], ['Delete', 'Ada', [[12, 15]]],
    ]);
    // Deleting your own insertion removes it for good.
    sh.SttDoc(); sh.DelRight();
    expect(para(sh).GetText()).toBe('h, Hello world');
    // The deleted text is struck through in the author's colour and keeps its width.
    const line = sh.m_pRoot.pages[0]!.frames[0]!.lines[0]!;
    const del = line.portions.find((p) => p.font.redline === 'Delete')!;
    expect(del.font.strike).toBe(true);
    expect(del.nWidth).toBe(300);
    sh.SetShowChanges(false);
    expect(sh.m_pRoot.pages[0]!.frames[0]!.lines[0]!.portions.find((p) => p.font.redline === 'Delete')!.nWidth).toBe(0);
    sh.AcceptRejectAll(true);
    expect(para(sh).GetText()).toBe('h, Hello wo');
    expect(sh.GetRedlineTable()).toEqual([]);
    sh.Undo();
    expect(para(sh).GetText()).toBe('h, Hello world');
    expect(sh.GetRedlineTable().length).toBe(2);
  });

  it('rejects changes at the cursor and walks through them', () => {
    const sh = shell('one two three');
    sh.SttDoc();
    sh.NextWord(); sh.NextWord(true); // select "two "
    sh.DelSelection();
    sh.EndDoc();
    sh.Insert(' four');
    expect(para(sh).GetText()).toBe('one two three four');
    expect(sh.GotoRedline(true)).toBe(true);
    expect(sh.GetSelText()).toBe('two ');
    expect(sh.AcceptRejectAtCursor(false)).toBe(true); // the deletion is undone
    expect(para(sh).GetText()).toBe('one two three four');
    sh.GotoRedline(true);
    expect(sh.GetSelText()).toBe(' four');
    sh.AcceptRejectAtCursor(false); // the insertion goes
    expect(para(sh).GetText()).toBe('one two three');
    expect(sh.GetRedlineTable()).toEqual([]);
  });

  it('tracks paragraph breaks', () => {
    const sh = shell('ab');
    sh.SttDoc(); sh.Right();
    sh.SplitNode();
    const nodes = sh.m_pDoc.GetNodes();
    expect(nodes.FirstTextNode().m_aSet.RES_PARATR_REDLINE?.type).toBe('Insert');
    sh.AcceptRejectAll(false);
    expect(nodes.FirstTextNode().GetText()).toBe('ab');
    sh.SetRedlineOn(false);
    sh.SplitNode();
    sh.SetRedlineOn(true);
    // Deleting the break between two paragraphs marks it.
    sh.SttDoc(); sh.RightMargin(); sh.DelRight();
    expect(nodes.FirstTextNode().m_aSet.RES_PARATR_REDLINE?.type).toBe('Delete');
    expect(nodes.LastTextNode()).not.toBe(nodes.FirstTextNode());
    sh.AcceptRejectAll(true);
    expect(nodes.FirstTextNode().GetText()).toBe('ab');
    expect(nodes.LastTextNode()).toBe(nodes.FirstTextNode());
  });
});

import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { readZip } from '../../src/lo/package/source/zipapi/zip.ts';

describe('tracked changes in ODT', () => {
  it('survive a round trip, deleted paragraph ends included', async () => {
    const sh = shell('one two');
    sh.SplitNode();
    sh.Insert('three');
    sh.SetRedlineOn(false);
    sh.SplitNode();
    sh.Insert('four');
    sh.SetRedlineOn(true);
    // Delete "two" and the paragraph end after "three".
    sh.SttDoc(); sh.NextWord(); sh.NextWord(true); sh.DelSelection();
    const nodes = sh.m_pDoc.GetNodes();
    const second = nodes.GoNext(nodes.FirstTextNode().GetIndex())!;
    sh.SelectRange(second, second.Len(), second.Len()); sh.DelRight();
    const before = sh.GetRedlineTable().map((r) => [r.data.type, r.pieces.map((p) => (p.mark ? '¶' : p.node.GetText().slice(p.start, p.end))).join('')]);
    expect(before).toEqual([['Delete', 'two'], ['Insert', '¶three'], ['Delete', '¶']]);
    const bytes = await ExportODT(sh.m_pDoc);
    const content = new TextDecoder().decode((await readZip(bytes)).get('content.xml'));
    expect(content).toContain('text:track-changes="true"');
    expect(content).toContain('<dc:creator>Ada</dc:creator>');
    const { doc, lost } = await ImportODT(bytes);
    expect(lost).toEqual([]);
    const back = doc.m_pDocumentRedlineManager.GetRedlineTable().map((r) => [r.data.type, r.pieces.map((p) => (p.mark ? '¶' : p.node.GetText().slice(p.start, p.end))).join('')]);
    expect(back).toEqual(before);
    const texts: string[] = [];
    for (let n: SwTextNode | null = doc.GetNodes().FirstTextNode(); n; n = doc.GetNodes().GoNext(n.GetIndex())) texts.push(n.GetText());
    expect(texts).toEqual(['one two', 'three', 'four']);
    expect(doc.m_pDocumentRedlineManager.m_bRecord).toBe(true);
  });
});
