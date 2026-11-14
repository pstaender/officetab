// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/uibase/shells/textfld.cxx partial
// SwTextShell::ExecField for FN_PGNUMBER_WIZARD (Insert > Page Number): the result handler of
// SwPageNumberDlg. Reduced where the model is: page style changes are made in place and are not
// part of the undo step (as with Format > Page Style); turning on mirrored margins
// (UseOnPage::Mirror) is not ported; the paragraph style's borders are not counted in the height
// that "Fit into existing margins" takes from the margin.
import { MarkType } from '../../core/doc/docbm.ts';
import { SwDocStatSubType } from '../../core/fields/docufld.ts';
import type { SwField } from '../../../inc/hintids.ts';
import type { SwPageDesc } from '../../../inc/pagedesc.ts';
import { SwPaM, SwPosition } from '../../../inc/pam.ts';
import { fontAt } from '../../core/text/itrform2.ts';
import type { SwWrtShell } from '../wrtsh/wrtsh.ts';

/** The settings of SwPageNumberDlg (pagenumberdlg.ui). */
export interface SwPageNumberDlg {
  /** GetPageNumberPosition: 0 top of page (header), 1 bottom of page (footer). */
  m_aPageNumberPosition: number;
  /** GetPageNumberAlignment: 0 left, 1 center, 2 right. */
  m_aPageNumberAlignment: number;
  /** GetMirrorOnEvenPages; the dialog offers it only when not centred. */
  m_bMirrorOnEvenPages: boolean;
  m_bIncludePageTotal: boolean;
  m_bIncludePageRangeTotal: boolean;
  m_bFitIntoExistingMargins: boolean;
  /** GetPageNumberType: a css::style::NumberingType. */
  m_nPageNumberType: number;
}

/** o3tl::toTwips(5, o3tl::Length::mm) */
const constTwips_5mm = 283;

/** SwPageNumberDlg's defaults: bottom, centred, the current page style's numbering. */
export function SwPageNumberDlgInit(rSh: SwWrtShell): SwPageNumberDlg {
  return {
    m_aPageNumberPosition: 1, m_aPageNumberAlignment: 1, m_bMirrorOnEvenPages: true,
    m_bIncludePageTotal: false, m_bIncludePageRangeTotal: false, m_bFitIntoExistingMargins: false,
    m_nPageNumberType: rSh.GetCurPageDesc().m_nNumType,
  };
}

/** The mirror check box is sensitive only when the page number is not centred. */
const GetMirrorOnEvenPages = (pDlg: SwPageNumberDlg) => pDlg.m_aPageNumberAlignment !== 1 && pDlg.m_bMirrorOnEvenPages;

/** Deletes what a mark spans (DeleteAndJoin of its range). */
function lcl_DeleteMarked(rSh: SwWrtShell, sName: string): void {
  const pMark = rSh.getIDocumentMarkAccess().findMark(sName);
  if (!pMark) return;
  const aDeleteOldPageNum = new SwPaM(new SwPosition(pMark.GetMarkStart().GetNode(), pMark.GetMarkStart().GetContentIndex()), new SwPosition(pMark.GetMarkEnd().GetNode(), pMark.GetMarkEnd().GetContentIndex()));
  if (aDeleteOldPageNum.HasMark()) rSh.m_pDoc.DeleteAndJoin(aDeleteOldPageNum);
  aDeleteOldPageNum.Release();
}

/** The RES_PARATR_ADJUST of the page number's paragraph. */
const ADJUST = ['left', 'center', 'right'] as const;

/** FN_PGNUMBER_WIZARD's RET_OK handler: one undo step (SwUndoId::INSERT_PAGE_NUMBER). */
export function ExecutePageNumberWizard(rSh: SwWrtShell, pDlg: SwPageNumberDlg): void {
  const rDoc = rSh.m_pDoc;
  const nUndo = rSh.StartUndo();

  const rDesc: SwPageDesc = rSh.GetCurPageDesc();
  const bHeader = !pDlg.m_aPageNumberPosition;
  const bHeaderAlreadyOn = rSh.IsHeaderOn(true, rDesc.m_aName);
  const bFooterAlreadyOn = rSh.IsHeaderOn(false, rDesc.m_aName);
  const bIsSinglePage = rDesc.m_sFollow !== rDesc.m_aName;
  const nMirrorPagesNeeded = rSh.HasFirstHeaderFooter(rDesc.m_aName) ? 3 : 2;
  const sBookmarkName = `PageNumWizard_${bHeader ? 'HEADER' : 'FOOTER'}_${rDesc.m_aName}`;
  const rIDMA = rSh.getIDocumentMarkAccess();

  // Allow wizard to be re-run: delete previously wizard-inserted page number.
  // Try before creating non-shared header: avoid copying ODD bookmark onto EVEN page.
  let sBookmarkOddPage = sBookmarkName + String(rSh.GetVirtPageNum());
  lcl_DeleteMarked(rSh, sBookmarkOddPage);

  if (pDlg.m_nPageNumberType !== rDesc.m_nNumType) rSh.ChgPageDesc(rDesc, (d) => { d.m_nNumType = pDlg.m_nPageNumberType; });

  // Insert header/footer
  if ((bHeader && !bHeaderAlreadyOn) || (!bHeader && !bFooterAlreadyOn)) {
    rSh.ChangeHeaderOrFooter(bHeader, true, false, rDesc.m_aName);

    // Init copied from ChangeHeaderOrFooter: keep in sync
    rSh.ChgPageDesc(rDesc, (d) => { if (bHeader) d.nHeaderSpacing = constTwips_5mm; else d.nFooterSpacing = constTwips_5mm; });

    if (pDlg.m_bFitIntoExistingMargins) {
      let nPageMargin = bHeader ? rDesc.nTop : rDesc.nBottom;

      // most printers can't print to paper edge - use arbitrary ~14pt as minimum
      if (nPageMargin > constTwips_5mm) {
        // reduce existing margin by the "Spacing"
        nPageMargin -= constTwips_5mm;

        // also reduce by the "Height" (as calculated from the font)
        let nFontHeight = constTwips_5mm; // appropriate for 12pt font
        if (rSh.SetCursorInHdFt(rDesc.m_aName, bHeader, false)) {
          const pStyleNode = rSh.m_pCursor.GetPoint().GetNode();
          const aMetric = rSh.GetTextMeasurer().GetFontMetric(fontAt(pStyleNode, 0));
          nFontHeight = Math.round(aMetric.ascent + aMetric.descent);
          // Spacing: above and below paragraph
          const rParaStyleUL = pStyleNode.GetTextColl().GetFormatAttrIfSet('RES_UL_SPACE');
          if (rParaStyleUL) nFontHeight += rParaStyleUL.upper + rParaStyleUL.lower;
        }
        nPageMargin -= nFontHeight;

        nPageMargin = Math.max(nPageMargin, constTwips_5mm);
        rSh.ChgPageDesc(rDesc, (d) => {
          if (bHeader) d.nTop = nPageMargin; else d.nBottom = nPageMargin;
          // force aggressively calculated font height as minimum to ensure
          // effective margin stays the same (instead of getting smaller);
          // frame size property includes both Spacing + Height
          if (bHeader) d.nHeaderMinHeight = constTwips_5mm + nFontHeight; else d.nFooterMinHeight = constTwips_5mm + nFontHeight;
          // in case the calculated font height isn't actually large enough,
          // eat into spacing first before pushing into the content area.
          if (bHeader) d.bHeaderEatSpacing = true; else d.bFooterEatSpacing = true;
        });
      }
    }
  }

  const bCreateMirror = !bIsSinglePage && GetMirrorOnEvenPages(pDlg) && nMirrorPagesNeeded <= rSh.GetPageCnt();
  // Use different left/right header/footer
  if (bCreateMirror) rSh.UnshareHeaderFooter(rDesc.m_aName, bHeader);

  // Go to the header or footer insert position
  let bSkipMirror = true;
  let nEvenPage = 0;
  // Where the cursor went: the first page's header or footer, or the master's (ODD pages).
  let bFirst = false;
  if (bCreateMirror) {
    let bInHF = rSh.SetCursorInHdFt(rDesc.m_aName, bHeader, /*Even=*/true);
    // Remember valid EVEN page. Mirror it if also a valid ODD or FIRST page
    if (bInHF) nEvenPage = rSh.GetVirtPageNum();
    bInHF = rSh.SetCursorInHdFt(rDesc.m_aName, bHeader, /*Even=*/false);
    // the user requested mirrored pages, and we have both ODD and EVEN,
    // so set page numbers on these two pages, and leave FIRST alone.
    if (bInHF && nEvenPage) bSkipMirror = false;
    if (!bInHF) {
      // no ODD page, look for FIRST page
      bInHF = rSh.SetCursorInHdFt(rDesc.m_aName, bHeader, false, /*First=*/true);
      bFirst = bInHF;
      if (bInHF && nEvenPage) bSkipMirror = false;
    }
  } else {
    rSh.SetCursorInHdFt(rDesc.m_aName, bHeader, false);
  }

  // Allow wizard to be re-run: delete previously wizard-inserted page number.
  // Now that the cursor may have moved to a different page, try delete again.
  sBookmarkOddPage = sBookmarkName + String(rSh.GetVirtPageNum());
  lcl_DeleteMarked(rSh, sBookmarkOddPage);

  const insertPageNumber = (nAlignment: number, sBookmark: string, bEven: boolean) => {
    // Insert new line if there is already text in header/footer
    const pTextNode = rSh.m_pCursor.GetPoint().GetNode();
    if (pTextNode.GetText()) {
      rDoc.SplitNode(rSh.m_pCursor);
      // Go back to start of header/footer
      rSh.SetCursorInHdFt(rDesc.m_aName, bHeader, bEven, !bEven && bFirst);
    }

    // Set alignment for the new line
    rSh.SetParaAttr({ RES_PARATR_ADJUST: ADJUST[nAlignment]! });

    const nStartContentIndex = rSh.m_pCursor.Start().GetContentIndex();

    // Insert page number
    rSh.InsertFormatField({ type: 'PageNumber' });
    if (pDlg.m_bIncludePageTotal || pDlg.m_bIncludePageRangeTotal) {
      rSh.Insert(' / ');
      const aPageTotalData: SwField = pDlg.m_bIncludePageTotal ? { type: 'PageCount' } : { type: 'DocStat', subType: SwDocStatSubType.PageRange };
      rSh.InsertFormatField(aPageTotalData);
    }

    // Mark inserted fields with a bookmark - so it can be found/removed if re-run
    const pEnd = rSh.m_pCursor.Start();
    const aNewBookmarkPaM = new SwPaM(new SwPosition(pEnd.GetNode(), pEnd.GetContentIndex()), new SwPosition(pEnd.GetNode(), nStartContentIndex));
    rDoc.recorded('bookmark', rSh.m_pCursor, aNewBookmarkPaM.Start().GetNodeIndex(), aNewBookmarkPaM.Start().GetNodeIndex() - 1, () => {
      rIDMA.makeMark(aNewBookmarkPaM, sBookmark, MarkType.BOOKMARK);
    });
    aNewBookmarkPaM.Release();
  };
  insertPageNumber(pDlg.m_aPageNumberAlignment, sBookmarkOddPage, false);

  // Mirror on the even pages
  if (!bSkipMirror && bCreateMirror && rSh.SetCursorInHdFt(rDesc.m_aName, bHeader, /*Even=*/true)) {
    const sBookmarkEvenPage = sBookmarkName + String(rSh.GetVirtPageNum());
    lcl_DeleteMarked(rSh, sBookmarkEvenPage);
    // mirror the adjustment
    insertPageNumber(!pDlg.m_aPageNumberAlignment ? 2 : 0, sBookmarkEvenPage, true);
  }

  rSh.EndUndo(nUndo);
  rDoc.SetModified();
}
