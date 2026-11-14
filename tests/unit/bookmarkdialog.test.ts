// Insert > Bookmark (SwInsertBookmarkDlg), Tools > Protect Document > Protect Bookmarks and
// Protect Fields (SwPaM::HasReadonlySel), and going to what a cross-reference refers to
// (SwCursorShell::GotoRefMark).
import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { RefFieldFormat, ReferencesSubtype } from '../../src/lo/sw/source/core/fields/reffld.ts';
import { SwInsertBookmarkDlg, SwRenameXNamedDlg_ModifyHdl, SwRenameXNamedDlg_OkHdl, SwRenameXNamedDlg_TextFilter } from '../../src/lo/sw/source/ui/misc/bookmark.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => [...t].length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };
const at = (sh: SwWrtShell) => sh.m_pCursor.GetPoint().GetNode();

/** "Alpha beta gamma" / page break / "Second page", with "Bookmark 1" on "beta" and "end" in the second paragraph. */
function doc(): SwWrtShell {
  const sh = new SwWrtShell(new SwDoc(), mono);
  sh.Insert('Alpha beta gamma');
  const first = at(sh);
  sh.SplitNode();
  sh.InsertPageBreak(null);
  sh.Insert('Second page');
  sh.SetBookmark('end');
  sh.SelectRange(first, 6, 10);
  sh.SetBookmark('Bookmark 1');
  sh.SelectRange(first, 0, 0);
  return sh;
}

describe('Bookmark dialog', () => {
  it('lists the bookmarks with page and text, proposes a name and inserts', () => {
    const sh = doc();
    const dlg = new SwInsertBookmarkDlg(sh);
    expect(dlg.m_xBookmarksBox.m_aRows.map((r) => [r.sPageNum, r.sName, r.sText, r.bHidden])).toEqual([
      ['1', 'Bookmark 1', 'beta', false], ['2', 'end', '', false],
    ]);
    expect(dlg.m_sEditBox).toBe('Bookmark 2');
    expect([dlg.m_bInsert, dlg.m_bDelete, dlg.m_bGoto, dlg.m_bEditText, dlg.m_bRename]).toEqual([true, false, false, false, false]);
    dlg.InsertHdl();
    expect(dlg.m_bClosed).toBe(true);
    expect(sh.getIDocumentMarkAccess().findMark('Bookmark 2')!.GetMarkStart().GetContentIndex()).toBe(0);
    sh.Undo();
    expect(sh.getIDocumentMarkAccess().findMark('Bookmark 2')).toBeUndefined();
  });

  it('selects the bookmarks named, refuses forbidden characters, and deletes', () => {
    const sh = doc();
    const dlg = new SwInsertBookmarkDlg(sh);
    dlg.ModifyHdl('end');
    expect([...dlg.m_xBookmarksBox.m_aSelected].map((m) => m.GetName())).toEqual(['end']);
    expect([dlg.m_bInsert, dlg.m_bDelete, dlg.m_bGoto, dlg.m_bRename]).toEqual([false, true, true, true]);
    dlg.ModifyHdl('a#b');
    expect(dlg.m_bForbiddenCharsVisible).toBe(true);
    expect(dlg.m_bInsert).toBe(false);
    // Several names, separated by ";", can be deleted at once, but not gone to.
    dlg.ModifyHdl('end;Bookmark 1');
    expect([dlg.m_bDelete, dlg.m_bGoto]).toEqual([true, false]);
    dlg.DeleteHdl();
    expect(sh.getIDocumentMarkAccess().getBookmarksCount()).toBe(0);
    expect(dlg.m_xBookmarksBox.m_aRows).toEqual([]);
  });

  it('goes to a bookmark, edits its text and renames it', () => {
    const sh = doc();
    const dlg = new SwInsertBookmarkDlg(sh);
    dlg.SelectionChangedHdl([dlg.m_xBookmarksBox.m_aRows[0]!.pMark]);
    expect(dlg.m_sEditBox).toBe('Bookmark 1');
    dlg.GotoHdl();
    expect([sh.m_pCursor.Start().GetContentIndex(), sh.m_pCursor.End().GetContentIndex()]).toEqual([6, 10]);
    // Edit Text: the bookmark keeps around the new text; one undo step.
    const p = dlg.EditTextHdl()!;
    const row = dlg.m_xBookmarksBox.m_aRows[0]!;
    expect(dlg.EditedHdl(row, 'delta')).toBe(true);
    expect(at(sh).GetText()).toBe('Alpha delta gamma');
    expect([p.GetMarkStart().GetContentIndex(), p.GetMarkEnd().GetContentIndex()]).toEqual([6, 11]);
    sh.Undo();
    expect(at(sh).GetText()).toBe('Alpha beta gamma');
    // The table notices the bookmarks changed (undo made them anew) and lists them again.
    expect(dlg.ValidateBookmarks()).toBe(false);
    expect(dlg.m_xBookmarksBox.m_aRows[0]!.sText).toBe('beta');
    // A bookmark without range has no text to edit.
    dlg.SelectionChangedHdl([dlg.m_xBookmarksBox.m_aRows[1]!.pMark]);
    expect(dlg.EditTextHdl()).toBeNull();
    // Rename: forbidden characters are filtered, a taken name refused.
    const pEnd = dlg.RenameHdl()!;
    expect(SwRenameXNamedDlg_TextFilter('fin;al#')).toBe('final');
    expect(SwRenameXNamedDlg_ModifyHdl(sh, 'Bookmark 1')).toBe(false);
    expect(SwRenameXNamedDlg_ModifyHdl(sh, 'final')).toBe(true);
    expect(SwRenameXNamedDlg_OkHdl(sh, pEnd, 'final')).toBe(true);
    dlg.RenameDone(true);
    expect(dlg.m_xBookmarksBox.m_aRows.map((r) => r.sName)).toEqual(['Bookmark 1', 'final']);
  });

  it('selects the bookmark named when opened for one, and keeps protected bookmarks', () => {
    const sh = doc();
    expect(new SwInsertBookmarkDlg(sh, 'end').m_bGoto).toBe(true);
    sh.m_pDoc.m_bProtectBookmarks = true;
    const dlg = new SwInsertBookmarkDlg(sh);
    dlg.ModifyHdl('end');
    expect([dlg.m_bDelete, dlg.m_bRename, dlg.m_bGoto]).toEqual([false, false, true]);
    dlg.ModifyHdl('new');
    expect(dlg.m_bInsert).toBe(false);
  });
});

describe('Tools > Protect Document', () => {
  it('Bookmarks: text deleting a bookmark cannot be deleted', () => {
    const sh = doc();
    const first = sh.m_pCursor.GetPoint().GetNode();
    sh.m_pDoc.m_bProtectBookmarks = true;
    let refused = 0;
    sh.m_fnReadonly = () => { refused++; };
    // Deleting all of "beta" would delete the bookmark.
    sh.SelectRange(first, 5, 11);
    sh.DelSelection();
    expect(first.GetText()).toBe('Alpha beta gamma');
    // Part of it may go, and text elsewhere.
    sh.SelectRange(first, 6, 7);
    sh.DelSelection();
    sh.SelectRange(first, 0, 1);
    sh.DelLeft();
    expect(first.GetText()).toBe('lpha eta gamma');
    // Backspace deleting the character after a collapsed bookmark is refused, the cursor stays.
    sh.m_pDoc.m_bProtectBookmarks = false;
    sh.SelectRange(first, 2, 2);
    sh.SetBookmark('one');
    sh.m_pDoc.m_bProtectBookmarks = true;
    sh.SelectRange(first, 3, 3);
    sh.DelLeft();
    expect(first.GetText()).toBe('lpha eta gamma');
    expect([sh.HasSelection(), sh.m_pCursor.GetPoint().GetContentIndex()]).toEqual([false, 3]);
    sh.DelRight();
    expect(first.GetText()).toBe('lph eta gamma');
    expect(refused).toBe(2);
  });

  it('Fields: a selection with a field is read-only', () => {
    const sh = doc();
    const first = at(sh);
    sh.SelectRange(first, 0, 0);
    sh.InsertRefField({ subType: ReferencesSubtype.Bookmark, format: RefFieldFormat.Content, name: 'end' });
    sh.m_pDoc.m_bProtectFields = true;
    sh.SelectRange(first, 0, 3);
    expect(sh.HasReadonlySel()).toBe(true);
    sh.SelectRange(first, 1, 0);
    sh.DelLeft();
    sh.SelectRange(first, 0, 0);
    sh.DelRight();
    expect(first.GetText().charCodeAt(0)).toBe(1);
    // Next to it, typing goes on.
    sh.SelectRange(first, 1, 1);
    expect(sh.HasReadonlySel()).toBe(false);
    sh.m_pDoc.m_bProtectFields = false;
    sh.SelectRange(first, 0, 1);
    expect(sh.HasReadonlySel()).toBe(false);
  });

  it('is kept in ODT settings', async () => {
    const sh = doc();
    sh.m_pDoc.m_bProtectBookmarks = true;
    const back = (await ImportODT(await ExportODT(sh.m_pDoc))).doc;
    expect([back.m_bProtectBookmarks, back.m_bProtectFields]).toEqual([true, false]);
  });
});

describe('Cross-reference fields', () => {
  it('go to what they refer to (ClickToField)', () => {
    const sh = doc();
    const first = at(sh);
    sh.InsertRefField({ subType: ReferencesSubtype.Bookmark, format: RefFieldFormat.Content, name: 'end' });
    const f = sh.GetRefFieldAt(first, 0)!;
    expect(f.type).toBe('GetRef');
    expect(sh.GetRefFieldAt(first, 1)).toBe(f);
    expect(sh.GetRefFieldAt(first, 3)).toBeNull();
    expect(sh.GotoRefMark(f.name ?? '', f.subType ?? 0, 0)).toBe(true);
    expect(at(sh).GetText()).toBe('Second page');
    expect(sh.GotoRefMark('missing', ReferencesSubtype.Bookmark, 0)).toBe(false);
  });
});
