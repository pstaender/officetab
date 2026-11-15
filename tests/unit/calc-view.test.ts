// The view logic of Calc: ScViewData's pixel mapping, FillInfo and ScOutputData's text overflow,
// ScTabView's cursor movement and selection, and the input handler's helpers.
import { describe, expect, it } from 'vitest';
import { ScDocShell } from '../../src/lo/sc/source/ui/docshell/docsh.ts';
import { ScAddress, ScRange } from '../../src/lo/sc/inc/address.ts';
import { ScInputOptions } from '../../src/lo/sc/inc/inputopt.ts';
import { ScDirection, InsertDeleteFlags } from '../../src/lo/sc/inc/global.ts';
import { ScTabViewShell } from '../../src/lo/sc/source/ui/view/tabvwsh.ts';
import { SC_SPLIT_BOTTOMLEFT, SC_SPLIT_BOTTOMRIGHT, SC_SPLIT_LEFT, SC_SPLIT_RIGHT, ScFollowMode, ScSplitMode, ScViewData } from '../../src/lo/sc/source/ui/view/viewdata.ts';
import { ScTableInfo } from '../../src/lo/sc/inc/fillinfo.ts';
import { FillInfo } from '../../src/lo/sc/source/core/data/fillinfo.ts';
import { ScOutputData, ScOutputType, type ScRenderContext, BreakLines } from '../../src/lo/sc/source/ui/view/output.ts';
import type { TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';
import { GetArgumentsTip, GetAutoInputCompletion, GetAutoSumArea, GetFunctionAtCaret, GetReferenceAt, InitRangeFinder, IsRefInputPosition, UseFormulaData } from '../../src/lo/sc/source/ui/app/inputhdl.ts';
import { ToggleRel } from '../../src/lo/sc/source/core/tool/reffind.ts';
import { GetFunction } from '../../src/lo/sc/source/ui/view/tabvwsha.ts';

const { SC_FOLLOW_LINE, SC_FOLLOW_JUMP } = ScFollowMode;

function view(opts = new ScInputOptions()) {
  const sh = new ScDocShell();
  const v = new ScTabViewShell(sh, () => opts);
  const vd = v.GetViewData();
  vd.SetScrSize(1000, 600);
  return { sh, doc: sh.GetDocument(), v, vd };
}

/** A measurer with a fixed width per character (in twips at the font's size: 0.5 em). */
const measurer: TextMeasurer = {
  GetTextWidth: (font, text) => text.length * font.size * 0.5,
  GetFontMetric: (font) => ({ ascent: Math.round(font.size * 0.9), descent: Math.round(font.size * 0.25) }),
};

function nullContext(): ScRenderContext & { texts: string[] } {
  const nop = () => {};
  const texts: string[] = [];
  return {
    texts, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '',
    save: nop, restore: nop, beginPath: nop, closePath: nop, rect: nop, clip: nop, fill: nop, stroke: nop, moveTo: nop, lineTo: nop,
    fillRect: nop, fillText: (t: string) => { texts.push(t); }, translate: nop, scale: nop, setLineDash: nop,
  };
}

describe('ScViewData', () => {
  it('converts twips to pixels at 96 DPI, at least one pixel', () => {
    expect(ScViewData.ToPixel(1280, 1 / 15)).toBe(85);
    expect(ScViewData.ToPixel(255, 1 / 15)).toBe(17);
    expect(ScViewData.ToPixel(5, 1 / 15)).toBe(1);
    expect(ScViewData.ToPixel(0, 1 / 15)).toBe(0);
  });

  it('maps cells to screen positions and back', () => {
    const { vd } = view();
    expect(vd.GetScrPos(2, 3, SC_SPLIT_BOTTOMLEFT)).toEqual({ X: 170, Y: 51 });
    expect(vd.GetPosFromPixel(171, 52, SC_SPLIT_BOTTOMLEFT)).toEqual({ rPosX: 2, rPosY: 3 });
    expect(vd.GetPosFromPixel(169, 50, SC_SPLIT_BOTTOMLEFT)).toEqual({ rPosX: 1, rPosY: 2 });
    // eleven columns of 85 pixels and 35 rows of 17 fit a 1000 × 600 window (CellsAtX counts whole ones)
    expect(vd.VisibleCellsX(SC_SPLIT_LEFT)).toBe(11);
    expect(vd.VisibleCellsY(1)).toBe(35);
  });

  it('follows widths, heights and hidden rows; scrolling keeps the pixel offset', () => {
    const { doc, vd } = view();
    doc.SetColWidth(0, 0, 2880);
    doc.SetRowHidden(1, 4, 0, true);
    vd.RecalcPixPos();
    expect(vd.GetScrPos(1, 5, SC_SPLIT_BOTTOMLEFT)).toEqual({ X: 192, Y: 17 });
    vd.SetPosY(1, 10);
    expect(vd.GetPixPosY(1)).toBe(-17 * 6);
    expect(vd.GetRowPixelOffset(10)).toBe(17 * 6);
    expect(vd.GetRowAtPixelOffset(17 * 6 + 3)).toBe(10);
    expect(vd.GetScrPos(12, 12, SC_SPLIT_BOTTOMLEFT).Y).toBe(34);
    vd.SetZoom(2, 2);
    expect(vd.GetScrPos(1, 0, SC_SPLIT_BOTTOMLEFT).X).toBe(384);
  });

  it('gives a merged cell its whole size', () => {
    const { doc, vd } = view();
    doc.DoMerge(1, 1, 2, 3, 0);
    expect(vd.GetMergeSizePixel(1, 1)).toEqual({ rSizeXPix: 170, rSizeYPix: 51, bMerged: true });
    // a click in the merged area lands on its origin
    expect(vd.GetPosFromPixel(200, 60, SC_SPLIT_BOTTOMLEFT)).toEqual({ rPosX: 1, rPosY: 1 });
  });
});

describe('FillInfo and ScOutputData', () => {
  it('lets a long text overflow into empty neighbours, hiding their grid lines, and stops at a filled cell', () => {
    const { doc } = view();
    doc.SetString(new ScAddress(0, 0, 0), 'A rather long text that does not fit in three columns at all');
    doc.SetString(new ScAddress(3, 0, 0), 'stop');
    doc.SetValue(new ScAddress(0, 1, 0), 123456789012);
    const info = new ScTableInfo(0, 5);
    FillInfo(doc, info, 0, 0, 5, 5, 0, 1 / 15, 1 / 15, false, false);
    expect(info.mpRowInfo[1]!.nRowNo).toBe(0);
    expect(info.mpRowInfo[1]!.basicCellInfo(0).bEmptyCellText).toBe(false);
    const ctx = nullContext();
    const out = new ScOutputData(ctx, ScOutputType.OUTTYPE_WINDOW, info, doc, 0, 0, 0, 0, 0, 5, 5, 1 / 15, 1 / 15, measurer);
    out.SetMarkClipped(true);
    out.DrawStrings();
    const row = info.mpRowInfo[1]!;
    expect(row.cellInfo(0).bHideGrid).toBe(true);
    expect(row.cellInfo(1).bHideGrid).toBe(true);
    expect(row.cellInfo(2).bHideGrid).toBe(false);
    // the text is clipped before D1: a clip mark on C1
    expect(row.cellInfo(2).nClipMark).not.toBe(0);
    // a number never overflows: shown with fewer digits, or ###
    expect(info.mpRowInfo[2]!.cellInfo(1).bHideGrid).toBe(false);
    expect(ctx.texts).toContain('stop');
    expect(ctx.texts.some((t) => /^1\.2+E\+11$|^###$|^1234/.test(t))).toBe(true);
  });

  it('right-aligns numbers and breaks wrapped text into lines', () => {
    const lines = BreakLines('one two three four', 8, (s) => s.length);
    expect(lines).toEqual(['one two', 'three', 'four']);
    expect(BreakLines('abcdefghijk', 4, (s) => s.length)).toEqual(['abcd', 'efgh', 'ijk']);
  });

  it('copies a merged origin\'s background to the covered cells', () => {
    const { doc } = view();
    doc.ApplyPatternAreaTab(0, 0, 0, 0, 0, { ATTR_BACKGROUND: '#ff0000' });
    doc.DoMerge(0, 0, 1, 1, 0);
    const info = new ScTableInfo(0, 3);
    FillInfo(doc, info, 0, 0, 3, 3, 0, 1 / 15, 1 / 15, false, false);
    expect(info.mpRowInfo[2]!.cellInfo(1).maBackground).toBe('#ff0000');
    expect(info.mpRowInfo[2]!.cellInfo(1).bHOverlapped).toBe(true);
  });
});

describe('ScTabView', () => {
  it('moves with Ctrl+arrows to the edges of the data', () => {
    const { doc, v, vd } = view();
    for (const r of [0, 1, 2, 5, 6]) doc.SetValue(new ScAddress(0, r, 0), r);
    v.MoveCursorArea(0, 1, SC_FOLLOW_JUMP, false);
    expect(vd.GetCurY()).toBe(2);
    v.MoveCursorArea(0, 1, SC_FOLLOW_JUMP, false);
    expect(vd.GetCurY()).toBe(5);
    v.MoveCursorArea(0, 1, SC_FOLLOW_JUMP, false);
    expect(vd.GetCurY()).toBe(6);
    v.MoveCursorArea(0, 1, SC_FOLLOW_JUMP, false);
    expect(vd.GetCurY()).toBe(doc.MaxRow());
    // the view scrolled to keep the cursor visible
    expect(vd.GetPosY(1)).toBeGreaterThan(doc.MaxRow() - 40);
    v.MoveCursorEnd(-1, -1, SC_FOLLOW_LINE, false);
    expect([vd.GetCurX(), vd.GetCurY()]).toEqual([0, 0]);
    expect(vd.GetPosY(1)).toBe(0);
    v.MoveCursorEnd(1, 1, SC_FOLLOW_JUMP, false);
    expect([vd.GetCurX(), vd.GetCurY()]).toEqual([0, 6]);
  });

  it('extends the selection with Shift from the anchor, which keeps the cursor', () => {
    const { v, vd } = view();
    v.ExpandBlock(1, 0, SC_FOLLOW_LINE);
    v.ExpandBlock(0, 2, SC_FOLLOW_LINE);
    expect(vd.GetMarkData().GetMarkArea().equals(new ScRange(0, 0, 0, 1, 2, 0))).toBe(true);
    expect([vd.GetCurX(), vd.GetCurY()]).toEqual([0, 0]);
    v.MoveCursorRel(0, 1, SC_FOLLOW_LINE, false);
    expect(vd.GetMarkData().IsMarked()).toBe(false);
  });

  it('moves Enter within the selection, and back to Tab\'s start column', () => {
    const { v, vd } = view();
    v.MarkRange(new ScRange(1, 1, 0, 2, 2, 0));
    expect([vd.GetCurX(), vd.GetCurY()]).toEqual([1, 1]);
    v.MoveCursorEnter(false);
    expect([vd.GetCurX(), vd.GetCurY()]).toEqual([1, 2]);
    v.MoveCursorEnter(false);
    expect([vd.GetCurX(), vd.GetCurY()]).toEqual([2, 1]);
    v.Unmark();
    v.MoveCursorAbs(0, 5, SC_FOLLOW_LINE, false, false);
    v.MoveCursorTab(false);
    v.MoveCursorTab(false);
    expect(vd.GetCurX()).toBe(2);
    v.MoveCursorEnter(false);
    expect([vd.GetCurX(), vd.GetCurY()]).toEqual([0, 6]);
  });

  it('follows Enter\'s direction from the options', () => {
    const opts = new ScInputOptions();
    opts.SetMoveDir(ScDirection.DIR_RIGHT);
    const { v, vd } = view(opts);
    v.MoveCursorEnter(false);
    expect([vd.GetCurX(), vd.GetCurY()]).toEqual([1, 0]);
    opts.SetMoveSelection(false);
    expect(v.MoveCursorEnter(false)).toBe(false);
  });

  it('skips over merged cells and marks whole columns and rows', () => {
    const { doc, v, vd } = view();
    doc.DoMerge(1, 0, 2, 0, 0);
    v.MoveCursorRel(1, 0, SC_FOLLOW_LINE, false);
    v.MoveCursorRel(1, 0, SC_FOLLOW_LINE, false);
    expect(vd.GetCurX()).toBe(3);
    v.MarkColumns(4);
    expect(vd.SimpleColMarked()).toBe(true);
    v.MarkRows(3);
    expect(vd.SimpleRowMarked()).toBe(true);
  });

  it('freezes panes at the cursor and keeps the fixed part when scrolling', () => {
    const { v, vd } = view();
    v.MoveCursorAbs(2, 3, SC_FOLLOW_LINE, false, false);
    v.FreezeSplitters(true);
    expect(vd.GetHSplitMode()).toBe(ScSplitMode.SC_SPLIT_FIX);
    expect([vd.GetFixPosX(), vd.GetFixPosY()]).toEqual([2, 3]);
    expect(vd.GetHSplitPos()).toBe(170);
    v.ScrollY(-5, 1);
    expect(vd.GetPosY(1)).toBe(3);
    v.MoveCursorAbs(40, 3, SC_FOLLOW_LINE, false, false);
    expect(vd.GetActivePart()).toBe(SC_SPLIT_BOTTOMRIGHT);
    expect(vd.GetPosX(SC_SPLIT_RIGHT)).toBeGreaterThan(2);
    v.RemoveSplit();
    expect(vd.GetHSplitMode()).toBe(ScSplitMode.SC_SPLIT_NONE);
  });

  it('enters data, deletes contents and undoes through the document functions', () => {
    const { sh, doc, v, vd } = view();
    v.EnterData(0, 0, 0, '5');
    v.EnterData(0, 1, 0, '=A1*2');
    expect(doc.GetString(new ScAddress(0, 1, 0))).toBe('10');
    v.MarkRange(new ScRange(0, 0, 0, 0, 1, 0));
    v.DeleteContents(InsertDeleteFlags.CONTENTS);
    expect(doc.GetString(new ScAddress(0, 0, 0))).toBe('');
    sh.GetUndoManager().Undo();
    expect(doc.GetString(new ScAddress(0, 1, 0))).toBe('10');
    vd.GetMarkData().ResetMark();
  });

  it('copies and pastes a clip document with relative references moved', () => {
    const { doc, v } = view();
    v.EnterData(0, 0, 0, '1');
    v.EnterData(0, 1, 0, '=A1+1');
    v.MarkRange(new ScRange(0, 1, 0, 0, 1, 0));
    const clip = v.CopyToClip()!;
    v.Unmark();
    v.MoveCursorAbs(2, 4, SC_FOLLOW_LINE, false, false);
    v.PasteFromClip(InsertDeleteFlags.ALL, clip);
    expect(doc.GetFormula(new ScAddress(2, 4, 0))).toBe('=C4+1');
  });

  it('finds and replaces text', () => {
    const { doc, v, vd } = view();
    v.EnterData(0, 0, 0, 'apple');
    v.EnterData(1, 2, 0, 'pineapple');
    const item = { aSearch: 'apple', aReplace: 'pear', nCommand: 'FIND' as const, bMatchCase: false, bWholeCell: false, bBackward: false, eCellType: 'values' as const };
    expect(v.SearchAndReplace(item)).toBe(2);
    expect([vd.GetCurX(), vd.GetCurY()]).toEqual([1, 2]);
    expect(v.SearchAndReplace({ ...item, nCommand: 'REPLACE_ALL' })).toBe(2);
    expect(doc.GetString(new ScAddress(1, 2, 0))).toBe('pinepear');
  });
});

describe('the input handler', () => {
  it('colours the references of a formula (range finder)', () => {
    const { doc } = view();
    const l = InitRangeFinder('=SUM(A1:B2)+C3+A1:B2', doc, new ScAddress(0, 5, 0))!;
    expect(l.maEntries.map((e) => [e.nSelStart, e.nSelEnd, e.nColor])).toEqual([[5, 10, '#0000ff'], [12, 14, '#ff0000'], [15, 20, '#0000ff']]);
    expect(InitRangeFinder('plain text A1', doc, new ScAddress(0, 0, 0))).toBeNull();
  });

  it('knows where a reference may be pointed at and which reference ends at the caret', () => {
    expect(IsRefInputPosition('=SUM(', 5)).toBe(true);
    expect(IsRefInputPosition('=A1+', 4)).toBe(true);
    expect(IsRefInputPosition('=SUM', 4)).toBe(false);
    expect(GetReferenceAt('=A1+B2', 6)).toEqual({ nStart: 4, nEnd: 6 });
    expect(GetReferenceAt('=SUM', 4)).toBeNull();
  });

  it('completes function names and shows the current argument', () => {
    expect(UseFormulaData('=AVER', 5)!.aNames).toContain('AVERAGE');
    expect(UseFormulaData('=A1', 3)).toBeNull();
    const f = GetFunctionAtCaret('=ROUND(A1; ', 11)!;
    expect(f.pDesc.getFunctionName()).toBe('ROUND');
    expect(f.nArg).toBe(1);
    expect(GetArgumentsTip(f.pDesc, f.nArg).aSig).toMatch(/^ROUND\(/);
  });

  it('offers AutoInput from the column and the AutoSum range above or left', () => {
    const { doc } = view();
    doc.SetString(new ScAddress(0, 0, 0), 'Banana');
    doc.SetString(new ScAddress(0, 1, 0), 'Blueberry');
    expect(GetAutoInputCompletion(doc, 0, 2, 0, 'bl')).toBe('Blueberry');
    expect(GetAutoInputCompletion(doc, 0, 2, 0, '1')).toBeNull();
    doc.SetValue(new ScAddress(1, 0, 0), 1);
    doc.SetValue(new ScAddress(1, 1, 0), 2);
    expect(GetAutoSumArea(doc, 1, 2, 0)!.equals(new ScRange(1, 0, 0, 1, 1, 0))).toBe(true);
    expect(GetAutoSumArea(doc, 2, 1, 0)!.equals(new ScRange(1, 1, 0, 1, 1, 0))).toBe(true);
  });

  it('toggles a reference through absolute and relative (F4)', () => {
    const { doc } = view();
    const p = new ScAddress(0, 0, 0);
    let r = ToggleRel('=A1+B2', 2, 2, doc, p)!;
    expect(r.text).toBe('=$A$1+B2');
    r = ToggleRel(r.text, 2, 2, doc, p)!;
    expect(r.text).toBe('=A$1+B2');
    r = ToggleRel(r.text, 2, 2, doc, p)!;
    expect(r.text).toBe('=$A1+B2');
    r = ToggleRel(r.text, 2, 2, doc, p)!;
    expect(r.text).toBe('=A1+B2');
  });

  it('sums and averages the selection for the status bar', () => {
    const { v, vd } = view();
    v.EnterData(0, 0, 0, '2');
    v.EnterData(0, 1, 0, '4');
    v.EnterData(0, 2, 0, 'text');
    v.MarkRange(new ScRange(0, 0, 0, 0, 2, 0));
    expect(GetFunction(vd, (1 << 9) | (1 << 1) | (1 << 3))).toEqual([{ key: 'average', value: '3' }, { key: 'counta', value: '3' }, { key: 'sum', value: '6' }]);
  });
});
