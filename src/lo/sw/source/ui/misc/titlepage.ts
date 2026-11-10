// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/ui/misc/titlepage.cxx reduced
// SwTitlePageDlg's reading of the document and its OKHdl, apart from the dialog. The page style
// list and its Edit button (FormatPage) are not ported, nor DoSpecialInsert's empty paragraph
// before a table at the insert position.
import type { SwFormatPageDesc } from '../../../inc/hintids.ts';
import type { SwPageDesc } from '../../../inc/pagedesc.ts';
import type { SwWrtShell } from '../../uibase/wrtsh/wrtsh.ts';

/** USHRT_MAX: "set no number", so as not to inherit the numbering of the existing page. */
const SAL_MAX_UINT16 = 0xffff;

/** The paragraph's page style attribute at the cursor (GetCurAttr with RES_PAGEDESC). */
function lcl_GetPageDesc(rSh: SwWrtShell): SwFormatPageDesc | null {
  return rSh.m_pCursor.GetPoint().GetNode().GetAttr('RES_PAGEDESC');
}

function lcl_ChangePage(rSh: SwWrtShell, nNewNumber: number, pNewDesc: SwPageDesc | null): void {
  const rCurrentDesc = rSh.GetCurPageDesc();
  const pPageFormatDesc = lcl_GetPageDesc(rSh);

  // If we want a new number then set it, otherwise reuse the existing one
  let nPgNo = 0;
  if (nNewNumber) {
    // -1: Allow special case to prevent inheriting re-numbering from the existing page.
    nPgNo = nNewNumber === SAL_MAX_UINT16 ? 0 : nNewNumber;
  } else if (pPageFormatDesc) {
    if (pPageFormatDesc.numOffset !== null) nPgNo = pPageFormatDesc.numOffset;
  }

  // If we want a new descriptor then set it, otherwise reuse the existing one
  if (pNewDesc || nPgNo) rSh.SetPageDescAttr({ name: (pNewDesc ?? rCurrentDesc).m_aName, numOffset: nPgNo || null });
}

const lcl_GetCurrentPage = (rSh: SwWrtShell): number => rSh.GetPageNumber();

function lcl_GotoPage(rSh: SwWrtShell, nStartingPage: number, nOffset = 0): boolean {
  rSh.GotoPage(nStartingPage);

  const nCurrentPage = lcl_GetCurrentPage(rSh);
  // return false if at document end (unless that was the requested destination)
  if (nCurrentPage === rSh.GetPageCnt()) return nCurrentPage === nStartingPage + nOffset;

  // Blank pages for odd and even page styles are not laid out here, so the page is the one asked for.
  // Now that we have the correct starting point, move to the correct offset.
  while (nOffset--) rSh.SttNxtPg();
  return true;
}

export interface SwTitlePageSettings {
  /** Convert existing pages (true) or insert new ones. */
  bUseExisting: boolean;
  nPageCount: number;
  /** The first title page: 1 for the document start, else the page number to insert at. */
  nPageStart: number;
  /** Reset page numbering after the title pages, and the number to start at. */
  bRestartNumbering: boolean;
  nRestartNumber: number;
  /** Set the page number of the first title page. */
  bSetPageNumber: boolean;
  nSetPageNumber: number;
}

export interface SwTitlePageDlg {
  mpTitleDesc: SwPageDesc;
  mpIndexDesc: SwPageDesc;
  mpNormalDesc: SwPageDesc;
  mpPageFormatDesc: SwFormatPageDesc | null;
  /** The dialog's initial values. */
  settings: SwTitlePageSettings;
  nPageCnt: number;
}

/** SwTitlePageDlg::SwTitlePageDlg: the title pages the document already has. */
export function SwTitlePageDlgInit(rWrtShell: SwWrtShell): SwTitlePageDlg {
  let nSetPage = 1;
  let nResetPage = 1;
  let nTitlePages = 1;
  const saved = rWrtShell.SaveCursor();
  const nCurrentPage = lcl_GetCurrentPage(rWrtShell);

  let bMaybeResetNumbering = false;

  const doc = rWrtShell.m_pDoc;
  const mpTitleDesc = doc.FindPageDesc('First Page')!;
  const mpIndexDesc = doc.FindPageDesc('Index')!;
  let mpNormalDesc = doc.m_aPageDesc;

  rWrtShell.SttDoc();
  const mpPageFormatDesc = lcl_GetPageDesc(rWrtShell);
  if (mpPageFormatDesc) {
    if (mpPageFormatDesc.numOffset !== null) nSetPage = mpPageFormatDesc.numOffset;
    if (mpPageFormatDesc.name === mpTitleDesc.m_aName) {
      while (rWrtShell.SttNxtPg()) {
        const rPageDesc = rWrtShell.GetCurPageDesc();

        if (mpIndexDesc !== rPageDesc) {
          mpNormalDesc = rPageDesc;
          const d = lcl_GetPageDesc(rWrtShell);
          bMaybeResetNumbering = !!d;
          if (d?.numOffset != null) nResetPage = d.numOffset;
          break;
        }
        ++nTitlePages;
      }
    }
  }
  rWrtShell.RestoreCursor(saved);

  return {
    mpTitleDesc, mpIndexDesc, mpNormalDesc, mpPageFormatDesc, nPageCnt: rWrtShell.GetPageCnt(),
    settings: {
      bUseExisting: true, nPageCount: nTitlePages, nPageStart: nCurrentPage,
      bRestartNumbering: bMaybeResetNumbering && nResetPage > 0, nRestartNumber: nResetPage,
      bSetPageNumber: nSetPage > 1, nSetPageNumber: nSetPage,
    },
  };
}

/** SwTitlePageDlg::OKHdl. `bDocumentStart` is the "Document start" choice (GetInsertPosition 1). */
export function SwTitlePageDlgOK(rWrtShell: SwWrtShell, dlg: SwTitlePageDlg, s: SwTitlePageSettings, bDocumentStart: boolean): void {
  const saved = rWrtShell.SaveCursor();
  const nUndo = rWrtShell.StartUndo();
  const GetInsertPosition = () => (bDocumentStart ? 1 : s.nPageStart);

  const aTitleDesc: SwFormatPageDesc = { name: dlg.mpTitleDesc.m_aName, numOffset: null };
  if (s.bSetPageNumber) aTitleDesc.numOffset = s.nSetPageNumber;
  else if (dlg.mpPageFormatDesc) aTitleDesc.numOffset = dlg.mpPageFormatDesc.numOffset;

  const nNumTitlePages = s.nPageCount;
  if (!s.bUseExisting) {
    // Assuming that a failure to GotoPage means the end of the document,
    // insert new pages after the last page.
    if (!lcl_GotoPage(rWrtShell, GetInsertPosition())) {
      rWrtShell.EndDoc();
      // Add one more page as a content page to follow the new title pages.
      rWrtShell.InsertPageBreak(null);
    }

    for (let nI = 0; nI < nNumTitlePages; ++nI) rWrtShell.InsertPageBreak(null);
    // In order to be able to access these new pages, the layout needs to be recalculated first
    // (it already is after each change).
  }

  if (lcl_GotoPage(rWrtShell, GetInsertPosition())) {
    rWrtShell.SetPageDescAttr(aTitleDesc);
    for (let nI = 1; nI < nNumTitlePages; ++nI) {
      if (rWrtShell.SttNxtPg()) lcl_ChangePage(rWrtShell, SAL_MAX_UINT16, dlg.mpIndexDesc);
    }
  }

  if ((s.bRestartNumbering || nNumTitlePages > 1) && lcl_GotoPage(rWrtShell, GetInsertPosition(), nNumTitlePages)) {
    const nPgNo = s.bRestartNumbering ? s.nRestartNumber : 0;
    const pNewDesc = nNumTitlePages > 1 ? dlg.mpNormalDesc : null;
    lcl_ChangePage(rWrtShell, nPgNo, pNewDesc);
  }

  rWrtShell.EndUndo(nUndo);
  rWrtShell.RestoreCursor(saved);
  if (!s.bUseExisting) lcl_GotoPage(rWrtShell, GetInsertPosition());
}
