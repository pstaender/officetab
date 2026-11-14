// SPDX-License-Identifier: MPL-2.0
// @upstream svtools/source/control/ruler.cxx reduced
// @upstream include/svtools/ruler.hxx partial
// The ruler paints into its RenderContext through an offset one standing for the VirtualDevice
// (upstream formats into a VirtualDevice and copies it at that offset), in pixels; text is centred on its position by the
// context (upstream measures the glyphs' bound rectangle). Left out: lines (SetLines), the
// character and line units, the accessibility object, the borders' variable and sizeable
// decorations and right-to-left text in the vertical ruler.

export const WB_HORZ = 0x1, WB_VERT = 0x2, WB_EXTRAFIELD = 0x4, WB_BORDER = 0x8, WB_RIGHT_ALIGNED = 0x10;

const RULER_OFF = 3;
const RULER_MIN_SIZE = 3;
const RULER_CLIP = 150;

export const RULER_UNIT_MM = 0, RULER_UNIT_CM = 1, RULER_UNIT_INCH = 4, RULER_UNIT_POINT = 7, RULER_UNIT_PICA = 8;

/** RulerUnitData: the map unit's size in 1/100 mm, the tick distances in it, and the unit's text. */
export interface RulerUnitData { nMapUnit100thMM: number; nTickUnit: number; nTick1: number; nTick2: number; nTick3: number; nTick4: number; aUnitStr: string }

const aImplRulerUnitTab: Record<number, RulerUnitData> = {
  [RULER_UNIT_MM]: { nMapUnit100thMM: 1, nTickUnit: 100, nTick1: 25.0, nTick2: 25.0, nTick3: 50.0, nTick4: 100.0, aUnitStr: ' mm' },
  [RULER_UNIT_CM]: { nMapUnit100thMM: 1, nTickUnit: 1000, nTick1: 100.0, nTick2: 500.0, nTick3: 1000.0, nTick4: 1000.0, aUnitStr: ' cm' },
  // MapUnit::Map1000thInch
  [RULER_UNIT_INCH]: { nMapUnit100thMM: 2.54, nTickUnit: 1000, nTick1: 62.5, nTick2: 125.0, nTick3: 500.0, nTick4: 1000.0, aUnitStr: '"' },
  // MapUnit::MapPoint
  [RULER_UNIT_POINT]: { nMapUnit100thMM: 2540 / 72, nTickUnit: 1, nTick1: 12.0, nTick2: 12.0, nTick3: 12.0, nTick4: 36.0, aUnitStr: ' pt' },
  [RULER_UNIT_PICA]: { nMapUnit100thMM: 1, nTickUnit: 423, nTick1: 423.0, nTick2: 423.0, nTick3: 423.0, nTick4: 846.0, aUnitStr: ' pc' },
};

/** RulerTabData at a DPI scale factor of 1. */
const ruler_tab = {
  width: 7, height: 6, height2: 2, width2: 2, cwidth: 8, cwidth2: 4, cwidth3: 4, cwidth4: 2,
  dheight: 4, dheight2: 1, dwidth: 5, dwidth2: 3, dwidth3: 3, dwidth4: 1, textoff: 5,
};

export const RulerType = { DontKnow: 0, Outside: 1, Margin1: 2, Margin2: 3, Border: 4, Indent: 5, Tab: 6, TabAlign: 7 } as const;
export type RulerType = (typeof RulerType)[keyof typeof RulerType];
export const RulerExtra = { DontKnow: 0, NullOffset: 1, Tab: 2 } as const;
export type RulerExtra = (typeof RulerExtra)[keyof typeof RulerExtra];

export const RULER_STYLE_HIGHLIGHT = 0x8000;
export const RULER_STYLE_DONTKNOW = 0x4000;
export const RULER_STYLE_INVISIBLE = 0x2000;

export const RulerDragSize = { Move: 0, N1: 1, N2: 2 } as const;
export type RulerDragSize = (typeof RulerDragSize)[keyof typeof RulerDragSize];

export const RULER_MOUSE_BORDERMOVE = 5;
export const RULER_MOUSE_BORDERWIDTH = 5;
export const RULER_MOUSE_MARGINWIDTH = 3;

export const RulerMarginStyle = { NONE: 0x0000, Sizeable: 0x0001, Invisible: 0x0002 } as const;
export const RulerBorderStyle = { Sizeable: 0x0001, Moveable: 0x0002, Variable: 0x0004, Invisible: 0x0008 } as const;

export interface RulerBorder { nPos: number; nWidth: number; nStyle: number; nMinPos: number; nMaxPos: number }

export const RulerIndentStyle = { Top: 0, Bottom: 1 } as const;
export type RulerIndentStyle = (typeof RulerIndentStyle)[keyof typeof RulerIndentStyle];
export interface RulerIndent { nPos: number; nStyle: RulerIndentStyle; bInvisible: boolean }

export const RULER_TAB_LEFT = 0x0000;
export const RULER_TAB_RIGHT = 0x0001;
export const RULER_TAB_CENTER = 0x0002;
export const RULER_TAB_DECIMAL = 0x0003;
export const RULER_TAB_DEFAULT = 0x0004;
export const RULER_TAB_STYLE = 0x000f;
export const RULER_TAB_RTL = 0x0010;

export interface RulerTab { nPos: number; nStyle: number }

/** RulerSelection: the result of a hit test. */
export interface RulerSelection { nPos: number; eType: RulerType; nAryPos: number; mnDragSize: RulerDragSize; bSize: boolean; bSizeBar: boolean; bExpandTest: boolean }
const newSelection = (): RulerSelection => ({ nPos: 0, eType: RulerType.DontKnow, nAryPos: 0, mnDragSize: RulerDragSize.Move, bSize: false, bSizeBar: false, bExpandTest: false });

/** The StyleSettings colours the ruler paints with (and ColorConfig's APPBACKGROUND). */
export interface RulerColors { shadow: string; darkShadow: string; light: string; face: string; window: string; dialog: string; workspace: string; appBackground: string; checked: string }

/**
 * The parts of vcl::RenderContext the ruler paints with, in window pixels. Rectangles and lines
 * include both end points, as tools::Rectangle does; null colours draw nothing.
 */
export interface RenderContext {
  SetLineColor(c: string | null): void;
  SetFillColor(c: string | null): void;
  DrawLine(x1: number, y1: number, x2: number, y2: number): void;
  DrawRect(x1: number, y1: number, x2: number, y2: number): void;
  DrawPolygon(pts: [number, number][]): void;
  /** Text centred on a point; `vertical` turns it a quarter counter-clockwise (orientation 900). */
  DrawTextCentered(x: number, y: number, s: string, vertical: boolean): void;
  GetTextWidth(s: string): number;
  /** The height of the ruler font's digits (GetTextBoundRect of "0123456789"). */
  GetTextHeight(): number;
}

/** The VirtualDevice copied at an offset (ImplDraw's DrawOutDev): a context translated by (dx, dy). */
function Translated(r: RenderContext, dx: number, dy: number): RenderContext {
  return {
    SetLineColor: (c) => r.SetLineColor(c),
    SetFillColor: (c) => r.SetFillColor(c),
    DrawLine: (x1, y1, x2, y2) => r.DrawLine(x1 + dx, y1 + dy, x2 + dx, y2 + dy),
    DrawRect: (x1, y1, x2, y2) => r.DrawRect(x1 + dx, y1 + dy, x2 + dx, y2 + dy),
    DrawPolygon: (pts) => r.DrawPolygon(pts.map(([x, y]) => [x + dx, y + dy])),
    DrawTextCentered: (x, y, s, v) => r.DrawTextCentered(x + dx, y + dy, s, v),
    GetTextWidth: (s) => r.GetTextWidth(s),
    GetTextHeight: () => r.GetTextHeight(),
  };
}

/** ImplRulerData */
class ImplRulerData {
  pBorders: RulerBorder[] = [];
  pIndents: RulerIndent[] = [];
  pTabs: RulerTab[] = [];
  nNullVirOff = 0;
  nRulVirOff = 0;
  nRulWidth = 0;
  nPageOff = 0;
  nPageWidth = 0;
  nNullOff = 0;
  nMargin1 = 0;
  nMargin2 = 0;
  // In this context, "frame margin" means paragraph margins (indents)
  nLeftFrameMargin = 0;
  nRightFrameMargin = 0;
  nMargin1Style: number = RulerMarginStyle.NONE;
  nMargin2Style: number = RulerMarginStyle.NONE;
  bAutoPageWidth = true; // Page width == EditWin width
  bTextRTL = false;

  clone(): ImplRulerData {
    const d = Object.assign(new ImplRulerData(), this);
    d.pBorders = this.pBorders.map((b) => ({ ...b }));
    d.pIndents = this.pIndents.map((i) => ({ ...i }));
    d.pTabs = this.pTabs.map((t) => ({ ...t }));
    return d;
  }
}

/** ImplCenterTabPos */
function ImplCenterTabPos(rPos: [number, number], nTabStyle: number): void {
  const bRTL = 0 !== (nTabStyle & RULER_TAB_RTL);
  nTabStyle &= RULER_TAB_STYLE;
  rPos[1] += ruler_tab.height / 2;
  if ((!bRTL && nTabStyle === RULER_TAB_LEFT) || (bRTL && nTabStyle === RULER_TAB_RIGHT)) rPos[0] -= ruler_tab.width / 2;
  else if ((!bRTL && nTabStyle === RULER_TAB_RIGHT) || (bRTL && nTabStyle === RULER_TAB_LEFT)) rPos[0] += ruler_tab.width / 2;
}

type Rect = [number, number, number, number] | null;

/** lcl_RotateRect_Impl */
function lcl_RotateRect_Impl(rRect: Rect, nReference: number, bRightAligned: boolean): Rect {
  if (!rRect) return rRect;
  const [l, t, r, b] = rRect;
  let out: [number, number, number, number] = [t, l, b, r];
  if (bRightAligned) {
    const nRef = 2 * nReference;
    out = [nRef - out[0], out[1], nRef - out[2], out[3]];
  }
  return out;
}

/** ImplDrawRulerTab */
function ImplDrawRulerTab(rRenderContext: RenderContext, rPos: [number, number], nStyle: number, nWinBits: number): void {
  if (nStyle & RULER_STYLE_INVISIBLE) return;
  const nTabStyle = nStyle & RULER_TAB_STYLE;
  const bRTL = 0 !== (nStyle & RULER_TAB_RTL);
  const DPIOffset = 0;
  const [x, y] = rPos;
  let aRect1: Rect; // A horizontal short line
  let aRect2: Rect; // A vertical short line
  let aRect3: Rect = null; // A small square
  if (nTabStyle === RULER_TAB_DEFAULT) {
    aRect1 = [x - ruler_tab.dwidth2 + 1, y - ruler_tab.dheight2 + 1, x - ruler_tab.dwidth2 + ruler_tab.dwidth + DPIOffset, y];
    aRect2 = [x - ruler_tab.dwidth2 + ruler_tab.dwidth3, y - ruler_tab.dheight + 1, x - ruler_tab.dwidth2 + ruler_tab.dwidth3 + ruler_tab.dwidth4 - 1, y];
  } else if ((!bRTL && nTabStyle === RULER_TAB_LEFT) || (bRTL && nTabStyle === RULER_TAB_RIGHT)) {
    aRect1 = [x, y - ruler_tab.height2 + 1, x + ruler_tab.width - 1, y];
    aRect2 = [x, y - ruler_tab.height + 1, x + ruler_tab.width2 - 1, y];
  } else if ((!bRTL && nTabStyle === RULER_TAB_RIGHT) || (bRTL && nTabStyle === RULER_TAB_LEFT)) {
    aRect1 = [x - ruler_tab.width + 1, y - ruler_tab.height2 + 1, x, y];
    aRect2 = [x - ruler_tab.width2 + 1, y - ruler_tab.height + 1, x, y];
  } else {
    aRect1 = [x - ruler_tab.cwidth2 + 1, y - ruler_tab.height2 + 1, x - ruler_tab.cwidth2 + ruler_tab.cwidth + DPIOffset, y];
    aRect2 = [x - ruler_tab.cwidth2 + ruler_tab.cwidth3, y - ruler_tab.height + 1, x - ruler_tab.cwidth2 + ruler_tab.cwidth3 + ruler_tab.cwidth4 - 1, y];
    if (nTabStyle === RULER_TAB_DECIMAL) {
      aRect3 = [x - ruler_tab.cwidth2 + ruler_tab.cwidth - 1, y - ruler_tab.height + 1 + 1 - DPIOffset, x - ruler_tab.cwidth2 + ruler_tab.cwidth + DPIOffset, y - ruler_tab.height + 1 + 2];
    }
  }
  if (0 === (nWinBits & WB_HORZ)) {
    const bRightAligned = 0 !== (nWinBits & WB_RIGHT_ALIGNED);
    aRect1 = lcl_RotateRect_Impl(aRect1, y, bRightAligned);
    aRect2 = lcl_RotateRect_Impl(aRect2, y, bRightAligned);
    aRect3 = lcl_RotateRect_Impl(aRect3, y, bRightAligned);
  }
  for (const r of [aRect1, aRect2, aRect3]) if (r) rRenderContext.DrawRect(r[0], r[1], r[2], r[3]);
}

export class Ruler {
  protected mnWinStyle: number;
  private mnBorderWidth: number;
  /** EditWinOffset */
  private mnWinOff = 0;
  /** EditWinWidth */
  private mnWinWidth = 0;
  /** Window width and height */
  private mnWidth = 0;
  private mnHeight = 0;
  /** Offset of VirtualDevice from top-left corner */
  private mnVirOff = 0;
  /** width or height from VirtualDevice */
  private mnVirWidth = 0;
  /** height of width from VirtualDevice */
  protected mnVirHeight = 0;
  /** Drag-Position (Null point) */
  private mnDragPos = 0;
  /** Drag-Array-Index */
  private mnDragAryPos = 0;
  /** Did size change at dragging */
  private mnDragSize: RulerDragSize = RulerDragSize.Move;
  /** Modifier key at dragging */
  private mnDragModifier = 0;
  /** Style of Extra field */
  private mnExtraStyle = 0;
  private mnStartDragPos = 0;
  private mbCalc = true;
  private mbFormat = true;
  private mbDrag = false;
  private mbDragDelete = false;
  private mbDragCanceled = false;
  private mbAutoWinWidth = true;
  private mbActive = true;
  private mpSaveData = new ImplRulerData();
  protected mpData: ImplRulerData;
  private mpDragData = new ImplRulerData();
  private meExtraType: RulerExtra = RulerExtra.DontKnow;
  private meDragType: RulerType = RulerType.DontKnow;
  private mnUnitIndex = RULER_UNIT_CM;
  /** maMapMode's scale: the zoom. */
  private maZoom = 1;
  /** Pixels per 1/100 mm at a zoom of 1 (96 dpi). */
  private static readonly PIXEL_PER_100THMM = 96 / 2540;
  private maExtraRect: [number, number, number, number] | null = null;
  private mxCurrentHitTest: RulerSelection | null = null;
  private mxPreviousHitTest: RulerSelection | null = null;

  constructor(nWinStyle: number) {
    // Set default WinBits
    if (!(nWinStyle & WB_VERT)) nWinStyle |= WB_HORZ;
    this.mnWinStyle = nWinStyle;
    this.mnBorderWidth = nWinStyle & WB_BORDER ? 1 : 0;
    this.mpData = this.mpSaveData;
  }

  /** ImplInit's default size: the height of a horizontal ruler (width of a vertical one). */
  static GetDefaultSize(rRenderContext: RenderContext, nWinStyle: number): number {
    return Math.ceil(rRenderContext.GetTextHeight()) + RULER_OFF * 2 + ruler_tab.textoff * 2 + (nWinStyle & WB_BORDER ? 1 : 0);
  }

  /** LogicToPixel in the ruler's map mode (the unit's map unit at the zoom). */
  private LogicToPixel(n: number): number {
    return Math.round(n * aImplRulerUnitTab[this.mnUnitIndex]!.nMapUnit100thMM * Ruler.PIXEL_PER_100THMM * this.maZoom);
  }
  /** PixelToLogic in the ruler's map mode. */
  private PixelToLogic(n: number): number {
    return n / (aImplRulerUnitTab[this.mnUnitIndex]!.nMapUnit100thMM * Ruler.PIXEL_PER_100THMM * this.maZoom);
  }

  private ImplVDrawLine(rRenderContext: RenderContext, nX1: number, nY1: number, nX2: number, nY2: number): void {
    if (nX1 < -RULER_CLIP) {
      nX1 = -RULER_CLIP;
      if (nX2 < -RULER_CLIP) return;
    }
    const nClip = this.mnVirWidth + RULER_CLIP;
    if (nX2 > nClip) {
      nX2 = nClip;
      if (nX1 > nClip) return;
    }
    if (this.mnWinStyle & WB_HORZ) rRenderContext.DrawLine(nX1, nY1, nX2, nY2);
    else rRenderContext.DrawLine(nY1, nX1, nY2, nX2);
  }

  private ImplVDrawRect(rRenderContext: RenderContext, nX1: number, nY1: number, nX2: number, nY2: number): void {
    if (nX1 < -RULER_CLIP) {
      nX1 = -RULER_CLIP;
      if (nX2 < -RULER_CLIP) return;
    }
    const nClip = this.mnVirWidth + RULER_CLIP;
    if (nX2 > nClip) {
      nX2 = nClip;
      if (nX1 > nClip) return;
    }
    if (this.mnWinStyle & WB_HORZ) rRenderContext.DrawRect(nX1, nY1, nX2, nY2);
    else rRenderContext.DrawRect(nY1, nX1, nY2, nX2);
  }

  private ImplVDrawText(rRenderContext: RenderContext, nX: number, nY: number, rText: string, nMin = -Infinity, nMax = Infinity): void {
    const nShiftX = rRenderContext.GetTextWidth(rText) / 2;
    if (nX > -RULER_CLIP && nX < this.mnVirWidth + RULER_CLIP && nX < nMax - nShiftX && nX > nMin + nShiftX) {
      if (this.mnWinStyle & WB_HORZ) rRenderContext.DrawTextCentered(nX, nY, rText, false);
      else rRenderContext.DrawTextCentered(nY, nX, rText, true);
    }
  }

  private ImplDrawTicks(rRenderContext: RenderContext, c: RulerColors, nMin: number, nMax: number, nStart: number, nTop: number, nBottom: number): void {
    const nCenter = nTop + (nBottom - nTop) / 2;
    const nTickLength3 = Math.trunc((nBottom - nTop) * 0.5);
    const nTickLength2 = Math.trunc(nTickLength3 * 0.66);
    const nTickLength1 = Math.trunc(nTickLength2 * 0.66);
    const nScale = 1;
    const DPIOffset = nScale - 1;

    const unit = aImplRulerUnitTab[this.mnUnitIndex]!;
    let nTick4 = unit.nTick4;
    const nTick3 = unit.nTick3;
    const nTick2 = unit.nTick2;
    let nTickCount = unit.nTick1 / nScale;
    let bNoTicks = false;

    let nTickWidth = this.LogicToPixel(nTick4);

    let nMaxWidth = Math.abs(this.PixelToLogic(this.mpData.nPageWidth));
    nMaxWidth = Math.trunc(nMaxWidth / unit.nTickUnit);
    let aNumString = String(nMaxWidth);
    const nTxtWidth = rRenderContext.GetTextWidth(aNumString);
    const nTextOff = 4;

    // Determine the number divider for ruler drawn numbers - means which numbers
    // should be shown on the ruler and which should be skipped because the ruler
    // is not big enough to draw them
    if (nTickWidth < nTxtWidth + nTextOff) {
      // Calculate the scale of the ruler
      let nMulti = 1;
      const nOrgTick4 = nTick4;
      while (nTickWidth < nTxtWidth + nTextOff) {
        const nOldMulti = nMulti;
        if (nTickWidth === 0) nMulti *= 10;
        else if (nMulti < 10) nMulti++;
        else if (nMulti < 100) nMulti += 10;
        else if (nMulti < 1000) nMulti += 100;
        else nMulti += 1000;
        // Overflow - in this case don't draw ticks and exit
        if (nMulti < nOldMulti || nMulti > 1e7) { bNoTicks = true; break; }
        nTick4 = nOrgTick4 * nMulti;
        nTickWidth = this.LogicToPixel(nTick4);
      }
      nTickCount = nTick4;
    }
    if (bNoTicks) return;

    let n = 0;
    let nTick = 0.0;
    const nTickGap1 = this.LogicToPixel(nTickCount);
    const nTickGap2 = this.LogicToPixel(nTick2);
    const nTickGap3 = this.LogicToPixel(nTick3);

    while (nStart - n >= nMin || nStart + n <= nMax) {
      // Null point
      if (nTick === 0.0) {
        if (nStart > nMin) {
          // 0 is only painted when Margin1 is not equal to zero
          if (this.mpData.nMargin1Style & RulerMarginStyle.Invisible || this.mpData.nMargin1 !== 0) {
            aNumString = '0';
            this.ImplVDrawText(rRenderContext, nStart, nCenter, aNumString);
          }
        }
      } else {
        n = this.LogicToPixel(nTick);
        // Tick4 - Output (Text)
        let aStep = nTick / nTick4;
        let aRest = Math.abs(aStep - Math.floor(aStep));
        const nAcceptanceDelta = 0.0001;
        rRenderContext.SetLineColor(null);
        rRenderContext.SetFillColor(c.shadow);

        if (aRest < nAcceptanceDelta) {
          aNumString = String(Math.round((nTick / unit.nTickUnit) * 1000) / 1000);
          let nHorizontalLocation = nStart + n;
          this.ImplVDrawText(rRenderContext, nHorizontalLocation, nCenter, aNumString, nMin, nMax);
          if (nMin < nHorizontalLocation && nHorizontalLocation < nMax) {
            this.ImplVDrawRect(rRenderContext, nHorizontalLocation, nBottom - 1 * nScale, nHorizontalLocation + DPIOffset, nBottom);
            this.ImplVDrawRect(rRenderContext, nHorizontalLocation, nTop, nHorizontalLocation + DPIOffset, nTop + 1 * nScale);
          }
          nHorizontalLocation = nStart - n;
          this.ImplVDrawText(rRenderContext, nHorizontalLocation, nCenter, aNumString, nMin, nMax);
          if (nMin < nHorizontalLocation && nHorizontalLocation < nMax) {
            this.ImplVDrawRect(rRenderContext, nHorizontalLocation, nBottom - 1 * nScale, nHorizontalLocation + DPIOffset, nBottom);
            this.ImplVDrawRect(rRenderContext, nHorizontalLocation, nTop, nHorizontalLocation + DPIOffset, nTop + 1 * nScale);
          }
        } else {
          // Tick/Tick2 - Output (Strokes)
          let nTickLength = nTickLength1;
          aStep = nTick / nTick2;
          aRest = Math.abs(aStep - Math.floor(aStep));
          if (aRest < nAcceptanceDelta) nTickLength = nTickLength2;
          aStep = nTick / nTick3;
          aRest = Math.abs(aStep - Math.floor(aStep));
          if (aRest < nAcceptanceDelta) nTickLength = nTickLength3;
          if ((nTickLength === nTickLength1 && nTickGap1 > 6) || (nTickLength === nTickLength2 && nTickGap2 > 6) || (nTickLength === nTickLength3 && nTickGap3 > 6)) {
            const nT1 = Math.trunc(nCenter - nTickLength / 2.0);
            const nT2 = nT1 + nTickLength - 1;
            let nT = nStart + n;
            if (nT < nMax) this.ImplVDrawRect(rRenderContext, nT, nT1, nT + DPIOffset, nT2);
            nT = nStart - n;
            if (nT > nMin) this.ImplVDrawRect(rRenderContext, nT, nT1, nT + DPIOffset, nT2);
          }
        }
      }
      nTick += nTickCount;
    }
  }

  private ImplDrawBorders(rRenderContext: RenderContext, c: RulerColors, nMin: number, nMax: number, nVirTop: number, nVirBottom: number): void {
    for (const b of this.mpData.pBorders) {
      if (b.nStyle & RulerBorderStyle.Invisible) continue;
      const n1 = b.nPos + this.mpData.nNullVirOff;
      const n2 = n1 + b.nWidth;
      if ((n1 >= nMin && n1 <= nMax) || (n2 >= nMin && n2 <= nMax)) {
        if (n2 - n1 > 3) {
          rRenderContext.SetLineColor(null);
          rRenderContext.SetFillColor(c.face);
          this.ImplVDrawRect(rRenderContext, n1, nVirTop, n2, nVirBottom);
          rRenderContext.SetLineColor(c.light);
          this.ImplVDrawLine(rRenderContext, n1 + 1, nVirTop, n1 + 1, nVirBottom);
          this.ImplVDrawLine(rRenderContext, n1, nVirTop, n2, nVirTop);
          rRenderContext.SetLineColor(c.shadow);
          this.ImplVDrawLine(rRenderContext, n1, nVirTop, n1, nVirBottom);
          this.ImplVDrawLine(rRenderContext, n1, nVirBottom, n2, nVirBottom);
          this.ImplVDrawLine(rRenderContext, n2 - 1, nVirTop, n2 - 1, nVirBottom);
          rRenderContext.SetLineColor(c.darkShadow);
          this.ImplVDrawLine(rRenderContext, n2, nVirTop, n2, nVirBottom);
        } else {
          const n = n1 + Math.trunc((n2 - n1) / 2);
          rRenderContext.SetLineColor(c.shadow);
          this.ImplVDrawLine(rRenderContext, n - 1, nVirTop, n - 1, nVirBottom);
          this.ImplVDrawLine(rRenderContext, n + 1, nVirTop, n + 1, nVirBottom);
          rRenderContext.SetLineColor(null);
          rRenderContext.SetFillColor(c.window);
          this.ImplVDrawRect(rRenderContext, n, nVirTop, n, nVirBottom);
        }
      }
    }
  }

  private ImplDrawIndent(rRenderContext: RenderContext, c: RulerColors, rPoly: [number, number][], bIsHit: boolean): void {
    rRenderContext.SetLineColor(c.darkShadow);
    rRenderContext.SetFillColor(bIsHit ? c.darkShadow : c.workspace);
    rRenderContext.DrawPolygon(rPoly);
  }

  private ImplDrawIndents(rRenderContext: RenderContext, c: RulerColors, nMin: number, nMax: number, nVirTop: number, nVirBottom: number): void {
    const nIndentHeight = Math.trunc(this.mnVirHeight / 2) - 1;
    const nIndentWidth2 = nIndentHeight - 3;
    this.mpData.pIndents.forEach((ind, j) => {
      if (ind.bInvisible) return;
      const nIndentStyle = ind.nStyle;
      const n = ind.nPos + this.mpData.nNullVirOff;
      if (n >= nMin && n <= nMax) {
        let aPoly: [number, number][];
        if (nIndentStyle === RulerIndentStyle.Bottom) {
          aPoly = [[n + 0, nVirBottom - nIndentHeight], [n - nIndentWidth2, nVirBottom - 3], [n - nIndentWidth2, nVirBottom], [n + nIndentWidth2, nVirBottom], [n + nIndentWidth2, nVirBottom - 3]];
        } else {
          aPoly = [[n + 0, nVirTop + nIndentHeight], [n - nIndentWidth2, nVirTop + 3], [n - nIndentWidth2, nVirTop], [n + nIndentWidth2, nVirTop], [n + nIndentWidth2, nVirTop + 3]];
        }
        if (0 === (this.mnWinStyle & WB_HORZ)) aPoly = aPoly.map(([x, y]) => [nVirBottom - y, x]);
        let bIsHit = false;
        if (this.mxCurrentHitTest !== null && this.mxCurrentHitTest.eType === RulerType.Indent) bIsHit = this.mxCurrentHitTest.nAryPos === j;
        else if (this.mbDrag && this.meDragType === RulerType.Indent) bIsHit = this.mnDragAryPos === j;
        this.ImplDrawIndent(rRenderContext, c, aPoly, bIsHit);
      }
    });
  }

  private ImplDrawTab(rRenderContext: RenderContext, c: RulerColors, rPos: [number, number], nStyle: number): void {
    if (nStyle & RULER_STYLE_INVISIBLE) return;
    rRenderContext.SetLineColor(null);
    if (nStyle & RULER_STYLE_DONTKNOW) rRenderContext.SetFillColor(c.face);
    else rRenderContext.SetFillColor(c.darkShadow);
    if (this.mpData.bTextRTL) nStyle |= RULER_TAB_RTL;
    ImplDrawRulerTab(rRenderContext, rPos, nStyle, this.mnWinStyle);
  }

  private ImplDrawTabs(rRenderContext: RenderContext, c: RulerColors, nMin: number, nMax: number, nVirTop: number, nVirBottom: number): void {
    for (const rTab of this.mpData.pTabs) {
      if (rTab.nStyle & RULER_STYLE_INVISIBLE) continue;
      const aPosition = rTab.nPos + this.mpData.nNullVirOff;
      const nTopBottom = this.mnWinStyle & WB_RIGHT_ALIGNED ? nVirTop : nVirBottom;
      if (nMin <= aPosition && aPosition <= nMax) this.ImplDrawTab(rRenderContext, c, [aPosition, nTopBottom], rTab.nStyle);
    }
  }

  private ImplCalc(): void {
    // calculate offset
    this.mpData.nRulVirOff = this.mnWinOff + this.mpData.nPageOff;
    if (this.mpData.nRulVirOff > this.mnVirOff) this.mpData.nRulVirOff -= this.mnVirOff;
    else this.mpData.nRulVirOff = 0;
    const nRulWinOff = this.mpData.nRulVirOff + this.mnVirOff;

    // calculate non-visual part of the page
    let nNotVisPageWidth: number;
    if (this.mpData.nPageOff < 0) {
      nNotVisPageWidth = -this.mpData.nPageOff;
      if (nRulWinOff < this.mnWinOff) nNotVisPageWidth -= this.mnWinOff - nRulWinOff;
    } else nNotVisPageWidth = 0;

    if (this.mnWinStyle & WB_HORZ) {
      if (this.mbAutoWinWidth) this.mnWinWidth = this.mnWidth - this.mnVirOff;
      if (this.mpData.bAutoPageWidth) this.mpData.nPageWidth = this.mnWinWidth;
      this.mpData.nRulWidth = Math.min(this.mnWinWidth, this.mpData.nPageWidth - nNotVisPageWidth);
      if (nRulWinOff + this.mpData.nRulWidth > this.mnWidth) this.mpData.nRulWidth = this.mnWidth - nRulWinOff;
    } else {
      if (this.mbAutoWinWidth) this.mnWinWidth = this.mnHeight - this.mnVirOff;
      if (this.mpData.bAutoPageWidth) this.mpData.nPageWidth = this.mnWinWidth;
      this.mpData.nRulWidth = Math.min(this.mnWinWidth, this.mpData.nPageWidth - nNotVisPageWidth);
      if (nRulWinOff + this.mpData.nRulWidth > this.mnHeight) this.mpData.nRulWidth = this.mnHeight - nRulWinOff;
    }
    this.mbCalc = false;
  }

  /** ImplFormat and ImplDraw: paints the whole ruler. */
  Paint(rWindow: RenderContext, c: RulerColors): void {
    // Background (ApplySettings: the APPBACKGROUND colour)
    rWindow.SetLineColor(null);
    rWindow.SetFillColor(c.appBackground);
    rWindow.DrawRect(0, 0, this.mnWidth - 1, this.mnHeight - 1);
    const rRenderContext = this.mnWinStyle & WB_HORZ ? Translated(rWindow, this.mnVirOff, RULER_OFF) : Translated(rWindow, RULER_OFF, this.mnVirOff);
    if (this.mbCalc) this.ImplCalc();
    this.mpData.nNullVirOff = this.mnWinOff + this.mpData.nPageOff + this.mpData.nNullOff - this.mnVirOff;
    const nNullVirOff = this.mpData.nNullVirOff;
    const nVirLeft = this.mpData.nRulVirOff;
    const nVirRight = nVirLeft + this.mpData.nRulWidth - 1;
    let nVirTop = 0;
    let nVirBottom = this.mnVirHeight - 1;
    this.mbFormat = false;
    if (!this.mnVirWidth) { this.ImplDrawExtra(rWindow, c); return; }

    let nP1: number, nP2: number, nM1: number, nM2: number;
    // calculate margins
    if (!(this.mpData.nMargin1Style & RulerMarginStyle.Invisible)) {
      nM1 = this.mpData.nMargin1 + nNullVirOff;
      if (this.mpData.bAutoPageWidth) {
        nP1 = nVirLeft;
        if (nM1 < nVirLeft) nP1--;
      } else nP1 = nNullVirOff - this.mpData.nNullOff;
    } else {
      nM1 = nVirLeft - 1;
      nP1 = nM1;
    }
    if (!(this.mpData.nMargin2Style & RulerMarginStyle.Invisible)) {
      nM2 = this.mpData.nMargin2 + nNullVirOff;
      if (this.mpData.bAutoPageWidth) {
        nP2 = nVirRight;
        if (nM2 > nVirRight) nP2++;
      } else nP2 = nNullVirOff - this.mpData.nNullOff + this.mpData.nPageWidth;
      if (nM2 > nP2) nM2 = nP2;
    } else {
      nM2 = nVirRight + 1;
      nP2 = nM2;
    }

    // top/bottom border
    rRenderContext.SetLineColor(c.shadow);
    this.ImplVDrawLine(rRenderContext, nVirLeft, nVirTop + 1, nM1, nVirTop + 1); //top left line
    this.ImplVDrawLine(rRenderContext, nM2, nVirTop + 1, nP2 - 1, nVirTop + 1); //top right line

    nVirTop++;
    nVirBottom--;

    // draw margin1, margin2 and in-between
    rRenderContext.SetLineColor(null);
    rRenderContext.SetFillColor(c.dialog);
    if (nM1 > nVirLeft) this.ImplVDrawRect(rRenderContext, nP1, nVirTop + 1, nM1, nVirBottom); //left gray rectangle
    if (nM2 < nP2) this.ImplVDrawRect(rRenderContext, nM2, nVirTop + 1, nP2, nVirBottom); //right gray rectangle
    if (nM2 - nM1 > 0) {
      rRenderContext.SetFillColor(c.window);
      this.ImplVDrawRect(rRenderContext, nM1 + 1, nVirTop, nM2 - 1, nVirBottom); //center rectangle
    }
    rRenderContext.SetLineColor(c.shadow);
    if (nM1 > nVirLeft) {
      this.ImplVDrawLine(rRenderContext, nM1, nVirTop + 1, nM1, nVirBottom); //right line of the left rectangle
      this.ImplVDrawLine(rRenderContext, nP1, nVirBottom, nM1, nVirBottom); //bottom line of the left rectangle
      if (nP1 >= nVirLeft) {
        this.ImplVDrawLine(rRenderContext, nP1, nVirTop + 1, nP1, nVirBottom); //left line of the left rectangle
        this.ImplVDrawLine(rRenderContext, nP1, nVirBottom, nP1 + 1, nVirBottom); //?
      }
    }
    if (nM2 < nP2) {
      this.ImplVDrawLine(rRenderContext, nM2, nVirBottom, nP2 - 1, nVirBottom); //bottom line of the right rectangle
      this.ImplVDrawLine(rRenderContext, nM2, nVirTop + 1, nM2, nVirBottom); //left line of the right rectangle
      if (nP2 <= nVirRight + 1) this.ImplVDrawLine(rRenderContext, nP2 - 1, nVirTop + 1, nP2 - 1, nVirBottom); //right line of the right rectangle
    }

    let nMin = nVirLeft;
    let nMax = nP2;
    const nStart = this.mpData.bTextRTL ? this.mpData.nRightFrameMargin + nNullVirOff : this.mpData.nLeftFrameMargin + nNullVirOff;

    // Do not draw first tick if it is at the left edge
    if (nP1 > nVirLeft) nMin++;
    if (nP2 < nVirRight) nMax--;

    // Draw captions
    this.ImplDrawTicks(rRenderContext, c, nMin, nMax, nStart, nVirTop, nVirBottom);

    // Draw borders
    if (this.mpData.pBorders.length) this.ImplDrawBorders(rRenderContext, c, nVirLeft, nP2, nVirTop, nVirBottom);

    // Draw indents
    if (this.mpData.pIndents.length) this.ImplDrawIndents(rRenderContext, c, nVirLeft, nP2, nVirTop - 1, nVirBottom + 1);

    // Tabs
    if (this.mpData.pTabs.length) this.ImplDrawTabs(rRenderContext, c, nVirLeft, nP2, nVirTop - 1, nVirBottom + 1);

    this.ImplDrawExtra(rWindow, c);
  }

  private ImplInitExtraField(): void {
    if (this.mnWinStyle & WB_EXTRAFIELD) {
      this.maExtraRect = [RULER_OFF, RULER_OFF, RULER_OFF + this.mnVirHeight - 1, RULER_OFF + this.mnVirHeight - 1];
      this.mnVirOff = this.maExtraRect[2] + 1;
    } else {
      this.maExtraRect = null;
      this.mnVirOff = 0;
    }
    // mnVirWidth depends on mnVirOff
    if (this.mnVirWidth > RULER_MIN_SIZE || (this.mnWidth > RULER_MIN_SIZE && this.mnHeight > RULER_MIN_SIZE)) {
      if (this.mnWinStyle & WB_HORZ) this.mnVirWidth = this.mnWidth - this.mnVirOff;
      else this.mnVirWidth = this.mnHeight - this.mnVirOff;
      if (this.mnVirWidth < RULER_MIN_SIZE) this.mnVirWidth = 0;
    }
    this.mbCalc = true;
    this.mbFormat = true;
  }

  private ImplDrawExtra(rRenderContext: RenderContext, c: RulerColors): void {
    if (!this.maExtraRect) return;
    const aRect = [this.maExtraRect[0] + 2, this.maExtraRect[1] + 2, this.maExtraRect[2] - 2, this.maExtraRect[3] - 2] as const;
    if (this.mnExtraStyle & RULER_STYLE_HIGHLIGHT) {
      rRenderContext.SetLineColor(null);
      rRenderContext.SetFillColor(c.checked);
      rRenderContext.DrawRect(aRect[0], aRect[1], aRect[2], aRect[3]);
    }
    // output content
    if (this.meExtraType === RulerExtra.Tab) {
      let nTabStyle = this.mnExtraStyle & RULER_TAB_STYLE;
      if (this.mpData.bTextRTL) nTabStyle |= RULER_TAB_RTL;
      const aCenter: [number, number] = [Math.trunc((aRect[0] + aRect[2]) / 2), Math.trunc((aRect[1] + aRect[3]) / 2)];
      const aDraw: [number, number] = [aCenter[0], aCenter[1]];
      ImplCenterTabPos(aDraw, nTabStyle);
      rRenderContext.SetLineColor(null);
      rRenderContext.SetFillColor(c.darkShadow);
      // The extra field's tab is drawn upright in either ruler.
      ImplDrawRulerTab(rRenderContext, aDraw, nTabStyle, WB_HORZ);
    }
  }

  /** Resize: the window's new size in pixels. */
  SetOutputSizePixel(nWidth: number, nHeight: number): void {
    if (nWidth === this.mnWidth && nHeight === this.mnHeight) return;
    const nNewHeight = this.mnWinStyle & WB_HORZ ? (nHeight !== this.mnHeight ? nHeight : 0) : (nWidth !== this.mnWidth ? nWidth : 0);
    this.mnWidth = nWidth;
    this.mnHeight = nHeight;
    if (nNewHeight) {
      this.mbCalc = true;
      this.mnVirHeight = nNewHeight - this.mnBorderWidth - RULER_OFF * 2;
    }
    if (!this.mnVirWidth) this.mnVirWidth = RULER_MIN_SIZE + 1;
    // extra field should always be updated
    this.ImplInitExtraField();
  }

  /** SetStyle: switches the extra field on or off. */
  SetStyle(nStyle: number): void {
    if (this.mnWinStyle === nStyle) return;
    this.mnWinStyle = nStyle;
    this.ImplInitExtraField();
  }
  GetStyle(): number { return this.mnWinStyle; }

  private ImplUpdate(bMustCalc = false): void {
    if (bMustCalc) this.mbCalc = true;
    this.mbFormat = true;
  }

  protected ImplDoHitTest(nPosX: number, nPosY: number, pHitTest: RulerSelection, bRequireStyle = false, nRequiredStyle: RulerIndentStyle = RulerIndentStyle.Top, nTolerance = 1): boolean {
    if (!this.mbActive) return false;
    // determine positions
    const bIsHori = 0 !== (this.mnWinStyle & WB_HORZ);
    let nX = bIsHori ? nPosX : nPosY;
    const nY = bIsHori ? nPosY : nPosX;
    const nHitBottom = this.mnVirHeight + RULER_OFF * 2;

    // #i32608#
    pHitTest.nAryPos = 0;
    pHitTest.mnDragSize = RulerDragSize.Move;
    pHitTest.bSize = false;
    pHitTest.bSizeBar = false;

    // so that leftover tabs and indents are taken into account
    const nXExtraOff = this.mpData.pTabs.length || this.mpData.pIndents.length ? Math.trunc(this.mnVirHeight / 2) - 4 : 0;

    // tdf#84949 - check if the mouse is moved over the extra field
    if (this.meExtraType === RulerExtra.Tab && this.maExtraRect && this.ExtraContains(nPosX, nPosY)) {
      pHitTest.nPos = nX;
      pHitTest.eType = RulerType.TabAlign;
      return true;
    }

    // test if outside
    nX -= this.mnVirOff;
    if (nX < this.mpData.nRulVirOff - nXExtraOff || nX > this.mpData.nRulVirOff + this.mpData.nRulWidth + nXExtraOff || nY < 0 || nY > nHitBottom) {
      pHitTest.nPos = 0;
      pHitTest.eType = RulerType.Outside;
      return false;
    }

    nX -= this.mpData.nNullVirOff;
    pHitTest.nPos = nX;
    pHitTest.eType = RulerType.DontKnow;

    const contains = (l: number, t: number, r: number, b: number) => nX >= l && nX <= r && nY >= t && nY <= b;
    const tabRect = (n1: number, nStyle: number): [number, number] => {
      if (nStyle === RULER_TAB_LEFT) return [n1, n1 + ruler_tab.width - 1];
      if (nStyle === RULER_TAB_RIGHT) return [n1 - ruler_tab.width - 1, n1];
      return [n1 - ruler_tab.cwidth2 + 1, n1 - ruler_tab.cwidth2 + ruler_tab.cwidth];
    };
    // first test the tabs
    if (this.mpData.pTabs.length) {
      const bottom = nHitBottom, top = bottom - ruler_tab.height - RULER_OFF;
      for (let i = this.mpData.pTabs.length - 1; i >= 0; i--) {
        let nStyle = this.mpData.pTabs[i]!.nStyle;
        if (!(nStyle & RULER_STYLE_INVISIBLE)) {
          nStyle &= RULER_TAB_STYLE;
          // default tabs are only shown (no action)
          if (nStyle !== RULER_TAB_DEFAULT) {
            const [l, r] = tabRect(this.mpData.pTabs[i]!.nPos, nStyle);
            if (contains(l, top, r, bottom)) {
              pHitTest.eType = RulerType.Tab;
              pHitTest.nAryPos = i;
              return true;
            }
          }
        }
      }
    }

    // Indents
    if (this.mpData.pIndents.length) {
      const nIndentHeight = Math.trunc(this.mnVirHeight / 2) - 1;
      const nIndentWidth2 = nIndentHeight - 3;
      for (let i = this.mpData.pIndents.length; i; i--) {
        const nIndentStyle = this.mpData.pIndents[i - 1]!.nStyle;
        if ((!bRequireStyle || nIndentStyle === nRequiredStyle) && !this.mpData.pIndents[i - 1]!.bInvisible) {
          const n1 = this.mpData.pIndents[i - 1]!.nPos;
          const hit = (nIndentStyle === RulerIndentStyle.Bottom) !== !bIsHori
            ? contains(n1 - nIndentWidth2, nHitBottom - nIndentHeight - RULER_OFF + 1, n1 + nIndentWidth2, nHitBottom)
            : contains(n1 - nIndentWidth2, 0, n1 + nIndentWidth2, nIndentHeight + RULER_OFF - 1);
          if (hit) {
            pHitTest.eType = RulerType.Indent;
            pHitTest.nAryPos = i - 1;
            return true;
          }
        }
      }
    }

    // test the borders
    let nBorderTolerance = nTolerance;
    if (pHitTest.bExpandTest) nBorderTolerance++;
    for (let i = this.mpData.pBorders.length; i; i--) {
      let n1 = this.mpData.pBorders[i - 1]!.nPos;
      let n2 = n1 + this.mpData.pBorders[i - 1]!.nWidth;
      // borders have at least 3 pixel padding
      if (!this.mpData.pBorders[i - 1]!.nWidth) {
        n1 -= nBorderTolerance;
        n2 += nBorderTolerance;
      }
      if (nX >= n1 && nX <= n2) {
        const nBorderStyle = this.mpData.pBorders[i - 1]!.nStyle;
        if (!(nBorderStyle & RulerBorderStyle.Invisible)) {
          pHitTest.eType = RulerType.Border;
          pHitTest.nAryPos = i - 1;
          if (!(nBorderStyle & RulerBorderStyle.Sizeable)) {
            if (nBorderStyle & RulerBorderStyle.Moveable) {
              pHitTest.bSizeBar = true;
              pHitTest.mnDragSize = RulerDragSize.Move;
            }
          } else {
            let nMOff = RULER_MOUSE_BORDERWIDTH;
            while (nMOff * 2 >= n2 - n1 - RULER_MOUSE_BORDERMOVE) {
              if (nMOff < 2) { nMOff = 0; break; }
              nMOff--;
            }
            if (nX <= n1 + nMOff) { pHitTest.bSize = true; pHitTest.mnDragSize = RulerDragSize.N1; }
            else if (nX >= n2 - nMOff) { pHitTest.bSize = true; pHitTest.mnDragSize = RulerDragSize.N2; }
            else if (nBorderStyle & RulerBorderStyle.Moveable) { pHitTest.bSizeBar = true; pHitTest.mnDragSize = RulerDragSize.Move; }
          }
          return true;
        }
      }
    }

    // Margins
    const nMarginTolerance = pHitTest.bExpandTest ? nBorderTolerance : RULER_MOUSE_MARGINWIDTH;
    if ((this.mpData.nMargin1Style & (RulerMarginStyle.Sizeable | RulerMarginStyle.Invisible)) === RulerMarginStyle.Sizeable) {
      const n1 = this.mpData.nMargin1;
      if (nX >= n1 - nMarginTolerance && nX <= n1 + nMarginTolerance) {
        pHitTest.eType = RulerType.Margin1;
        pHitTest.bSize = true;
        return true;
      }
    }
    if ((this.mpData.nMargin2Style & (RulerMarginStyle.Sizeable | RulerMarginStyle.Invisible)) === RulerMarginStyle.Sizeable) {
      const n1 = this.mpData.nMargin2;
      if (nX >= n1 - nMarginTolerance && nX <= n1 + nMarginTolerance) {
        pHitTest.eType = RulerType.Margin2;
        pHitTest.bSize = true;
        return true;
      }
    }

    // test tabs again
    if (this.mpData.pTabs.length) {
      for (let i = this.mpData.pTabs.length - 1; i >= 0; i--) {
        let nStyle = this.mpData.pTabs[i]!.nStyle;
        if (!(nStyle & RULER_STYLE_INVISIBLE)) {
          nStyle &= RULER_TAB_STYLE;
          // default tabs are only shown (no action)
          if (nStyle !== RULER_TAB_DEFAULT) {
            const [l, r] = tabRect(this.mpData.pTabs[i]!.nPos, nStyle);
            if (contains(l - 1, RULER_OFF, r + 1, nHitBottom)) {
              pHitTest.eType = RulerType.Tab;
              pHitTest.nAryPos = i;
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  private ExtraContains(x: number, y: number): boolean {
    const r = this.maExtraRect;
    return !!r && x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
  }

  private ImplStartDrag(pHitTest: RulerSelection, nModifier: number): boolean {
    // don't trigger drag if a border that was clicked can not be changed
    if (pHitTest.eType === RulerType.Border && !pHitTest.bSize && !pHitTest.bSizeBar) return false;

    // Set drag data
    this.meDragType = pHitTest.eType;
    this.mnDragPos = pHitTest.nPos;
    this.mnDragAryPos = pHitTest.nAryPos;
    this.mnDragSize = pHitTest.mnDragSize;
    this.mnDragModifier = nModifier;
    this.mpDragData = this.mpSaveData.clone();
    this.mpData = this.mpDragData;

    // call handler
    if (this.StartDrag()) {
      // if the handler allows dragging, initialize dragging
      this.mbDrag = true;
      this.mnStartDragPos = this.mnDragPos;
      this.mbFormat = true;
      return true;
    }
    // otherwise reset the data
    this.meDragType = RulerType.DontKnow;
    this.mnDragPos = 0;
    this.mnDragAryPos = 0;
    this.mnDragSize = RulerDragSize.Move;
    this.mnDragModifier = 0;
    this.mpData = this.mpSaveData;
    return false;
  }

  private ImplDrag(nPosX: number, nPosY: number): void {
    let nX: number, nY: number, nOutHeight: number;
    if (this.mnWinStyle & WB_HORZ) { nX = nPosX; nY = nPosY; nOutHeight = this.mnHeight; }
    else { nX = nPosY; nY = nPosX; nOutHeight = this.mnWidth; }

    // calculate and fit X
    nX -= this.mnVirOff;
    if (nX < this.mpData.nRulVirOff) nX = this.mpData.nRulVirOff;
    else if (nX > this.mpData.nRulVirOff + this.mpData.nRulWidth) nX = this.mpData.nRulVirOff + this.mpData.nRulWidth;
    nX -= this.mpData.nNullVirOff;

    // if upper or left from ruler, then consider old values
    this.mbDragDelete = false;
    if (nY < 0) {
      if (!this.mbDragCanceled) {
        // reset the data
        this.mbDragCanceled = true;
        const aTempData = this.mpDragData.clone();
        Object.assign(this.mpDragData, this.mpSaveData.clone());
        this.mbCalc = true;
        this.mbFormat = true;
        // call handler
        this.mnDragPos = this.mnStartDragPos;
        this.Drag();
        // reset the data as before cancel
        Object.assign(this.mpDragData, aTempData);
      }
    } else {
      this.mbDragCanceled = false;
      // +2, so the tabs are not cleared too quickly
      if (nY > nOutHeight + 2) this.mbDragDelete = true;
      this.mnDragPos = nX;
      // call handler
      this.Drag();
      this.mbFormat = true;
    }
  }

  private ImplEndDrag(): void {
    // get values
    if (this.mbDragCanceled) this.mpDragData = this.mpSaveData.clone();
    else this.mpSaveData = this.mpDragData.clone();
    this.mpData = this.mpSaveData;
    this.mbDrag = false;

    // call handler
    this.EndDrag();

    // reset drag values
    this.meDragType = RulerType.DontKnow;
    this.mnDragPos = 0;
    this.mnDragAryPos = 0;
    this.mnDragSize = RulerDragSize.Move;
    this.mbDragCanceled = false;
    this.mbDragDelete = false;
    this.mnDragModifier = 0;
    this.mnStartDragPos = 0;
    this.mbFormat = true;
  }

  /** MouseButtonDown, with the left button: returns whether dragging (tracking) started. */
  MouseButtonDown(nPosX: number, nPosY: number, nMouseClicks: number, nMouseModifier: number): boolean {
    if (this.mbDrag) return false;
    if (this.ExtraContains(nPosX, nPosY)) {
      this.ExtraDown();
      return false;
    }
    const aHitTest = newSelection();
    const bHitTestResult = this.ImplDoHitTest(nPosX, nPosY, aHitTest);
    if (nMouseClicks === 1) {
      if (bHitTestResult) return this.ImplStartDrag(aHitTest, nMouseModifier);
      // calculate position inside of ruler area
      if (aHitTest.eType === RulerType.DontKnow) {
        this.mnDragPos = aHitTest.nPos;
        this.Click();
        this.mnDragPos = 0;
        // call HitTest again as a click, for example, could set a new tab
        if (this.ImplDoHitTest(nPosX, nPosY, aHitTest)) return this.ImplStartDrag(aHitTest, nMouseModifier);
      }
    } else {
      if (bHitTestResult) {
        this.mnDragPos = aHitTest.nPos;
        this.mnDragAryPos = aHitTest.nAryPos;
      }
      this.meDragType = aHitTest.eType;
      this.DoubleClick();
      this.meDragType = RulerType.DontKnow;
      this.mnDragPos = 0;
      this.mnDragAryPos = 0;
    }
    return false;
  }

  /** MouseMove without a button: the hover state; returns the pointer (a CSS cursor). */
  MouseMove(nPosX: number, nPosY: number): string {
    let ePtrStyle = 'default';
    this.mxPreviousHitTest = this.mxCurrentHitTest;
    this.mxCurrentHitTest = newSelection();
    if (this.ImplDoHitTest(nPosX, nPosY, this.mxCurrentHitTest)) {
      if (this.mxCurrentHitTest.bSize) ePtrStyle = this.mnWinStyle & WB_HORZ ? 'ew-resize' : 'ns-resize';
      else if (this.mxCurrentHitTest.bSizeBar) ePtrStyle = this.mnWinStyle & WB_HORZ ? 'col-resize' : 'row-resize';
    } else this.mxCurrentHitTest = null;
    if ((this.mxPreviousHitTest?.eType ?? null) !== (this.mxCurrentHitTest?.eType ?? null)) this.mbFormat = true;
    return ePtrStyle;
  }

  /** The pointer left the ruler: no hover state. */
  MouseLeave(): void { this.mxCurrentHitTest = null; this.mbFormat = true; }

  /** Tracking: a move while dragging, or its end (`bEnd`), cancelled with `bCanceled` (Escape). */
  Tracking(nPosX: number, nPosY: number, bEnd: boolean, bCanceled = false): void {
    if (!this.mbDrag) return;
    if (bEnd) {
      // reset the old state on cancel
      if (bCanceled) {
        this.mbDragCanceled = true;
        this.mbFormat = true;
      }
      this.ImplEndDrag();
    } else this.ImplDrag(nPosX, nPosY);
  }

  NeedsPaint(): boolean { return this.mbFormat; }

  // Handlers, overridden by SvxRuler.
  StartDrag(): boolean { return false; }
  Drag(): void {}
  EndDrag(): void {}
  Click(): void {}
  DoubleClick(): void {}
  ExtraDown(): void {}

  SetWinPos(nNewOff: number, nNewWidth = 0): void {
    // should widths be automatically calculated
    this.mbAutoWinWidth = !nNewWidth;
    this.mnWinOff = nNewOff;
    this.mnWinWidth = nNewWidth;
    this.ImplUpdate(true);
  }

  SetPagePos(nNewOff = 0, nNewWidth = 0): void {
    // should we do anything?
    if (this.mpData.nPageOff === nNewOff && this.mpData.nPageWidth === nNewWidth) return;
    // should widths be automatically calculated
    this.mpData.bAutoPageWidth = !nNewWidth;
    this.mpData.nPageOff = nNewOff;
    this.mpData.nPageWidth = nNewWidth;
    this.ImplUpdate(true);
  }

  SetUnit(nUnitIndex: number): void {
    if (this.mnUnitIndex === nUnitIndex) return;
    this.mnUnitIndex = nUnitIndex;
    this.ImplUpdate();
  }
  GetUnitIndex(): number { return this.mnUnitIndex; }
  /** GetCurrentRulerUnit */
  GetCurrentRulerUnit(): RulerUnitData { return aImplRulerUnitTab[this.mnUnitIndex]!; }

  SetZoom(rNewZoom: number): void {
    if (this.maZoom !== rNewZoom) {
      this.maZoom = rNewZoom;
      this.ImplUpdate();
    }
  }
  GetZoom(): number { return this.maZoom; }

  SetExtraType(eNewExtraType: RulerExtra, nStyle = 0): void {
    if (this.mnWinStyle & WB_EXTRAFIELD) {
      this.meExtraType = eNewExtraType;
      this.mnExtraStyle = nStyle;
      this.mbFormat = true;
    }
  }

  SetNullOffset(nPos: number): void {
    if (this.mpData.nNullOff !== nPos) {
      this.mpData.nNullVirOff += nPos - this.mpData.nNullOff;
      this.mpData.nNullOff = nPos;
      this.ImplUpdate();
    }
  }
  GetNullOffset(): number { return this.mpData.nNullOff; }

  SetLeftFrameMargin(nPos: number): void {
    if (this.mpData.nLeftFrameMargin !== nPos) {
      this.mpData.nLeftFrameMargin = nPos;
      this.ImplUpdate();
    }
  }

  SetRightFrameMargin(nPos: number): void {
    if (this.mpData.nRightFrameMargin !== nPos) {
      this.mpData.nRightFrameMargin = nPos;
      this.ImplUpdate();
    }
  }

  SetMargin1(nPos = 0, nMarginStyle: number = RulerMarginStyle.Sizeable | RulerMarginStyle.Invisible): void {
    if (this.mpData.nMargin1 !== nPos || this.mpData.nMargin1Style !== nMarginStyle) {
      this.mpData.nMargin1 = nPos;
      this.mpData.nMargin1Style = nMarginStyle;
      this.ImplUpdate();
    }
  }
  GetMargin1(): number { return this.mpData.nMargin1; }

  SetMargin2(nPos = 0, nMarginStyle: number = RulerMarginStyle.Sizeable | RulerMarginStyle.Invisible): void {
    if (this.mpData.nMargin2 !== nPos || this.mpData.nMargin2Style !== nMarginStyle) {
      this.mpData.nMargin2 = nPos;
      this.mpData.nMargin2Style = nMarginStyle;
      this.ImplUpdate();
    }
  }
  GetMargin2(): number { return this.mpData.nMargin2; }

  SetBorders(pBorderArray: RulerBorder[] = []): void {
    this.mpData.pBorders = pBorderArray.map((b) => ({ ...b }));
    this.ImplUpdate();
  }

  SetIndents(pIndentArray: RulerIndent[] = []): void {
    this.mpData.pIndents = pIndentArray.map((i) => ({ ...i }));
    this.ImplUpdate();
  }

  SetTabs(pTabArray: RulerTab[] = []): void {
    this.mpData.pTabs = pTabArray.map((t) => ({ ...t }));
    this.ImplUpdate();
  }

  SetTextRTL(bRTL: boolean): void {
    if (this.mpData.bTextRTL !== bRTL) {
      this.mpData.bTextRTL = bRTL;
      this.ImplUpdate();
    }
  }

  IsDrag(): boolean { return this.mbDrag; }
  IsDragDelete(): boolean { return this.mbDragDelete; }
  IsDragCanceled(): boolean { return this.mbDragCanceled; }
  GetDragType(): RulerType { return this.meDragType; }
  GetDragPos(): number { return this.mnDragPos; }
  GetDragAryPos(): number { return this.mnDragAryPos; }
  GetDragSize(): RulerDragSize { return this.mnDragSize; }
  GetDragModifier(): number { return this.mnDragModifier; }
  GetClickPos(): number { return this.mnDragPos; }
  IsHorizontal(): boolean { return !!(this.mnWinStyle & WB_HORZ); }
  GetVirHeight(): number { return this.mnVirHeight; }
  SetActive(bNewActive: boolean): void { this.mbActive = bNewActive; this.mbFormat = true; }
}
