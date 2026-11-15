// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/view/gridwin4.cxx reduced
// @upstream sc/source/ui/view/gridwin.cxx partial
// ScGridWindow::Draw / DrawContent: paints one pane of the view: the visible cells through
// ScDocument::FillInfo and ScOutputData (background, grid, borders, texts), then the overlays
// upstream keeps in overlay objects: the selection (UpdateSelectionOverlay), the cell cursor
// (UpdateCursorOverlay), the AutoFill handle (UpdateAutoFillOverlay), the drag rectangle of
// AutoFill and of a reference being picked (UpdateDragRectOverlay), the formula's references in
// their colours (the range finder, PaintRangeFinder) and the marquee of copied cells
// (UpdateCopySourceOverlay). Left out: drawing objects, page breaks, notes, the visible formula
// marks and the LibreOfficeKit tile painting.
import { ScRange, type SCCOL, type SCROW } from '../../../inc/address.ts';
import { ScTableInfo } from '../../../inc/fillinfo.ts';
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
}

export interface ScGridColors { doc: string; grid: string; selection: string; selectionBorder: string; cursor: string; handle: string }
export const DEFAULT_GRID_COLORS: ScGridColors = { doc: '#ffffff', grid: '#c0c0c0', selection: 'rgba(42, 107, 201, 0.16)', selectionBorder: '#2a6bc9', cursor: '#000000', handle: '#2a6bc9' };

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

/** A context that draws nothing (for laying the strings out before the grid is drawn). */
function NullContext(): ScRenderContext {
  const nop = () => {};
  return {
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '',
    save: nop, restore: nop, beginPath: nop, closePath: nop, rect: nop, clip: nop, fill: nop, stroke: nop, moveTo: nop, lineTo: nop,
    fillRect: nop, fillText: nop, translate: nop, scale: nop, setLineDash: nop,
  };
}
