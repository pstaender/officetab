// The Navigator's content (sw/source/uibase/utlui/content.cxx): the members of each content type
// in document order, going to one, Navigate By's previous and next, and moving and promoting
// headings.
import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ContentTypeId, ExecCommand, GotoContent, MoveNavigation, SwContentType } from '../../src/lo/sw/source/uibase/utlui/content.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };
const texts = (sh: SwWrtShell) => [...sh.m_pDoc.allText()].map((n) => n.GetText());
const names = (sh: SwWrtShell, t: ContentTypeId) => new SwContentType(sh, t).m_aMember.map((m) => m.m_sContentName);

/** H1 A, text a, H2 A.1, text a1, H1 B, text b, H1 C, text c. */
function chapters(): SwWrtShell {
  const sh = new SwWrtShell(new SwDoc(), mono);
  const para = (text: string, style?: string) => { sh.Insert(text); if (style) sh.SetTextFormatColl(style); sh.SplitNode(); };
  para('A', 'Heading 1'); para('a');
  para('A.1', 'Heading 2'); para('a1');
  para('B', 'Heading 1'); para('b');
  para('C', 'Heading 1'); sh.Insert('c');
  sh.SttDoc();
  return sh;
}

describe('Navigator content', () => {
  it('lists headings with their levels, and the shown levels', () => {
    const sh = chapters();
    const t = new SwContentType(sh, ContentTypeId.OUTLINE);
    expect(t.m_aMember.map((m) => [m.m_sContentName, m.m_nOutlineLevel])).toEqual([['A', 0], ['A.1', 1], ['B', 0], ['C', 0]]);
    expect(new SwContentType(sh, ContentTypeId.OUTLINE, 1).m_aMember.map((m) => m.m_sContentName)).toEqual(['A', 'B', 'C']);
  });

  it('goes to a heading, and tracks the heading the cursor is under', () => {
    const sh = chapters();
    const b = new SwContentType(sh, ContentTypeId.OUTLINE).m_aMember[2]!;
    expect(GotoContent(sh, b, ContentTypeId.OUTLINE)).toBe(true);
    expect(sh.m_pCursor.GetPoint().GetNode().GetText()).toBe('B');
    sh.Down();
    expect(sh.GetOutlinePos()).toBe(2);
    sh.SttDoc();
    expect(sh.GetOutlinePos()).toBe(0);
  });

  it('lists tables, bookmarks, hyperlinks, comments, footnotes and fields in document order', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('Start ');
    sh.InsertURL('https://example.org', 'Example');
    sh.SetBookmark('Here');
    sh.SplitNode();
    sh.Insert('Note');
    sh.InsertFootnote();
    sh.Insert('the footnote');
    sh.GotoFootnoteOrAnchor();
    sh.InsertField('PageNumber');
    sh.InsertPostIt('Me');
    sh.SttDoc();
    sh.EndDoc();
    sh.SplitNode();
    sh.InsertTable(2, 2);
    expect(names(sh, ContentTypeId.TABLE)).toEqual(['Table1']);
    expect(names(sh, ContentTypeId.BOOKMARK)).toEqual(['Here']);
    expect(names(sh, ContentTypeId.URLFIELD)).toEqual(['Example']);
    expect(new SwContentType(sh, ContentTypeId.URLFIELD).m_aMember[0]!.m_sURL).toBe('https://example.org');
    expect(names(sh, ContentTypeId.FOOTNOTE)).toEqual(['1 the footnote']);
    expect(names(sh, ContentTypeId.ENDNOTE)).toEqual([]);
    expect(names(sh, ContentTypeId.TEXTFIELD)).toEqual(['field - Page number - 1']);
    expect(names(sh, ContentTypeId.POSTIT)).toHaveLength(1);
    // Going to the footnote puts the cursor before its anchor.
    sh.SttDoc();
    const ftn = new SwContentType(sh, ContentTypeId.FOOTNOTE).m_aMember[0]!;
    GotoContent(sh, ftn, ContentTypeId.FOOTNOTE);
    expect(sh.m_pCursor.GetPoint().GetNode().GetText().startsWith('Note')).toBe(true);
    expect(sh.m_pCursor.GetPoint().GetContentIndex()).toBe(4);
  });

  it('Navigate By goes to the next and previous member, and starts again at the end', () => {
    const sh = chapters();
    expect(MoveNavigation(sh, ContentTypeId.OUTLINE, true)).toEqual({ ok: true, wrapped: false });
    expect(sh.m_pCursor.GetPoint().GetNode().GetText()).toBe('A.1');
    MoveNavigation(sh, ContentTypeId.OUTLINE, true);
    MoveNavigation(sh, ContentTypeId.OUTLINE, true);
    expect(sh.m_pCursor.GetPoint().GetNode().GetText()).toBe('C');
    expect(MoveNavigation(sh, ContentTypeId.OUTLINE, true)).toEqual({ ok: true, wrapped: true });
    expect(sh.m_pCursor.GetPoint().GetNode().GetText()).toBe('A');
    MoveNavigation(sh, ContentTypeId.OUTLINE, false);
    expect(sh.m_pCursor.GetPoint().GetNode().GetText()).toBe('C');
    expect(MoveNavigation(sh, ContentTypeId.TABLE, true)).toEqual({ ok: false, wrapped: false });
  });
});

describe('Navigator heading commands', () => {
  it('moves a chapter with its sub-chapters down and up, as one undo step each', () => {
    const sh = chapters();
    expect(ExecCommand(sh, 'chapterdown', 0)).toBe(true);
    expect(texts(sh)).toEqual(['B', 'b', 'A', 'a', 'A.1', 'a1', 'C', 'c']);
    expect(ExecCommand(sh, 'chapterdown', 1)).toBe(true);
    expect(texts(sh)).toEqual(['B', 'b', 'C', 'c', 'A', 'a', 'A.1', 'a1']);
    // The last chapter stays.
    expect(ExecCommand(sh, 'chapterdown', 2)).toBe(false);
    expect(ExecCommand(sh, 'chapterup', 2)).toBe(true);
    expect(texts(sh)).toEqual(['B', 'b', 'A', 'a', 'A.1', 'a1', 'C', 'c']);
    sh.Undo();
    expect(texts(sh)).toEqual(['B', 'b', 'C', 'c', 'A', 'a', 'A.1', 'a1']);
    sh.Undo();
    sh.Undo();
    expect(texts(sh)).toEqual(['A', 'a', 'A.1', 'a1', 'B', 'b', 'C', 'c']);
  });

  it('a sub-chapter moved up leaves its parent', () => {
    const sh = chapters();
    expect(ExecCommand(sh, 'chapterup', 1)).toBe(true);
    expect(texts(sh)).toEqual(['A.1', 'a1', 'A', 'a', 'B', 'b', 'C', 'c']);
  });

  it('promotes and demotes a heading with its sub-headings, not past level 1', () => {
    const sh = chapters();
    const levels = () => sh.m_pDoc.GetOutLineNds().map((n) => n.GetTextColl().GetName());
    expect(ExecCommand(sh, 'promote', 0)).toBe(false);
    expect(ExecCommand(sh, 'demote', 0)).toBe(true);
    expect(levels()).toEqual(['Heading 2', 'Heading 3', 'Heading 1', 'Heading 1']);
    // Without its children only the heading changes.
    expect(ExecCommand(sh, 'promote', 0, false)).toBe(true);
    expect(levels()).toEqual(['Heading 1', 'Heading 3', 'Heading 1', 'Heading 1']);
    sh.Undo();
    expect(levels()).toEqual(['Heading 2', 'Heading 3', 'Heading 1', 'Heading 1']);
    // Below Heading 6 the pool styles are made when needed.
    for (let i = 0; i < 6; i++) ExecCommand(sh, 'demote', 3);
    expect(levels()[3]).toBe('Heading 7');
    expect(sh.m_pDoc.FindTextFormatCollByName('Heading 7')!.m_pDerivedFrom?.GetName()).toBe('Heading');
  });
});
