// SPDX-License-Identifier: MPL-2.0
// @upstream svx/source/dialog/svxruler.cxx reduced
// The application's ruler: shows the frame margins, the paragraph indents and the tab stops of the
// items the view puts (SwView::StateTabWin) and dispatches what is dragged on it. Left out: the
// column, table and object items (borders on the ruler), proportional dragging (Ctrl), the
// application's own null offset, the context menus and the LibreOfficeKit notifications.
// Instead of binding to the dispatcher's items, Update takes them all at once.
import {
  RULER_STYLE_DONTKNOW, RULER_STYLE_INVISIBLE, RULER_TAB_CENTER, RULER_TAB_DECIMAL, RULER_TAB_DEFAULT, RULER_TAB_LEFT, RULER_TAB_RIGHT,
  Ruler, RulerExtra, RulerIndentStyle, RulerMarginStyle, RulerType, WB_EXTRAFIELD, WB_HORZ, WB_VERT, type RulerIndent, type RulerTab,
} from '../../../svtools/source/control/ruler.ts';

const TAB_GAP = 1;
const INDENT_GAP = 2;
const INDENT_FIRST_LINE = 2;
const INDENT_LEFT_MARGIN = 3;
const INDENT_RIGHT_MARGIN = 4;
const INDENT_COUNT = 3; //without the first two old values
/** minimal frame width in pixels */
const glMinFrame = 5;

export const KEY_SHIFT = 0x1000, KEY_MOD1 = 0x2000, KEY_MOD2 = 0x4000;

const SvxRulerDragFlags = { NONE: 0x00, OBJECT: 0x01, OBJECT_SIZE_LINEAR: 0x02, OBJECT_SIZE_PROPORTIONAL: 0x04, OBJECT_ACTLINE_ONLY: 0x08, OBJECT_LEFT_INDENT_ONLY: 0x10 } as const;

export type SvxTabAdjust = 'left' | 'right' | 'center' | 'decimal';
export interface SvxTabStop { pos: number; adjust: SvxTabAdjust; fill: string; decimal: string }
export interface SvxLRSpaceItem { left: number; right: number; firstLine: number }

/** The items the ruler shows (positions in twips, relative to the page as the items are). */
export interface SvxRulerItems {
  /** SvxPagePosSizeItem: the page's document position and size. */
  aPagePos: { nPosX: number; nPosY: number; nWidth: number; nHeight: number } | null;
  /** SvxLongLRSpaceItem, or for the vertical ruler SvxLongULSpaceItem: the frame margins. */
  aLRSpace: { mlLeft: number; mlRight: number } | null;
  /** SvxProtectItem, reduced: whether the frame margins can be dragged. */
  bMarginsSizeable: boolean;
  aParaItem: SvxLRSpaceItem | null;
  aTabStopItem: SvxTabStop[] | null;
  nDefTabDist: number;
  bTextRTL: boolean;
}

/** What SvxRuler needs of the edit window: logic (twips) to pixel conversion and the drag line. */
export interface SvxRulerEditWin {
  /** LogicToPixel of a document position: the pixel position in the edit window. */
  LogicToPixelX(nVal: number): number;
  LogicToPixelY(nVal: number): number;
  /** The zoom: pixels per twip are zoom / 15. */
  GetZoom(): number;
  /** InvertTracking: shows the line at a document position (null hides it). */
  ShowTrackLine(nPos: number | null, bHorizontal: boolean): void;
}

/** The dispatcher: the requests SvxRuler executes (SID_ATTR_LONG_LRSPACE and so on). */
export type SvxRulerRequest =
  | { nSlot: 'SID_ATTR_LONG_LRSPACE' | 'SID_ATTR_LONG_ULSPACE'; item: { mlLeft: number; mlRight: number } }
  | { nSlot: 'SID_ATTR_PARA_LRSPACE'; item: SvxLRSpaceItem }
  | { nSlot: 'SID_ATTR_TABSTOP'; item: SvxTabStop[] };

/** ToSvTab_Impl: Internal conversion routine between SV-Tab.-Enum and Svx */
function ToSvTab_Impl(eAdj: SvxTabAdjust | 'default'): number {
  switch (eAdj) {
    case 'left': return RULER_TAB_LEFT;
    case 'right': return RULER_TAB_RIGHT;
    case 'decimal': return RULER_TAB_DECIMAL;
    case 'center': return RULER_TAB_CENTER;
    case 'default': return RULER_TAB_DEFAULT;
  }
}

function ToAttrTab_Impl(eAdj: number): SvxTabAdjust {
  switch (eAdj) {
    case RULER_TAB_LEFT: return 'left';
    case RULER_TAB_RIGHT: return 'right';
    case RULER_TAB_DECIMAL: return 'decimal';
    case RULER_TAB_CENTER: return 'center';
  }
  return 'left';
}

export class SvxRuler extends Ruler {
  private bHorz: boolean;
  private pEditWin: SvxRulerEditWin;
  private pDispatch: (r: SvxRulerRequest) => void;
  private mxPagePosItem: SvxRulerItems['aPagePos'] = null;
  private mxLRSpaceItem: { mlLeft: number; mlRight: number } | null = null;
  private mxParaItem: SvxLRSpaceItem | null = null;
  private mxTabStopItem: SvxTabStop[] | null = null;
  private bMarginsSizeable = true;
  private bTextRTL = false;
  private lLogicNullOffset = 0;
  private readonly lAppNullOffset = 0;
  private lDefTabDist = 50;
  private mpIndents: RulerIndent[] = [];
  private mpTabs: RulerTab[] = [];
  private nTabCount = 0;
  private nMaxLeft = 0;
  private nMaxRight = 0;
  private lMaxLeftLogic = -1;
  private lMaxRightLogic = -1;
  private nDefTabType = RULER_TAB_LEFT;
  private nDragType: number = SvxRulerDragFlags.NONE;
  private mbSnapping = true;
  private mbCoarseSnapping = false;
  private lInitialDragPos = 0;
  /** The drag line's position in the document, or -1. */
  private lTabPos = -1;
  private readonly bIsTabsRelativeToIndent = true;

  constructor(bHorz: boolean, pEditWin: SvxRulerEditWin, pDispatch: (r: SvxRulerRequest) => void) {
    super(bHorz ? WB_HORZ | WB_EXTRAFIELD : WB_VERT);
    this.bHorz = bHorz;
    this.pEditWin = pEditWin;
    this.pDispatch = pDispatch;
    const indent = (nStyle: RulerIndentStyle): RulerIndent => ({ nPos: 0, nStyle, bInvisible: false });
    this.mpIndents = [indent(RulerIndentStyle.Top), indent(RulerIndentStyle.Top), indent(RulerIndentStyle.Top), indent(RulerIndentStyle.Bottom), indent(RulerIndentStyle.Bottom)];
    if (bHorz) this.SetExtraType(RulerExtra.Tab, this.nDefTabType);
  }

  private ConvertHPosPixel(nVal: number): number { return Math.round((nVal * this.pEditWin.GetZoom()) / 15); }
  private ConvertSizePixel(nVal: number): number { return this.ConvertHPosPixel(nVal); }
  private ConvertPosPixel(nVal: number): number { return this.ConvertHPosPixel(nVal); }
  private ConvertHPosLogic(nVal: number): number { return Math.round((nVal * 15) / this.pEditWin.GetZoom()); }
  private ConvertPosLogic(nVal: number): number { return this.ConvertHPosLogic(nVal); }
  private ConvertSizeLogic(nVal: number): number { return this.ConvertHPosLogic(nVal); }
  private PixelAdjust(nVal: number, nValOld: number): number {
    return this.ConvertSizePixel(nVal) !== this.ConvertSizePixel(nValOld) ? nVal : nValOld;
  }

  /** The ruler unit's tick in twips (LogicToLogic from the ruler's map mode). */
  private TickLogic(aTick: number): number {
    return (aTick * this.GetCurrentRulerUnit().nMapUnit100thMM * 1440) / 2540;
  }

  private MakePositionSticky(aPosition: number, aPointOfReference: number, aSnapToFrameMargin = true): number {
    const aPointOfReferencePixel = this.ConvertHPosPixel(aPointOfReference);
    const aLeftFramePosition = this.ConvertHPosPixel(this.GetLeftFrameMargin());
    const aRightFramePosition = this.ConvertHPosPixel(this.GetRightFrameMargin());

    let aTick = this.GetCurrentRulerUnit().nTick1;
    if (this.mbCoarseSnapping) aTick = this.GetCurrentRulerUnit().nTick2;
    const aTickPixel = this.ConvertHPosPixel(this.TickLogic(aTick));
    const aHalfTickPixel = aTickPixel / 2.0;

    if (aSnapToFrameMargin) {
      if (aPosition > aLeftFramePosition - aHalfTickPixel && aPosition < aLeftFramePosition + aHalfTickPixel) return aLeftFramePosition;
      if (aPosition > aRightFramePosition - aHalfTickPixel && aPosition < aRightFramePosition + aHalfTickPixel) return aRightFramePosition;
    }
    if (!this.mbSnapping) return aPosition;

    // Move "coordinate system" to frame position so ticks are calculated correctly
    const aTranslatedPosition = aPosition - aPointOfReferencePixel;
    // Convert position to current selected map mode
    let aPositionLogic = this.ConvertHPosLogic(aTranslatedPosition);
    // Normalize -- snap to nearest tick
    const aTickLogic = this.TickLogic(aTick);
    aPositionLogic = Math.round(aPositionLogic / aTickLogic) * aTickLogic;
    // Convert back to pixels
    aPosition = this.ConvertHPosPixel(aPositionLogic);
    // Move "coordinate system" back to original position
    return aPosition + aPointOfReferencePixel;
  }

  private UpdateFrame(): void {
    const nMarginStyle = this.bMarginsSizeable ? RulerMarginStyle.Sizeable : RulerMarginStyle.NONE;
    if (this.mxLRSpaceItem && this.mxPagePosItem) {
      // if no initialization by default app behavior
      this.lLogicNullOffset = this.mxLRSpaceItem.mlLeft;
      super.SetNullOffset(this.ConvertHPosPixel(this.lLogicNullOffset));
      this.SetMargin1(0, nMarginStyle);
      const lRight = this.mxLRSpaceItem.mlRight;
      const aWidth = this.GetPageWidth() - lRight - this.lLogicNullOffset + this.lAppNullOffset;
      this.SetMargin2(this.ConvertHPosPixel(aWidth), nMarginStyle);
    } else {
      // turns off the view
      this.SetMargin1();
      this.SetMargin2();
    }
  }

  private UpdatePara(): void {
    // Dependence on PagePosItem
    if (this.mxParaItem && this.mxPagePosItem && this.bHorz) {
      const bRTLText = this.bTextRTL;
      // First-line indent is negative to the left paragraph margin
      const nLeftFrameMargin = this.GetLeftFrameMargin();
      const nRightFrameMargin = this.GetRightFrameMargin();
      this.SetLeftFrameMargin(this.ConvertHPosPixel(nLeftFrameMargin));
      this.SetRightFrameMargin(this.ConvertHPosPixel(nRightFrameMargin));

      let leftMargin: number, leftFirstLine: number, rightMargin: number;
      if (bRTLText) {
        leftMargin = nRightFrameMargin - this.mxParaItem.left + this.lAppNullOffset;
        leftFirstLine = leftMargin - this.mxParaItem.firstLine;
        rightMargin = nLeftFrameMargin + this.mxParaItem.right + this.lAppNullOffset;
      } else {
        leftMargin = nLeftFrameMargin + this.mxParaItem.left + this.lAppNullOffset;
        leftFirstLine = leftMargin + this.mxParaItem.firstLine;
        rightMargin = nRightFrameMargin - this.mxParaItem.right + this.lAppNullOffset;
      }
      this.mpIndents[INDENT_LEFT_MARGIN]!.nPos = this.ConvertHPosPixel(leftMargin);
      this.mpIndents[INDENT_FIRST_LINE]!.nPos = this.ConvertHPosPixel(leftFirstLine);
      this.mpIndents[INDENT_RIGHT_MARGIN]!.nPos = this.ConvertHPosPixel(rightMargin);
      this.SetIndents(this.mpIndents.slice(INDENT_GAP, INDENT_GAP + INDENT_COUNT));
    } else {
      for (const i of [INDENT_FIRST_LINE, INDENT_LEFT_MARGIN, INDENT_RIGHT_MARGIN]) this.mpIndents[i]!.nPos = 0;
      this.SetIndents(); // turn off
    }
  }

  private UpdatePage(): void {
    /* Update view of position and width of page */
    if (this.mxPagePosItem) {
      // all objects are automatically adjusted
      if (this.bHorz) this.SetPagePos(this.pEditWin.LogicToPixelX(this.mxPagePosItem.nPosX), this.ConvertHPosPixel(this.mxPagePosItem.nWidth));
      else this.SetPagePos(this.pEditWin.LogicToPixelY(this.mxPagePosItem.nPosY), this.ConvertHPosPixel(this.mxPagePosItem.nHeight));
    } else this.SetPagePos();
  }

  private UpdateTabs(): void {
    if (this.IsDrag()) return;
    if (this.mxPagePosItem && this.mxParaItem && this.mxTabStopItem && this.bHorz) {
      // buffer for DefaultTabStop
      // Distance last Tab <-> Right paragraph margin / DefaultTabDist
      const bRTL = this.bTextRTL;
      const nLeftFrameMargin = this.GetLeftFrameMargin();
      const nRightFrameMargin = this.GetRightFrameMargin();

      //#i24363# tab stops relative to indent
      const nParaItemTxtLeft = this.mxParaItem.left;
      const lParaIndent = nLeftFrameMargin + nParaItemTxtLeft;
      const lRightMargin = nRightFrameMargin - nParaItemTxtLeft;

      const lLastTab = this.mxTabStopItem.length ? this.ConvertHPosPixel(this.mxTabStopItem[this.mxTabStopItem.length - 1]!.pos) : 0;
      const lPosPixel = this.ConvertHPosPixel(lParaIndent) + lLastTab;
      const lRightIndent = this.ConvertHPosPixel(nRightFrameMargin - this.mxParaItem.right);

      const lCurrentDefTabDist = this.lDefTabDist;
      const nDefTabDist = this.ConvertHPosPixel(lCurrentDefTabDist);
      const nDefTabBuf = lPosPixel > lRightIndent || lLastTab > lRightIndent || nDefTabDist === 0 ? 0 : Math.trunc((lRightIndent - lPosPixel) / nDefTabDist);

      this.mpTabs = [{ nPos: 0, nStyle: 0 }];
      this.nTabCount = 0;
      const lParaIndentPix = this.ConvertSizePixel(lParaIndent);
      let lTabStartLogic = (this.bIsTabsRelativeToIndent ? lParaIndent : nLeftFrameMargin) + this.lAppNullOffset;
      if (bRTL) lTabStartLogic = lParaIndent + lRightMargin - lTabStartLogic;
      let lLastTabOffsetLogic = 0;
      for (const pTab of this.mxTabStopItem) {
        lLastTabOffsetLogic = pTab.pos;
        const lPos = lTabStartLogic + (bRTL ? -lLastTabOffsetLogic : lLastTabOffsetLogic);
        this.mpTabs[this.nTabCount + TAB_GAP] = { nPos: this.ConvertHPosPixel(lPos), nStyle: ToSvTab_Impl(pTab.adjust) };
        ++this.nTabCount;
      }

      // Adjust to previous-to-first default tab stop
      lLastTabOffsetLogic -= lLastTabOffsetLogic % lCurrentDefTabDist;

      // fill the rest with default Tabs
      for (let j = 0; j < nDefTabBuf; ++j) {
        //simply add the default distance to the last position
        lLastTabOffsetLogic += lCurrentDefTabDist;
        let nPos: number;
        if (bRTL) {
          nPos = this.ConvertHPosPixel(lTabStartLogic - lLastTabOffsetLogic);
          if (nPos <= lParaIndentPix) break;
        } else {
          nPos = this.ConvertHPosPixel(lTabStartLogic + lLastTabOffsetLogic);
          if (nPos >= lRightIndent) break;
        }
        this.mpTabs[this.nTabCount + TAB_GAP] = { nPos, nStyle: RULER_TAB_DEFAULT };
        ++this.nTabCount;
      }
      this.SetTabs(this.mpTabs.slice(TAB_GAP, TAB_GAP + this.nTabCount));
    } else this.SetTabs();
  }

  /** Update: Perform update of view with the view's items. */
  Update(items: SvxRulerItems): void {
    if (this.IsDrag()) return;
    this.mxPagePosItem = items.aPagePos;
    this.mxLRSpaceItem = items.aLRSpace;
    this.bMarginsSizeable = items.bMarginsSizeable;
    this.mxParaItem = items.aParaItem ? { ...items.aParaItem } : null;
    this.mxTabStopItem = items.aTabStopItem ? items.aTabStopItem.map((t) => ({ ...t })) : null;
    this.bTextRTL = items.bTextRTL;
    this.SetTextRTL(items.bTextRTL);
    this.lDefTabDist = items.nDefTabDist || 1;
    // The tab type field only where there are tab stops (StateTabWin's WB_EXTRAFIELD).
    if (this.bHorz) this.SetStyle(this.mxTabStopItem ? this.GetStyle() | WB_EXTRAFIELD : this.GetStyle() & ~WB_EXTRAFIELD);
    if (this.bHorz) this.SetExtraType(RulerExtra.Tab, this.nDefTabType);
    this.UpdatePage();
    this.UpdateFrame();
    this.UpdatePara();
    this.UpdateTabs();
  }

  private GetPageWidth(): number {
    if (!this.mxPagePosItem) return 0;
    return this.bHorz ? this.mxPagePosItem.nWidth : this.mxPagePosItem.nHeight;
  }

  private GetFrameLeft(): number {
    /* Get Left margin in Pixels */
    return super.GetNullOffset();
  }

  private GetFirstLineIndent(): number { return this.mxParaItem ? this.mpIndents[INDENT_FIRST_LINE]!.nPos : this.GetMargin1(); }
  private GetLeftIndent(): number { return this.mxParaItem ? this.mpIndents[INDENT_LEFT_MARGIN]!.nPos : this.GetMargin1(); }
  private GetRightIndent(): number { return this.mxParaItem ? this.mpIndents[INDENT_RIGHT_MARGIN]!.nPos : this.GetMargin2(); }
  private GetLogicRightIndent(): number { return this.mxParaItem ? this.GetRightFrameMargin() - this.mxParaItem.right : this.GetRightFrameMargin(); }

  // Left margin in App values, is either the margin (= 0) or the left edge of
  // the column that is set in the column attribute as current column.
  private GetLeftFrameMargin(): number { return 0; }

  private GetRightFrameMargin(): number {
    /* Get right frame margin (in logical units) */
    let lResult = this.lLogicNullOffset;
    if (this.mxLRSpaceItem) lResult += this.mxLRSpaceItem.mlRight;
    return this.GetPageWidth() - lResult;
  }

  private GetCorrectedDragPos(bLeft = true, bRight = true): number {
    /*
        Corrects the position within the calculated limits. The limit values are in
        pixels relative to the page edge.
    */
    const lNullPix = super.GetNullOffset();
    let lDragPos = this.GetDragPos() + lNullPix;
    if (bLeft && lDragPos < this.nMaxLeft) lDragPos = this.nMaxLeft;
    else if (bRight && lDragPos > this.nMaxRight) lDragPos = this.nMaxRight;
    return lDragPos - lNullPix;
  }

  private DragMargin1(): void {
    /* Dragging the left edge of frame */
    let aDragPosition = this.GetCorrectedDragPos(true);
    aDragPosition = this.MakePositionSticky(aDragPosition, this.GetRightFrameMargin(), false);
    // Check if position changed
    if (aDragPosition === 0) return;
    this.DrawLine_Impl(7);
    this.AdjustMargin1(aDragPosition);
  }

  /** AdjustMargin1, reduced to the case without columns and application null offset. */
  private AdjustMargin1(lInputDiff: number): void {
    const nOld = this.GetNullOffset();
    const lDragPos = lInputDiff;
    const nMarginStyle = this.bMarginsSizeable ? RulerMarginStyle.Sizeable : RulerMarginStyle.NONE;
    const lDiff = lDragPos;
    super.SetNullOffset(nOld + lDiff);
    this.SetMargin2(this.GetMargin2() - lDiff, nMarginStyle);
    if (this.mxParaItem) {
      // Right indent of the old position
      this.mpIndents[INDENT_RIGHT_MARGIN]!.nPos -= lDiff;
      this.SetIndents(this.mpIndents.slice(INDENT_GAP, INDENT_GAP + INDENT_COUNT));
    }
  }

  private DragMargin2(): void {
    /* Dragging the right edge of frame */
    let aDragPosition = this.GetCorrectedDragPos(true, true);
    aDragPosition = this.MakePositionSticky(aDragPosition, this.GetLeftFrameMargin(), false);
    const lDiff = aDragPosition - this.GetMargin2();
    // Check if position changed
    if (lDiff === 0) return;
    const nMarginStyle = this.bMarginsSizeable ? RulerMarginStyle.Sizeable : RulerMarginStyle.NONE;
    this.SetMargin2(aDragPosition, nMarginStyle);
    // Right indent of the old position
    if (this.mxParaItem) {
      this.mpIndents[INDENT_FIRST_LINE]!.nPos += lDiff;
      this.SetIndents(this.mpIndents.slice(INDENT_GAP, INDENT_GAP + INDENT_COUNT));
    }
    this.DrawLine_Impl(7);
  }

  private DragIndents(): void {
    /* Dragging the paragraph indents */
    let aDragPosition = this.GetCorrectedDragPos();
    const nIndex = this.GetDragAryPos() + INDENT_GAP;
    const bRTL = this.bTextRTL;
    if (nIndex === INDENT_RIGHT_MARGIN) aDragPosition = this.MakePositionSticky(aDragPosition, bRTL ? this.GetLeftFrameMargin() : this.GetRightFrameMargin());
    else aDragPosition = this.MakePositionSticky(aDragPosition, bRTL ? this.GetRightFrameMargin() : this.GetLeftFrameMargin());

    const lDiff = this.mpIndents[nIndex]!.nPos - aDragPosition;
    // Check if position changed
    if (lDiff === 0) return;
    if ((nIndex === INDENT_FIRST_LINE || nIndex === INDENT_LEFT_MARGIN) && !(this.nDragType & SvxRulerDragFlags.OBJECT_LEFT_INDENT_ONLY)) {
      this.mpIndents[INDENT_FIRST_LINE]!.nPos -= lDiff;
    }
    this.mpIndents[nIndex]!.nPos = aDragPosition;
    this.SetIndents(this.mpIndents.slice(INDENT_GAP, INDENT_GAP + INDENT_COUNT));
    this.DrawLine_Impl(1);
  }

  /** DrawLine_Impl: the ledger line in the edit window while dragging (bits: 1 show, 2 right, 4 left). */
  private DrawLine_Impl(nNew: number): void {
    if (nNew & 1) {
      let nDrapPosition = this.GetCorrectedDragPos((nNew & 4) !== 0, (nNew & 2) !== 0);
      nDrapPosition = this.MakePositionSticky(nDrapPosition, this.GetLeftFrameMargin());
      this.lTabPos = this.ConvertSizeLogic(nDrapPosition + this.GetNullOffset());
      if (this.mxPagePosItem) this.lTabPos += this.bHorz ? this.mxPagePosItem.nPosX : this.mxPagePosItem.nPosY;
      this.pEditWin.ShowTrackLine(this.lTabPos, this.bHorz);
    } else {
      this.lTabPos = -1;
      this.pEditWin.ShowTrackLine(null, this.bHorz);
    }
  }

  private DragTabs(): void {
    /* Dragging of Tabs */
    let aDragPosition = this.GetCorrectedDragPos(true, false);
    aDragPosition = this.MakePositionSticky(aDragPosition, this.GetLeftFrameMargin());

    const nIdx = this.GetDragAryPos() + TAB_GAP;
    const nDiff = aDragPosition - this.mpTabs[nIdx]!.nPos;
    if (nDiff === 0) return;
    this.DrawLine_Impl(7);

    if (this.nDragType & SvxRulerDragFlags.OBJECT_SIZE_LINEAR) {
      for (let i = nIdx; i < this.nTabCount + TAB_GAP; ++i) {
        this.mpTabs[i]!.nPos += nDiff;
        // limit on maximum
        if (this.mpTabs[i]!.nPos > this.GetMargin2()) this.mpTabs[nIdx]!.nStyle |= RULER_STYLE_INVISIBLE;
        else this.mpTabs[nIdx]!.nStyle &= ~RULER_STYLE_INVISIBLE;
      }
    } else this.mpTabs[nIdx]!.nPos = aDragPosition;

    if (this.IsDragDelete()) this.mpTabs[nIdx]!.nStyle |= RULER_STYLE_INVISIBLE;
    else this.mpTabs[nIdx]!.nStyle &= ~RULER_STYLE_INVISIBLE;
    this.SetTabs(this.mpTabs.slice(TAB_GAP, TAB_GAP + this.nTabCount));
  }

  private ApplyMargins(): void {
    /* Applying margins; changed by dragging. */
    if (!this.mxLRSpaceItem || !this.mxPagePosItem) return;
    const item = { ...this.mxLRSpaceItem };
    if (this.lMaxLeftLogic !== -1 && this.nMaxLeft === this.GetMargin1() + super.GetNullOffset()) {
      this.lLogicNullOffset = this.lMaxLeftLogic;
      item.mlLeft = this.lLogicNullOffset;
    } else {
      this.lLogicNullOffset = this.ConvertPosLogic(this.GetFrameLeft()) - this.lAppNullOffset;
      item.mlLeft = this.PixelAdjust(this.lLogicNullOffset, item.mlLeft);
    }
    let nRight: number;
    if (this.lMaxRightLogic !== -1 && this.nMaxRight === this.GetMargin2() + super.GetNullOffset()) {
      nRight = this.GetPageWidth() - this.lMaxRightLogic;
    } else {
      nRight = Math.max(0, this.GetPageWidth() - item.mlLeft - (this.ConvertPosLogic(this.GetMargin2()) - this.lAppNullOffset));
      nRight = this.PixelAdjust(nRight, item.mlRight);
    }
    item.mlRight = nRight;
    this.mxLRSpaceItem = item;
    this.pDispatch({ nSlot: this.bHorz ? 'SID_ATTR_LONG_LRSPACE' : 'SID_ATTR_LONG_ULSPACE', item });
    if (this.mxTabStopItem) this.UpdateTabs();
  }

  /** RoundToCurrentMapMode: to the ruler unit's smallest tick. */
  private RoundToCurrentMapMode(lValue: number): number {
    const aUnitData = this.GetCurrentRulerUnit();
    const aRoundingFactor = aUnitData.nTickUnit / aUnitData.nTick1;
    const lUnit = this.TickLogic(aUnitData.nTickUnit);
    return Math.round((Math.round((lValue / lUnit) * aRoundingFactor) / aRoundingFactor) * lUnit);
  }

  private ApplyIndents(): void {
    /* Applying paragraph settings; changed by dragging. */
    if (!this.mxParaItem) return;
    const nLeftFrameMargin = this.GetLeftFrameMargin();
    const bRTL = this.bTextRTL;
    const nFirstLine = this.ConvertPosLogic(this.mpIndents[INDENT_FIRST_LINE]!.nPos);
    const nLeftMargin = this.ConvertPosLogic(this.mpIndents[INDENT_LEFT_MARGIN]!.nPos);
    const nRightMargin = this.ConvertPosLogic(this.mpIndents[INDENT_RIGHT_MARGIN]!.nPos);

    let nNewTxtLeft: number, nNewFirstLineOffset: number, nNewRight: number;
    if (bRTL) {
      const nRightBorder = this.ConvertPosLogic(this.GetMargin2());
      nNewTxtLeft = nRightBorder - nLeftMargin - this.lAppNullOffset;
      nNewFirstLineOffset = nLeftMargin - nFirstLine - this.lAppNullOffset;
      const nLeftBorder = this.ConvertPosLogic(this.GetMargin1());
      nNewRight = nLeftBorder + nRightMargin - nLeftFrameMargin - this.lAppNullOffset;
    } else {
      const nLeftBorder = this.ConvertPosLogic(this.GetMargin1());
      nNewTxtLeft = nLeftBorder + nLeftMargin - nLeftFrameMargin - this.lAppNullOffset;
      nNewFirstLineOffset = nFirstLine - nLeftMargin - this.lAppNullOffset;
      const nRightBorder = this.ConvertPosLogic(this.GetMargin2());
      nNewRight = nRightBorder - nRightMargin - this.lAppNullOffset;
    }
    if (this.mbSnapping) {
      nNewTxtLeft = this.RoundToCurrentMapMode(nNewTxtLeft);
      nNewFirstLineOffset = this.RoundToCurrentMapMode(nNewFirstLineOffset);
      nNewRight = this.RoundToCurrentMapMode(nNewRight);
    }
    this.mxParaItem = { left: nNewTxtLeft, right: nNewRight, firstLine: nNewFirstLineOffset };
    this.pDispatch({ nSlot: 'SID_ATTR_PARA_LRSPACE', item: { ...this.mxParaItem } });
    this.UpdateTabs();
  }

  private ApplyTabs(): void {
    /* Apply tab settings, changed by dragging. */
    if (!this.mxTabStopItem) return;
    const bRTL = this.bTextRTL;
    const nCoreIdx = this.GetDragAryPos();
    if (this.IsDragDelete()) {
      this.mxTabStopItem.splice(nCoreIdx, 1);
    } else if (this.nDragType & SvxRulerDragFlags.OBJECT_SIZE_LINEAR) {
      const pItem: SvxTabStop[] = [];
      let j: number;
      for (j = 0; j < nCoreIdx; ++j) pItem.push(this.mxTabStopItem[j]!);
      for (; j < this.mxTabStopItem.length; ++j) {
        const aTabStop = { ...this.mxTabStopItem[j]! };
        aTabStop.pos = this.PixelAdjust(this.ConvertHPosLogic(this.mpTabs[j + TAB_GAP]!.nPos - this.GetLeftIndent()) - this.lAppNullOffset, aTabStop.pos);
        pItem.push(aTabStop);
      }
      this.mxTabStopItem = pItem;
    } else if (this.mxTabStopItem.length === 0) return;
    else {
      const aTabStop = { ...this.mxTabStopItem[nCoreIdx]! };
      if (this.lMaxRightLogic !== -1 && this.mpTabs[nCoreIdx + TAB_GAP]!.nPos + super.GetNullOffset() === this.nMaxRight) {
        // Set tab pos exactly at the right indent
        let nTmpLeftIndentLogic = this.lAppNullOffset + (bRTL ? this.GetRightFrameMargin() : this.GetLeftFrameMargin());
        if (this.bIsTabsRelativeToIndent && this.mxParaItem) nTmpLeftIndentLogic += bRTL ? this.mxParaItem.right : this.mxParaItem.left;
        aTabStop.pos = this.lMaxRightLogic - this.lLogicNullOffset - nTmpLeftIndentLogic;
      } else if (bRTL) {
        //#i24363# tab stops relative to indent
        const nTmpLeftIndent = this.bIsTabsRelativeToIndent ? this.GetLeftIndent() : this.ConvertHPosPixel(this.GetRightFrameMargin() + this.lAppNullOffset);
        const nNewPosition = this.ConvertHPosLogic(nTmpLeftIndent - this.mpTabs[nCoreIdx + TAB_GAP]!.nPos);
        aTabStop.pos = this.PixelAdjust(nNewPosition - this.lAppNullOffset, aTabStop.pos);
      } else {
        //#i24363# tab stops relative to indent
        const nTmpLeftIndent = this.bIsTabsRelativeToIndent ? this.GetLeftIndent() : this.ConvertHPosPixel(this.GetLeftFrameMargin() + this.lAppNullOffset);
        const nNewPosition = this.ConvertHPosLogic(this.mpTabs[nCoreIdx + TAB_GAP]!.nPos - nTmpLeftIndent);
        aTabStop.pos = this.PixelAdjust(nNewPosition - this.lAppNullOffset, aTabStop.pos);
      }
      this.mxTabStopItem.splice(nCoreIdx, 1);
      this.mxTabStopItem.push(aTabStop);
      this.mxTabStopItem.sort((a, b) => a.pos - b.pos);
    }
    this.pDispatch({ nSlot: 'SID_ATTR_TABSTOP', item: this.mxTabStopItem.map((t) => ({ ...t })) });
    this.UpdateTabs();
  }

  private EvalModifier(): void {
    /*
    Eval Drag Modifier
    Shift: move linear
    Control: move proportional (not ported)
    Alt: disable snapping
    Alt + Shift: coarse snapping
    */
    switch (this.GetDragModifier()) {
      case KEY_SHIFT: this.nDragType = SvxRulerDragFlags.OBJECT_SIZE_LINEAR; break;
      case KEY_MOD2 | KEY_SHIFT: this.mbCoarseSnapping = true; break;
      case KEY_MOD2: this.mbSnapping = false; break;
    }
  }

  override Click(): void {
    /* Override handler SV; sets Tab per dispatcher call */
    if (!this.mxTabStopItem || !this.bHorz) return;
    const bRTL = this.bTextRTL;
    const lPos = this.GetClickPos();
    if (!((bRTL && lPos < Math.min(this.GetFirstLineIndent(), this.GetLeftIndent()) && lPos > this.GetRightIndent()) ||
      (!bRTL && lPos > Math.min(this.GetFirstLineIndent(), this.GetLeftIndent()) && lPos < this.GetRightIndent()))) return;

    //convert position in left-to-right text
    //#i24363# tab stops relative to indent
    const nTabPos = bRTL
      ? (this.bIsTabsRelativeToIndent ? this.GetLeftIndent() : this.ConvertHPosPixel(this.GetRightFrameMargin() + this.lAppNullOffset)) - lPos
      : lPos - (this.bIsTabsRelativeToIndent ? this.GetLeftIndent() : this.ConvertHPosPixel(this.GetLeftFrameMargin() + this.lAppNullOffset));

    const aTabStop: SvxTabStop = { pos: this.ConvertHPosLogic(nTabPos), adjust: ToAttrTab_Impl(this.nDefTabType), fill: ' ', decimal: '.' };
    this.mxTabStopItem.push(aTabStop);
    this.mxTabStopItem.sort((a, b) => a.pos - b.pos);
    // Upstream keeps the tab in the ruler's item until the drag that follows ends; here the click
    // applies it at once.
    this.pDispatch({ nSlot: 'SID_ATTR_TABSTOP', item: this.mxTabStopItem.map((t) => ({ ...t })) });
    this.UpdateTabs();
  }

  private CalcMinMax(): void {
    /*
       Calculates the limits for dragging; which are in pixels relative to the
       page edge
    */
    const bRTL = this.bTextRTL;
    const lNullPix = this.ConvertPosPixel(this.lLogicNullOffset);
    this.lMaxLeftLogic = this.lMaxRightLogic = -1;
    switch (this.GetDragType()) {
      case RulerType.Margin1: {
        // left edge of the surrounding Frame
        // DragPos - NOf between left - right
        this.lMaxLeftLogic = 0;
        this.nMaxLeft = this.ConvertSizePixel(this.lMaxLeftLogic);
        if (bRTL) this.nMaxRight = lNullPix - this.GetRightIndent() + Math.max(this.GetFirstLineIndent(), this.GetLeftIndent()) - glMinFrame;
        else this.nMaxRight = lNullPix + this.GetRightIndent() - Math.max(this.GetFirstLineIndent(), this.GetLeftIndent()) - glMinFrame;
        break;
      }
      case RulerType.Margin2: {
        // right edge of the surrounding Frame
        this.lMaxRightLogic = this.GetPageWidth();
        this.nMaxRight = this.ConvertSizePixel(this.lMaxRightLogic);
        if (bRTL) this.nMaxLeft = this.GetMargin2() + this.GetRightIndent() - Math.max(this.GetFirstLineIndent(), this.GetLeftIndent()) - this.GetMargin1() + glMinFrame + lNullPix;
        else this.nMaxLeft = this.GetMargin2() - this.GetRightIndent() + Math.max(this.GetFirstLineIndent(), this.GetLeftIndent()) - this.GetMargin1() + glMinFrame + lNullPix;
        break;
      }
      case RulerType.Indent: {
        const nIdx = this.GetDragAryPos();
        switch (nIdx) {
          case INDENT_FIRST_LINE - INDENT_GAP:
          case INDENT_LEFT_MARGIN - INDENT_GAP: {
            if (bRTL) {
              this.nMaxLeft = lNullPix + this.GetRightIndent();
              this.nMaxRight = lNullPix + this.GetMargin2();
              // Dragging along
              if (INDENT_FIRST_LINE - INDENT_GAP !== nIdx && !(this.nDragType & SvxRulerDragFlags.OBJECT_LEFT_INDENT_ONLY)) {
                if (this.GetLeftIndent() > this.GetFirstLineIndent()) this.nMaxLeft += this.GetLeftIndent() - this.GetFirstLineIndent();
                else this.nMaxRight -= this.GetFirstLineIndent() - this.GetLeftIndent();
              }
            } else {
              this.nMaxLeft = lNullPix;
              this.nMaxRight = lNullPix + this.GetRightIndent() - glMinFrame;
              // Dragging along
              if (INDENT_FIRST_LINE - INDENT_GAP !== nIdx && !(this.nDragType & SvxRulerDragFlags.OBJECT_LEFT_INDENT_ONLY)) {
                if (this.GetLeftIndent() > this.GetFirstLineIndent()) this.nMaxLeft += this.GetLeftIndent() - this.GetFirstLineIndent();
                else this.nMaxRight -= this.GetFirstLineIndent() - this.GetLeftIndent();
              }
            }
            break;
          }
          case INDENT_RIGHT_MARGIN - INDENT_GAP: {
            if (bRTL) {
              this.nMaxLeft = lNullPix;
              this.nMaxRight = lNullPix + Math.min(this.GetFirstLineIndent(), this.GetLeftIndent()) - glMinFrame;
              this.nMaxLeft += this.GetMargin1();
              this.nMaxLeft += glMinFrame;
            } else {
              this.nMaxLeft = lNullPix + Math.max(this.GetFirstLineIndent(), this.GetLeftIndent());
              this.nMaxRight = lNullPix;
              this.nMaxRight += this.GetMargin2();
              this.nMaxLeft += glMinFrame;
            }
            break;
          }
        }
        break;
      }
      case RulerType.Tab: // Tabs (Modifier)
        /* left = NOf + Max(LAR, EZ)
           right = NOf + RAR */
        if (bRTL) this.nMaxLeft = lNullPix + this.GetRightIndent();
        else this.nMaxLeft = lNullPix + Math.min(this.GetFirstLineIndent(), this.GetLeftIndent());
        this.lMaxRightLogic = this.GetLogicRightIndent() + this.lLogicNullOffset;
        this.nMaxRight = this.ConvertSizePixel(this.lMaxRightLogic);
        break;
      default:
    }
  }

  override StartDrag(): boolean {
    /*
       Beginning of a drag operation (SV-handler) evaluates modifier and
       calculated values
    */
    let bOk = true;
    this.lInitialDragPos = this.GetDragPos();
    switch (this.GetDragType()) {
      case RulerType.Margin1: // left edge of the surrounding Frame
      case RulerType.Margin2: // right edge of the surrounding Frame
        if (this.mxLRSpaceItem && this.bMarginsSizeable) this.EvalModifier();
        else bOk = false;
        break;
      case RulerType.Indent: {
        // Paragraph indents (Modifier)
        if (INDENT_LEFT_MARGIN === this.GetDragAryPos() + INDENT_GAP) {
          // Left paragraph indent
          this.mpIndents[0] = { ...this.mpIndents[INDENT_FIRST_LINE]! };
          this.EvalModifier();
        } else this.nDragType = SvxRulerDragFlags.OBJECT;
        this.mpIndents[1] = { ...this.mpIndents[this.GetDragAryPos() + INDENT_GAP]! };
        break;
      }
      case RulerType.Tab: // Tabs (Modifier)
        this.EvalModifier();
        this.mpTabs[0] = { ...this.mpTabs[this.GetDragAryPos() + 1]! };
        this.mpTabs[0].nStyle |= RULER_STYLE_DONTKNOW;
        break;
      default:
        this.nDragType = SvxRulerDragFlags.NONE;
        bOk = false;
    }
    if (bOk) this.CalcMinMax();
    return bOk;
  }

  override Drag(): void {
    /* SV-Draghandler */
    if (this.IsDragCanceled()) return;
    switch (this.GetDragType()) {
      case RulerType.Margin1: this.DragMargin1(); break; // left edge of the surrounding Frame
      case RulerType.Margin2: this.DragMargin2(); break; // right edge of the surrounding Frame
      case RulerType.Indent: this.DragIndents(); break; // Paragraph indents
      case RulerType.Tab: this.DragTabs(); break; // Tabs
      default:
    }
  }

  override EndDrag(): void {
    /*
       SV-handler; is called when ending the dragging. Triggers the updating of data
       on the application, by calling the respective Apply...() methods to send the
       data to the application.
    */
    const bUndo = this.IsDragCanceled();
    const lPos = this.GetDragPos();
    this.DrawLine_Impl(6);
    this.lTabPos = -1;
    if (!bUndo) {
      switch (this.GetDragType()) {
        case RulerType.Margin1: // upper left edge of the surrounding Frame
        case RulerType.Margin2: // lower right edge of the surrounding Frame
          this.ApplyMargins();
          break;
        case RulerType.Indent: // Paragraph indents
          if (this.lInitialDragPos !== lPos) this.ApplyIndents();
          this.SetIndents(this.mpIndents.slice(INDENT_GAP, INDENT_GAP + INDENT_COUNT));
          break;
        case RulerType.Tab: // Tabs
          this.ApplyTabs();
          this.mpTabs[this.GetDragAryPos()]!.nStyle &= ~RULER_STYLE_INVISIBLE;
          this.SetTabs(this.mpTabs.slice(TAB_GAP, TAB_GAP + this.nTabCount));
          break;
        default:
      }
    }
    this.nDragType = SvxRulerDragFlags.NONE;
    this.mbCoarseSnapping = false;
    this.mbSnapping = true;
  }

  override ExtraDown(): void {
    /* Override SV method, sets the new type for the Default tab. */
    // Switch Tab Type
    if (this.mxTabStopItem && this.bHorz) {
      ++this.nDefTabType;
      if (RULER_TAB_DEFAULT === this.nDefTabType) this.nDefTabType = RULER_TAB_LEFT;
      this.SetExtraType(RulerExtra.Tab, this.nDefTabType);
    }
  }

  /** The tab type a click sets (nDefTabType), for the extra field's tooltip. */
  GetDefTabType(): number { return this.nDefTabType; }
}
