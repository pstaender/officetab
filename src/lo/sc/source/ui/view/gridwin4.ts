// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/view/gridwin4.cxx reduced
// @upstream sc/source/ui/view/gridwin.cxx partial
// @upstream sc/source/ui/cctrl/dpcontrol.cxx partial
// ScGridWindow::Draw / DrawContent: paints one pane of the view: the visible cells through
// ScDocument::FillInfo and ScOutputData (background, grid, borders, texts), then the overlays
// upstream keeps in overlay objects: the selection (UpdateSelectionOverlay), the cell cursor
// (UpdateCursorOverlay), the AutoFill handle (UpdateAutoFillOverlay), the drag rectangle of
// AutoFill and of a reference being picked (UpdateDragRectOverlay), the formula's references in
// their colours (the range finder, PaintRangeFinder) and the marquee of copied cells
// (UpdateCopySourceOverlay), and the AutoFilter and validity list buttons (DrawButtons, with
// ScDPFieldButton's popup button from sc/source/ui/cctrl/dpcontrol.cxx). Left out: drawing
// objects, page breaks, notes, the visible formula marks, the pivot table buttons and the
// LibreOfficeKit tile painting.
import { ScRange, type SCCOL, type SCROW } from '../../../inc/address.ts';
import { ScTableInfo } from '../../../inc/fillinfo.ts';
import { ScQueryParam } from '../../../inc/queryparam.ts';
import { ScDBDataPortion, type ScDBData } from '../../core/tool/dbdata.ts';
import { ViewOption } from '../../../inc/viewopti.ts';
import { FillInfo } from '../../core/data/fillinfo.ts';
import type { TextMeasurer } from '../../../../vcl/source/outdev/text.ts';
import { ScOutputData, ScOutputType, type ScRenderContext } from './output.ts';
import { ScFillMode, ScRefType, WhichH, WhichV, type ScSplitPos, type ScViewData } from './viewdata.ts';

/** A range shown in a colour (the range finder's references, ScRangeFindData). */
export interface ScRangeFindData { aRef: ScRange; nColor: string }

/** What the window paints besides the cells. */
export interface ScGridWindowOverlays {
  /** The cell being edited (its text is the editor's, not drawn). */
  editCell?: { nCol: SCCOL; nRow: SCROW } | null;
  /** The range finder's references. */
  rangeFinder?: readonly ScRangeFindData[];
  /** The cells copied (the marching ants). */
  copySource?: ScRange | null;
  /** Whether the window has the focus (the cursor is drawn darker). */
  bFocus?: boolean;
  /** The colours (the document's background, the selection, the cursor). */
  colors?: Partial<ScGridColors>;
  /** The cell showing the validity list's button (aListValPos while bListValButton). */
  listValPos?: { nCol: SCCOL; nRow: SCROW } | null;
}

export interface ScGridColors { doc: string; grid: string; selection: string; selectionBorder: string; cursor: string; handle: string; buttonFace: string; buttonLine: string; buttonText: string }
export const DEFAULT_GRID_COLORS: ScGridColors = { doc: '#ffffff', grid: '#c0c0c0', selection: 'rgba(42, 107, 201, 0.16)', selectionBorder: '#2a6bc9', cursor: '#000000', handle: '#2a6bc9', buttonFace: '#f0f0f0', buttonLine: '#7a7a7a', buttonText: '#202020' };

/** The AutoFill handle's size in pixels. */
export const SC_AUTOFILL_HANDLE = 6;

/** The pixel rectangle of a range in a pane (from the pane's origin), clipped to what is left of the pane's start. */
export function GetRangePixelRect(rViewData: ScViewData, rRange: ScRange, eWhich: ScSplitPos): { x: number; y: number; w: number; h: number } {
  const a = rViewData.GetScrPos(rRange.aStart.Col(), rRange.aStart.Row(), eWhich, true);
  const b = rViewData.GetScrPos(rRange.aEnd.Col() + 1, rRange.aEnd.Row() + 1, eWhich, true);
  return { x: a.X, y: a.Y, w: b.X - a.X, h: b.Y - a.Y };
}

/** The cell cursor's rectangle (the merged area if the cell is merged). */
export function GetCursorPixelRect(rViewData: ScViewData, eWhich: ScSplitPos): { x: number; y: number; w: number; h: number } {
  const nX = rViewData.GetCurX(), nY = rViewData.GetCurY();
  const p = rViewData.GetScrPos(nX, nY, eWhich, true);
  const s = rViewData.GetMergeSizePixel(nX, nY);
  return { x: p.X, y: p.Y, w: s.rSizeXPix, h: s.rSizeYPix };
}

/**
 * ScGridWindow::Draw: one pane at (nPaneX, nPaneY) of nPaneW × nPaneH pixels on the context.
 */
export function DrawPane(ctx: ScRenderContext, rViewData: ScViewData, eWhich: ScSplitPos, nPaneX: number, nPaneY: number, nPaneW: number, nPaneH: number, pMeasurer: TextMeasurer, o: ScGridWindowOverlays = {}): void {
  if (nPaneW <= 0 || nPaneH <= 0) return;
  const rDoc = rViewData.GetDocument();
  const nTab = rViewData.CurrentTabForData();
  const rOpts = rViewData.GetOptions();
  const colors = { ...DEFAULT_GRID_COLORS, ...o.colors };

  const eHWhich = WhichH(eWhich);
  const eVWhich = WhichV(eWhich);
  const nX1 = rViewData.GetPosX(eHWhich);
  const nY1 = rViewData.GetPosY(eVWhich);
  let nX2 = nX1 + rViewData.CellsAtX(nX1, 1, eHWhich, nPaneW) + 1;
  let nY2 = nY1 + rViewData.CellsAtY(nY1, 1, eVWhich, nPaneH) + 1;
  if (nX2 > rDoc.MaxCol()) nX2 = rDoc.MaxCol();
  if (nY2 > rDoc.MaxRow()) nY2 = rDoc.MaxRow();

  ctx.save();
  ctx.beginPath();
  ctx.rect(nPaneX, nPaneY, nPaneW, nPaneH);
  ctx.clip();

  // DrawContent
  const bFormulaMode = rOpts.GetOption(ViewOption.FORMULAS);
  const aTabInfo = new ScTableInfo(nY1, nY2, true);
  FillInfo(rDoc, aTabInfo, nX1, nY1, nX2, nY2, nTab, rViewData.GetPPTX(), rViewData.GetPPTY(), false, bFormulaMode, rViewData.GetMarkData());

  const aOutputData = new ScOutputData(ctx, ScOutputType.OUTTYPE_WINDOW, aTabInfo, rDoc, nTab, nPaneX, nPaneY, nX1, nY1, nX2, nY2, rViewData.GetPPTX(), rViewData.GetPPTY(), pMeasurer);
  aOutputData.maDocColor = colors.doc;
  aOutputData.SetGridColor(rOpts.GetGridColor() || colors.grid);
  aOutputData.SetShowNullValues(rOpts.GetOption(ViewOption.NULLVALS));
  aOutputData.SetShowFormulas(bFormulaMode);
  aOutputData.SetMarkClipped(true); // Office.Calc/Content/Display/ClipMarks
  if (o.editCell) aOutputData.SetEditCell(o.editCell.nCol, o.editCell.nRow);

  const bGrid = rOpts.GetOption(ViewOption.GRID) && rViewData.IsGridMode();
  const bGridFirst = !rOpts.GetOption(ViewOption.GRID_ONTOP);

  aOutputData.DrawDocumentBackground();
  // The texts decide which grid lines they hide (bHideGrid), so they are laid out before the grid
  // is drawn: upstream's LayoutStrings runs before DrawGrid for the same reason.
  // Lay out the strings first on a context that draws nothing, to set bHideGrid.
  const nullCtx = NullContext();
  const aLayout = new ScOutputData(nullCtx, ScOutputType.OUTTYPE_WINDOW, aTabInfo, rDoc, nTab, nPaneX, nPaneY, nX1, nY1, nX2, nY2, rViewData.GetPPTX(), rViewData.GetPPTY(), pMeasurer);
  aLayout.SetShowNullValues(rOpts.GetOption(ViewOption.NULLVALS));
  aLayout.SetShowFormulas(bFormulaMode);
  if (o.editCell) aLayout.SetEditCell(o.editCell.nCol, o.editCell.nRow);
  aLayout.DrawStrings();
  // grid lines first: cell backgrounds cover them
  if (bGridFirst && bGrid) aOutputData.DrawGrid(true);
  aOutputData.DrawBackground();
  aOutputData.DrawFrame();
  // the clip marks were set while laying out; the real drawing sets them again
  for (let i = 0; i < aTabInfo.mnArrCount; i++) {
    const r = aTabInfo.mpRowInfo[i]!;
    for (let c = nX1; c <= nX2; c++) r.cellInfo(c).nClipMark = 0;
  }
  aOutputData.DrawStrings();
  aOutputData.DrawEdit();
  aOutputData.DrawClipMarks();
  if (!bGridFirst && bGrid) aOutputData.DrawGrid(true);

  DrawButtons(ctx, rViewData, eWhich, nX1, nX2, aTabInfo, nPaneX, nPaneY, colors, o.listValPos ?? null);

  // --- overlays ---
  const rect = (r: ScRange) => { const p = GetRangePixelRect(rViewData, r, eWhich); return { x: p.x + nPaneX, y: p.y + nPaneY, w: p.w, h: p.h }; };

  // the selection (without the cursor's cell when it is a single range)
  const rMark = rViewData.GetMarkData();
  if (rMark.IsMarked() || rMark.IsMultiMarked()) {
    const aRanges = rViewData.GetMultiArea();
    ctx.fillStyle = colors.selection;
    for (const r of aRanges) {
      if (r.aStart.Tab() !== nTab && rMark.GetSelectCount() <= 1 && r.aStart.Tab() !== r.aEnd.Tab()) continue;
      const p = rect(r);
      ctx.fillRect(p.x, p.y, p.w, p.h);
    }
    if (aRanges.size() === 1) {
      const p = rect(aRanges.at(0));
      ctx.fillStyle = colors.selectionBorder;
      ctx.fillRect(p.x - 1, p.y - 1, p.w + 1, 1); ctx.fillRect(p.x - 1, p.y + p.h - 1, p.w + 1, 1);
      ctx.fillRect(p.x - 1, p.y - 1, 1, p.h + 1); ctx.fillRect(p.x + p.w - 1, p.y - 1, 1, p.h + 1);
    }
  }

  // the range finder's references
  for (const f of o.rangeFinder ?? []) {
    if (f.aRef.aStart.Tab() !== nTab) continue;
    const p = rect(f.aRef);
    ctx.fillStyle = f.nColor;
    ctx.fillRect(p.x - 1, p.y - 1, p.w + 1, 2); ctx.fillRect(p.x - 1, p.y + p.h - 2, p.w + 1, 2);
    ctx.fillRect(p.x - 1, p.y - 1, 2, p.h + 1); ctx.fillRect(p.x + p.w - 2, p.y - 1, 2, p.h + 1);
    // the handle to resize the reference
    ctx.fillRect(p.x + p.w - 4, p.y + p.h - 4, 5, 5);
  }

  // the copied cells
  if (o.copySource && o.copySource.aStart.Tab() === nTab) {
    const p = rect(o.copySource);
    ctx.save();
    ctx.strokeStyle = colors.selectionBorder;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.rect(p.x, p.y, p.w - 1, p.h - 1);
    ctx.stroke();
    ctx.restore();
  }

  // the cell cursor (not while a reference is picked, then the reference rectangle shows)
  {
    const c = GetCursorPixelRect(rViewData, eWhich);
    const x = c.x + nPaneX, y = c.y + nPaneY;
    ctx.fillStyle = colors.cursor;
    ctx.fillRect(x - 2, y - 2, c.w + 3, 2); ctx.fillRect(x - 2, y + c.h - 2, c.w + 3, 2);
    ctx.fillRect(x - 2, y - 2, 2, c.h + 3); ctx.fillRect(x + c.w - 2, y - 2, 2, c.h + 3);
  }

  // the AutoFill handle, at the bottom right of the selection (or the cursor)
  if (!o.editCell && !rMark.IsMultiMarked()) {
    const r = rViewData.GetSimpleArea().rRange;
    const p = rect(r);
    ctx.fillStyle = colors.doc;
    ctx.fillRect(p.x + p.w - SC_AUTOFILL_HANDLE / 2 - 2, p.y + p.h - SC_AUTOFILL_HANDLE / 2 - 2, SC_AUTOFILL_HANDLE + 2, SC_AUTOFILL_HANDLE + 2);
    ctx.fillStyle = colors.cursor;
    ctx.fillRect(p.x + p.w - SC_AUTOFILL_HANDLE / 2 - 1, p.y + p.h - SC_AUTOFILL_HANDLE / 2 - 1, SC_AUTOFILL_HANDLE, SC_AUTOFILL_HANDLE);
  }

  // the drag rectangle of AutoFill and of a reference being picked with the mouse
  if (rViewData.IsRefMode() && rViewData.GetRefStartZ() === nTab && (rViewData.GetFillMode() !== ScFillMode.NONE || rViewData.GetRefType() === ScRefType.SC_REFTYPE_FILL)) {
    const r = new ScRange(rViewData.GetRefStartX(), rViewData.GetRefStartY(), nTab, rViewData.GetRefEndX(), rViewData.GetRefEndY(), nTab);
    r.PutInOrder();
    const p = rect(r);
    ctx.save();
    ctx.strokeStyle = colors.cursor;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.rect(p.x - 0.5, p.y - 0.5, p.w, p.h);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

/** The popup button's rectangle in a cell's box (ScDPFieldButton::getPopupBoundingBox): at
    most 18 pixels square, at the bottom right (left with bPopupLeft). */
export function GetPopupBoundingBox(x: number, y: number, w: number, h: number, fZoomY: number, bPopupLeft = false): { x: number; y: number; w: number; h: number } {
  const fScaleFactor = 1;
  const nMaxSize = 18 * fScaleFactor; // Button max size in either dimension

  let nW = Math.min(Math.trunc(w / 2), nMaxSize);
  let nH = Math.min(h, nMaxSize);

  const fZoom = fZoomY > 1.0 ? fZoomY : 1.0;
  if (fZoom > 1.0) {
    nW = Math.trunc(fZoom * (nW - 1));
    nH = Math.trunc(fZoom * (nH - 1));
  }

  // #i114944# AutoFilter button is left-aligned in RTL.
  // DataPilot button is always right-aligned for now, so text output isn't affected.
  const rx = bPopupLeft ? x : x + w - nW;
  const ry = y + h - nH;
  return { x: rx, y: ry, w: nW, h: nH };
}

/** The AutoFilter button's box of a cell, from the pane's origin (DoAutoFilterButton's
    geometry): the merged width, the single row's height. */
export function GetAutoFilterButtonRect(rViewData: ScViewData, nCol: SCCOL, nRow: SCROW, eWhich: ScSplitPos): { x: number; y: number; w: number; h: number } {
  const rDoc = rViewData.GetDocument();
  const nTab = rViewData.CurrentTabForData();
  const aScrPos = rViewData.GetScrPos(nCol, nRow, eWhich, true);
  const { rSizeXPix: nSizeX } = rViewData.GetMergeSizePixel(nCol, nRow);
  // The button height should not use the merged cell height, should still use single row height
  const nSizeY = ScViewDataToPixel(rDoc.GetRowHeight(nRow, nTab), rViewData.GetPPTY());
  return GetPopupBoundingBox(aScrPos.X, aScrPos.Y, nSizeX - 1, nSizeY - 1, rViewData.GetZoomY());
}

function ScViewDataToPixel(nTwips: number, nFactor: number): number {
  let nRet = Math.trunc(nTwips * nFactor);
  if (!nRet && nTwips) nRet = 1;
  return nRet;
}

/** Draw the popup button (ScDPFieldButton::drawPopupButton). */
function drawPopupButton(ctx: ScRenderContext, r: { x: number; y: number; w: number; h: number }, bHasHiddenMember: boolean, colors: ScGridColors): void {
  const fScaleFactor = 1;
  // Button background color
  const aFaceColor = colors.buttonFace;
  const aBackgroundColor = bHasHiddenMember ? colors.selectionBorder : aFaceColor;

  ctx.fillStyle = colors.buttonLine;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = aBackgroundColor;
  ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);

  // the arrowhead
  const aArrowColor = bHasHiddenMember ? '#ffffff' : colors.buttonText;
  ctx.fillStyle = aArrowColor;
  const cx = r.x + Math.trunc(r.w / 2), cy = r.y + Math.trunc(r.h / 2);
  const aw = 4 * fScaleFactor, ah = 2 * fScaleFactor;
  ctx.beginPath();
  ctx.moveTo(cx - aw, cy - ah);
  ctx.lineTo(cx + aw, cy - ah);
  ctx.lineTo(cx, cy + ah);
  ctx.closePath();
  ctx.fill();

  if (bHasHiddenMember) {
    // tiny little box to display in presence of hidden member(s).
    ctx.fillRect(r.x + r.w - 5 * fScaleFactor, r.y + r.h - 5 * fScaleFactor, 3 * fScaleFactor, 3 * fScaleFactor);
  }
}

/** The AutoFilter buttons of the visible rows and the validity list's button (DrawButtons). */
function DrawButtons(ctx: ScRenderContext, rViewData: ScViewData, eWhich: ScSplitPos, nX1: SCCOL, nX2: SCCOL, rTabInfo: ScTableInfo, nPaneX: number, nPaneY: number, colors: ScGridColors, aListValPos: { nCol: SCCOL; nRow: SCROW } | null): void {
  const rDoc = rViewData.GetDocument();
  const nTab = rViewData.CurrentTabForData();
  let pDBData: ScDBData | null = null;
  let pQueryParam: ScQueryParam | null = null;

  const pRowInfo = rTabInfo.mpRowInfo;
  const nArrCount = rTabInfo.mnArrCount;

  for (let nArrY = 1; nArrY + 1 < nArrCount; nArrY++) {
    const pThisRowInfo = pRowInfo[nArrY]!;
    if (pThisRowInfo.bAutoFilter && pThisRowInfo.bChanged) {
      const nRow = pThisRowInfo.nRowNo;

      for (let nCol = nX1; nCol <= nX2; nCol++) {
        const pInfo = pThisRowInfo.cellInfo(nCol);
        //if several columns merged on a row, there should be only one auto button at the end of the columns.
        //if several rows merged on a column, the button may be in the middle, so "!pInfo->bVOverlapped" should not be used
        if (pInfo.bAutoFilter && !pInfo.bHOverlapped) {
          let bNewData = true;
          if (pDBData) {
            const a = pDBData.GetAreaVars();
            if (nCol >= a.nCol1 && nCol <= a.nCol2 && nRow >= a.nRow1 && nRow <= a.nRow2) bNewData = false;
          }
          if (bNewData) {
            pDBData = rDoc.GetDBAtCursor(nCol, nRow, nTab, ScDBDataPortion.AREA);
            pQueryParam = pDBData ? pDBData.GetQueryParam() : new ScQueryParam();
            // (can also be part of DataPilot table)
          }

          let bArrowState = false;
          if (pQueryParam && pQueryParam.bInplace) {
            const nCount = pQueryParam.GetEntryCount();
            for (let nQuery = 0; nQuery < nCount; ++nQuery) {
              //  Do no restrict to EQUAL here
              //  (Column head should become blue also when ">1")
              const rEntry = pQueryParam.GetEntry(nQuery);
              if (rEntry.bDoQuery && rEntry.nField === nCol) {
                bArrowState = true;
                break;
              }
            }
          }

          const r = GetAutoFilterButtonRect(rViewData, nCol, nRow, eWhich);
          drawPopupButton(ctx, { x: r.x + nPaneX, y: r.y + nPaneY, w: r.w, h: r.h }, bArrowState, colors);
        }
      }
    }

    if (aListValPos && pThisRowInfo.nRowNo === aListValPos.nRow && pThisRowInfo.bChanged) {
      const r = GetListValButtonRect(rViewData, aListValPos.nCol, aListValPos.nRow, eWhich);
      drawPopupButton(ctx, { x: r.x + nPaneX, y: r.y + nPaneY, w: r.w, h: r.h }, false, colors);
    }
  }
}

/** The validity list button's box, next to the cell's right edge (GetListValButtonRect). */
export function GetListValButtonRect(rViewData: ScViewData, nCol: SCCOL, nRow: SCROW, eWhich: ScSplitPos): { x: number; y: number; w: number; h: number } {
  const aPos = rViewData.GetScrPos(nCol, nRow, eWhich, true);
  const { rSizeXPix: nSizeX, rSizeYPix: nSizeY } = rViewData.GetMergeSizePixel(nCol, nRow);
  // the button is a square of the row's height (at most 18 pixels) beside the cell
  const nBtnSize = Math.min(nSizeY, 18);
  return { x: aPos.X + nSizeX, y: aPos.Y + nSizeY - nBtnSize, w: nBtnSize, h: nBtnSize };
}

/** A context that draws nothing (for laying the strings out before the grid is drawn). */
function NullContext(): ScRenderContext {
  const nop = () => {};
  return {
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '',
    save: nop, restore: nop, beginPath: nop, closePath: nop, rect: nop, clip: nop, fill: nop, stroke: nop, moveTo: nop, lineTo: nop,
    fillRect: nop, fillText: nop, translate: nop, scale: nop, setLineDash: nop,
  };
}
