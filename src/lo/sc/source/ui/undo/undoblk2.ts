// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/undo/undoblk2.cxx reduced
// ScUndoWidthOrHeight: undo of column widths and row heights. Redo calls ScDocFunc's
// SetWidthOrHeight without recording (upstream goes through the view, which then also selects
// the sheet). Outlines, the drawing layer and the LOK notifications are left out.
import type { SCCOLROW, SCTAB } from '../../../inc/address.ts';
import { ScRange } from '../../../inc/address.ts';
import { InsertDeleteFlags, ScSizeMode } from '../../../inc/global.ts';
import type { ScMarkData } from '../../../inc/markdata.ts';
import type { ScDocument } from '../../core/data/document.ts';
import { PaintPartFlags, type ScDocShell } from '../docshell/docsh.ts';
import type { ColRowSpan } from '../docshell/docfunc.ts';
import { ScSimpleUndo } from './undobase.ts';

const STR_UNDO_OPTCOLWIDTH = 'Optimal Column Width';
const STR_UNDO_COLWIDTH = 'Column Width';
const STR_UNDO_OPTROWHEIGHT = 'Optimal Row Height';
const STR_UNDO_ROWHEIGHT = 'Row Height';

export class ScUndoWidthOrHeight extends ScSimpleUndo {
  private aMarkData: ScMarkData;
  private nStart: SCCOLROW;
  private nEnd: SCCOLROW;
  private nStartTab: SCTAB;
  private nEndTab: SCTAB;
  private pUndoDoc: ScDocument;
  private maRanges: ColRowSpan[];
  private nNewSize: number;
  private bWidth: boolean;
  private eMode: ScSizeMode;

  constructor(rNewDocShell: ScDocShell, rMark: ScMarkData, nNewStart: SCCOLROW, nNewStartTab: SCTAB, nNewEnd: SCCOLROW, nNewEndTab: SCTAB, pNewUndoDoc: ScDocument, rRanges: ColRowSpan[], eNewMode: ScSizeMode, nNewSizeTwips: number, bNewWidth: boolean) {
    super(rNewDocShell);
    this.aMarkData = rMark.clone();
    this.nStart = nNewStart;
    this.nEnd = nNewEnd;
    this.nStartTab = nNewStartTab;
    this.nEndTab = nNewEndTab;
    this.pUndoDoc = pNewUndoDoc;
    this.maRanges = rRanges.map((r) => ({ ...r }));
    this.nNewSize = nNewSizeTwips;
    this.bWidth = bNewWidth;
    this.eMode = eNewMode;
  }

  override GetComment(): string {
    // [ "optimal " ] "Column width" | "row height"
    return this.bWidth ? (this.eMode === ScSizeMode.SC_SIZE_OPTIMAL ? STR_UNDO_OPTCOLWIDTH : STR_UNDO_COLWIDTH) : this.eMode === ScSizeMode.SC_SIZE_OPTIMAL ? STR_UNDO_OPTROWHEIGHT : STR_UNDO_ROWHEIGHT;
  }

  override Undo(): void {
    this.BeginUndo();

    const rDoc = this.rDocShell.GetDocument();
    const nPaintStart = this.nStart > 0 ? this.nStart - 1 : 0;

    const nTabCount = rDoc.GetTableCount();
    for (const rTab of this.aMarkData) {
      if (rTab >= nTabCount) break;

      if (this.bWidth) {
        // Width
        this.pUndoDoc.CopyToDocument(new ScRange(this.nStart, 0, rTab, this.nEnd, rDoc.MaxRow(), rTab), InsertDeleteFlags.NONE, false, rDoc);
        this.rDocShell.PostPaint(nPaintStart, 0, rTab, rDoc.MaxCol(), rDoc.MaxRow(), rTab, PaintPartFlags.Grid | PaintPartFlags.Top);
      } else {
        // Height
        this.pUndoDoc.CopyToDocument(new ScRange(0, this.nStart, rTab, rDoc.MaxCol(), this.nEnd, rTab), InsertDeleteFlags.NONE, false, rDoc);
        this.rDocShell.PostPaint(0, nPaintStart, rTab, rDoc.MaxCol(), rDoc.MaxRow(), rTab, PaintPartFlags.Grid | PaintPartFlags.Left);
      }
    }

    void this.nStartTab; void this.nEndTab;
    this.EndUndo();
  }

  override Redo(): void {
    this.BeginRedo();

    // SetWidthOrHeight changes current sheet!
    for (const rTab of this.aMarkData) this.rDocShell.GetDocFunc().SetWidthOrHeight(this.bWidth, this.maRanges, rTab, this.eMode, this.nNewSize, false, true);

    this.EndRedo();
  }
}
