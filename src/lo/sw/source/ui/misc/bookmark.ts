// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/ui/misc/bookmark.cxx reduced
// @upstream sw/source/ui/inc/bookmark.hxx partial
// @upstream sw/source/ui/utlui/swrenamexnameddlg.cxx reduced
// Insert > Bookmark (SwInsertBookmarkDlg, insertbookmark.ui) and its Rename dialog
// (SwRenameXNamedDlg), apart from the widgets: the members stand for the widgets' state (the name
// entry's text, the table's rows and selection, the buttons' sensitivity) and the shell renders
// them. Reduced: the Hide check box and its condition (shown only in experimental mode upstream)
// are not ported, so a bookmark is hidden only as Word's _Toc and _Ref bookmarks are; the table's
// sorting (HeaderBarClick) is the view's; the dialog's size is not remembered; the rename dialog
// renames through the shell instead of the UNO bookmark (XNamed::setName).
import type { MarkBase } from '../../core/doc/docbm.ts';
import type { SwWrtShell } from '../../uibase/wrtsh/wrtsh.ts';

/** STR_BOOKMARK_DEF_NAME */
export const STR_BOOKMARK_DEF_NAME = 'Bookmark';

/** A row of the bookmark table: page, name, text, hidden, condition (the tree view's columns). */
export interface BookmarkRow {
  pMark: MarkBase;
  sPageNum: string;
  sName: string;
  sText: string;
  /** STR_BOOKMARK_YES or STR_BOOKMARK_NO */
  bHidden: boolean;
  sHideCondition: string;
}

/** BookmarkTable: the dialog's table of bookmarks. */
export class BookmarkTable {
  static readonly aForbiddenChars = '/\\@*?",#';
  static readonly s_cSeparator = ';';

  /** The rows, in the order inserted (the view may show them sorted). */
  m_aRows: BookmarkRow[] = [];
  /** The selected rows (SelectionMode::Multiple). */
  m_aSelected = new Set<MarkBase>();

  clear(): void { this.m_aRows = []; this.m_aSelected.clear(); }
  unselect_all(): void { this.m_aSelected.clear(); }
  select(pMark: MarkBase): void { this.m_aSelected.add(pMark); }
  /** The selected rows, in table order (selected_foreach). */
  selected(): BookmarkRow[] { return this.m_aRows.filter((r) => this.m_aSelected.has(r.pMark)); }
  /** get_selected: the first selected row. */
  get_selected(): BookmarkRow | null { return this.selected()[0] ?? null; }
  remove_selection(): void {
    this.m_aRows = this.m_aRows.filter((r) => !this.m_aSelected.has(r.pMark));
    this.m_aSelected.clear();
  }

  InsertBookmark(rSh: SwWrtShell, pMark: MarkBase): void {
    let sBookmarkNodeText = '';
    const nMaxTextLen = 50;

    if (pMark.IsExpanded()) {
      sBookmarkNodeText = rSh.GetMarkText(pMark);
    }
    if (nMaxTextLen < sBookmarkNodeText.length) {
      sBookmarkNodeText = sBookmarkNodeText.slice(0, nMaxTextLen);
      sBookmarkNodeText += '…';
    }

    const sHideCondition = '';
    const sName = pMark.GetName();
    // tdf#150955 add "hidden" status to the imported OOXML _Toc and _Ref bookmarks
    // to allow separating custom bookmarks by sorting based on their Hidden status.
    // Note: this "hidden" means here only that these bookmarks haven't got
    // visible bookmark formatting aids (gray I-shape or brackets), otherwise
    // their anchor are still visible.
    const bHidden = sName.startsWith('_Toc') || sName.startsWith('_Ref');

    const sPageNum = String(rSh.GetPageNumOf(pMark.GetMarkStart()));
    this.m_aRows.push({ pMark, sPageNum, sName, sText: sBookmarkNodeText, bHidden, sHideCondition });
  }

  private GetRowByBookmarkName(sName: string): BookmarkRow | null {
    return this.m_aRows.find((r) => r.pMark.GetName() === sName) ?? null;
  }

  GetBookmarkByName(sName: string): MarkBase | null {
    return this.GetRowByBookmarkName(sName)?.pMark ?? null;
  }

  SelectByName(sName: string): boolean {
    const xEntry = this.GetRowByBookmarkName(sName);
    if (!xEntry) return false;
    this.select(xEntry.pMark);
    return true;
  }

  /** "Bookmark N", N one more than the highest of the default names. */
  GetNameProposal(): string {
    const sDefaultBookmarkName = STR_BOOKMARK_DEF_NAME;
    let nHighestBookmarkId = 0;
    for (const r of this.m_aRows) {
      const sName = r.pMark.GetName();
      const aTokens = sName.split(' ');
      if (aTokens[0] === sDefaultBookmarkName) {
        // o3tl::toInt32: the leading digits, else 0
        const nCurrBookmarkId = parseInt(aTokens[1] ?? '', 10) || 0;
        nHighestBookmarkId = Math.max(nHighestBookmarkId, nCurrBookmarkId);
      }
    }
    return `${sDefaultBookmarkName} ${nHighestBookmarkId + 1}`;
  }
}

/** SwInsertBookmarkDlg */
export class SwInsertBookmarkDlg {
  readonly m_rSh: SwWrtShell;
  /** The bookmarks shown and their names when shown, to notice changes made elsewhere. */
  private m_aTableBookmarks: [MarkBase, string][] = [];
  private m_nLastBookmarksCount = 0;
  m_bAreProtected: boolean;

  /** The name entry's text (m_xEditBox), and whether it shows an error (set_message_type). */
  m_sEditBox = '';
  m_bEditBoxError = false;
  /** lbForbiddenChars: "Forbidden characters: …", shown while the name has some. */
  m_bForbiddenCharsVisible = false;
  readonly m_xBookmarksBox = new BookmarkTable();
  /** The buttons' sensitivity. */
  m_bInsert = true;
  m_bDelete = false;
  m_bGoto = false;
  m_bEditText = false;
  m_bRename = false;
  /** The response: the dialog closes after Insert (RET_OK). */
  m_bClosed = false;

  constructor(rS: SwWrtShell, pSelected?: string) {
    this.m_rSh = rS;

    this.m_bDelete = false;
    this.m_bGoto = false;
    this.m_bEditText = false;
    this.m_bRename = false;

    this.PopulateTable();

    this.m_sEditBox = this.m_xBookmarksBox.GetNameProposal();

    this.m_bForbiddenCharsVisible = false;

    this.m_bAreProtected = this.m_rSh.m_pDoc.m_bProtectBookmarks;

    if (pSelected !== undefined) {
      if (this.m_xBookmarksBox.SelectByName(pSelected)) {
        this.SelectionChanged();
      }
    }
  }

  // callback to modify EditBox
  ModifyHdl(sText: string): void {
    this.m_sEditBox = sText;
    this.ValidateBookmarks();
    this.m_xBookmarksBox.unselect_all();
    // if a string has been pasted from the clipboard then
    // there may be illegal characters in the box
    // sanitization
    let sTmp = this.m_sEditBox;
    const nLen = sTmp.length;
    for (const c of BookmarkTable.aForbiddenChars) {
      sTmp = sTmp.replaceAll(c, '');
    }
    const bHasForbiddenChars = sTmp.length !== nLen;
    this.m_bForbiddenCharsVisible = bHasForbiddenChars;
    this.m_bEditBoxError = bHasForbiddenChars;

    let nSelectedEntries = 0;
    let nEntries = 0;
    if (sTmp) {
      for (const aToken of sTmp.split(BookmarkTable.s_cSeparator)) {
        if (this.m_xBookmarksBox.GetBookmarkByName(aToken)) {
          this.m_xBookmarksBox.SelectByName(aToken);
          nSelectedEntries++;
        }
        nEntries++;
      }
    }

    // allow to add new bookmark only if one name provided and it's not taken
    this.m_bInsert = nEntries === 1 && nSelectedEntries === 0 && !bHasForbiddenChars
      && !this.m_bAreProtected;

    // allow to delete only if all bookmarks are recognized
    this.m_bDelete = nEntries > 0 && nSelectedEntries === nEntries && !this.m_bAreProtected;
    this.m_bGoto = nEntries === 1 && nSelectedEntries === 1;
    this.m_bEditText = nEntries === 1 && nSelectedEntries === 1;
    this.m_bRename = nEntries === 1 && nSelectedEntries === 1 && !this.m_bAreProtected;
  }

  // callback to delete a text mark
  DeleteHdl(): void {
    if (!this.ValidateBookmarks()) return;

    let nSelectedRows = 0;

    for (const rEntry of this.m_xBookmarksBox.selected()) {
      // remove from model
      const pBookmark = rEntry.pMark;
      const sRemoved = pBookmark.GetName();
      this.m_rSh.DeleteBookmark(sRemoved);
      this.m_aTableBookmarks = this.m_aTableBookmarks.filter(([p, s]) => !(p === pBookmark && s === sRemoved));

      ++nSelectedRows;
    }

    if (!nSelectedRows) return;

    // remove from BookmarkTable
    this.m_xBookmarksBox.remove_selection();

    this.ValidateBookmarks();

    this.m_bDelete = false;
    this.m_bGoto = false;
    this.m_bEditText = false;
    this.m_bRename = false;
    this.m_bInsert = false;
  }

  // callback to a goto button
  GotoHdl(): void { this.GotoSelectedBookmark(); }

  DoubleClickHdl(): void { this.GotoSelectedBookmark(); }

  /** A selection changed by clicking on the table (`aSelected`: the rows now selected). */
  SelectionChangedHdl(aSelected: MarkBase[]): void {
    if (!this.ValidateBookmarks()) return;
    this.m_xBookmarksBox.unselect_all();
    for (const p of aSelected) this.m_xBookmarksBox.select(p);

    this.SelectionChanged();
  }

  SelectionChanged(): void {
    const aNames: string[] = [];
    let nSelectedRows = 0;
    for (const rEntry of this.m_xBookmarksBox.selected()) {
      aNames.push(rEntry.pMark.GetName());
      ++nSelectedRows;
    }
    if (nSelectedRows) {
      this.m_bInsert = false;
      this.m_bGoto = nSelectedRows === 1;
      this.m_bEditText = nSelectedRows === 1;
      this.m_bRename = nSelectedRows === 1 && !this.m_bAreProtected;
      this.m_bDelete = !this.m_bAreProtected;
      this.m_sEditBox = aNames.join(BookmarkTable.s_cSeparator);
    } else {
      this.m_bInsert = !this.m_bAreProtected;
      this.m_bGoto = false;
      this.m_bEditText = false;
      this.m_bRename = false;
      this.m_bDelete = false;
    }
  }

  /** EditTextHdl: the row whose text to edit in place (start_editing), or null. */
  EditTextHdl(): MarkBase | null {
    if (!this.ValidateBookmarks()) return null;
    const pSelected = this.m_xBookmarksBox.get_selected();
    if (!pSelected) return null;

    return this.EditingHdl(pSelected) ? pSelected.pMark : null;
  }

  /** RenameHdl: the bookmark to rename in the Rename dialog, or null. */
  RenameHdl(): MarkBase | null {
    if (!this.ValidateBookmarks()) return null;
    const xSelected = this.m_xBookmarksBox.get_selected();
    if (!xSelected) return null;
    return xSelected.pMark;
  }

  /** The Rename dialog's response: RET_OK when it renamed the bookmark. */
  RenameDone(bOk: boolean): void {
    if (bOk) {
      this.ValidateBookmarks();
      this.m_bDelete = false;
      this.m_bGoto = false;
      this.m_bEditText = false;
      this.m_bRename = false;
      this.m_bInsert = false;
    }
  }

  // callback to an insert button. Inserts a new text mark to the current position.
  InsertHdl(): void {
    const sBookmark = this.m_sEditBox;
    this.m_rSh.SetBookmark(sBookmark);

    this.m_bClosed = true;
  }

  /** Whether a row's text may be edited: a range within one paragraph, not cut short. */
  EditingHdl(rIter: BookmarkRow): boolean {
    const pBookmark = rIter.pMark;
    return pBookmark.IsExpanded()
      && pBookmark.GetMarkPos().GetNode() === pBookmark.GetOtherMarkPos().GetNode()
      && !rIter.sText.endsWith('…');
  }

  /** The edited text of a row: the bookmark's text replaced (SwEditShell::Replace). */
  EditedHdl(rIter: BookmarkRow, sText: string): boolean {
    const bRet = this.m_rSh.EditBookmarkText(rIter.pMark, sText);
    if (bRet) rIter.sText = sText;
    return bRet;
  }

  GotoSelectedBookmark(): void {
    if (!this.ValidateBookmarks()) return;
    // if no entries selected we can't jump anywhere
    // shouldn't be needed as we disable GoTo button when jump is not possible
    const xSelected = this.m_xBookmarksBox.get_selected();
    if (!xSelected) return;

    const pBookmark = xSelected.pMark;

    this.m_rSh.SelectFly(null);
    this.m_rSh.GotoMark(pBookmark);
  }

  ValidateBookmarks(): boolean {
    if (this.HaveBookmarksChanged()) {
      this.PopulateTable();
      this.m_sEditBox = '';
      return false;
    }
    return true;
  }

  HaveBookmarksChanged(): boolean {
    const pMarkAccess = this.m_rSh.getIDocumentMarkAccess();
    if (pMarkAccess.getBookmarksCount() !== this.m_nLastBookmarksCount) return true;

    let aListIter = 0;
    for (const ppBookmark of pMarkAccess.getBookmarks()) {
      // more bookmarks then expected
      if (aListIter === this.m_aTableBookmarks.length) return true;
      const [p, s] = this.m_aTableBookmarks[aListIter]!;
      if (p !== ppBookmark || s !== ppBookmark.GetName()) return true;
      ++aListIter;
    }
    // less bookmarks then expected
    return aListIter !== this.m_aTableBookmarks.length;
  }

  PopulateTable(): void {
    this.m_aTableBookmarks = [];
    this.m_xBookmarksBox.clear();

    const pMarkAccess = this.m_rSh.getIDocumentMarkAccess();
    for (const ppBookmark of pMarkAccess.getBookmarks()) {
      this.m_xBookmarksBox.InsertBookmark(this.m_rSh, ppBookmark);
      this.m_aTableBookmarks.push([ppBookmark, ppBookmark.GetName()]);
    }

    this.m_nLastBookmarksCount = pMarkAccess.getBookmarksCount();
  }
}

/**
 * SwRenameXNamedDlg for a bookmark: the new name, with the forbidden characters (and the dialog's
 * separator) filtered out as typed (TextFilterHdl).
 */
export function SwRenameXNamedDlg_TextFilter(rTest: string): string {
  let s = rTest;
  for (const c of BookmarkTable.aForbiddenChars + BookmarkTable.s_cSeparator) s = s.replaceAll(c, '');
  return s;
}

/** SwRenameXNamedDlg::ModifyHdl: OK is possible for a name that is not empty and not taken. */
export function SwRenameXNamedDlg_ModifyHdl(rSh: SwWrtShell, sTmp: string): boolean {
  return !!sTmp
    && !rSh.getIDocumentMarkAccess().findMark(sTmp);
}

/** SwRenameXNamedDlg::OkHdl: the bookmark renamed (an undo step). */
export function SwRenameXNamedDlg_OkHdl(rSh: SwWrtShell, pMark: MarkBase, sNewName: string): boolean {
  return rSh.RenameBookmark(pMark.GetName(), sNewName);
}
