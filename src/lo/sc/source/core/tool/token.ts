// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/token.hxx reduced
// @upstream sc/inc/tokenarray.hxx reduced
// @upstream sc/source/core/tool/token.cxx reduced
// @upstream sc/source/core/tool/rangeutl.cxx partial
// The Calc token classes (single and double references, matrices, reference lists, empty cell
// results) and ScTokenArray with the reference adjustments for inserted/deleted cells, moves and
// sheets. Left out: external references, table (structured) references, the vectorisation and
// threading checks (CheckToken, GenHash's use), column/row reorder updates, and the adjustments
// of names (AdjustReferenceInName).
import { FormulaError } from '../../../../include/formula/errorcodes.ts';
import { ocAdd, ocArrayClose, ocArrayColSep, ocArrayOpen, ocArrayRowSep, ocColRowName, ocDBArea, ocFalse, ocMatRef, ocMissing, ocName, ocNegSub, ocPush, ocRange, ocSep, ocSpaces, ocTrue, ocWhitespace, type OpCode } from '../../../../include/formula/opcode.ts';
import {
  FormulaIndexToken, FormulaToken, FormulaTokenArray, svDoubleRef, svDouble, svEmptyCell, svExternalDoubleRef, svExternalSingleRef, svIndex, svJumpMatrix, svMatrix, svRefList,
  svSingleRef, svString, svUnknown, type StackVar,
} from '../../../../formula/source/core/api/token.ts';
import { ScAddress, ScRange, type SCTAB } from '../../../inc/address.ts';
import { ScComplexRefData, ScSingleRefData } from '../../../inc/refdata.ts';
import { RefUpdateResult, type RefUpdateContext, type RefUpdateDeleteTabContext, type RefUpdateInsertTabContext, type RefUpdateMoveTabContext } from '../../../inc/refupdatecontext.ts';
import type { ScSheetLimits } from '../../../inc/sheetlimits.ts';
import { ScMatrix } from './scmatrix.ts';
import type { ScJumpMatrix } from './jumpmatrix.ts';

export type ScRefList = ScComplexRefData[];

export class ScSingleRefToken extends FormulaToken {
  private readonly mrSheetLimits: ScSheetLimits;
  private aSingleRef: ScSingleRefData;
  constructor(rLimits: ScSheetLimits, r: ScSingleRefData, e: OpCode = ocPush) {
    super(svSingleRef, e);
    this.mrSheetLimits = rLimits;
    this.aSingleRef = r;
  }
  override GetSingleRef(): ScSingleRefData { return this.aSingleRef; }
  override TextEqual(r: FormulaToken): boolean { return this.equals(r); }
  override equals(r: FormulaToken): boolean { return super.equals(r) && this.aSingleRef.equals(r.GetSingleRef()); }
  override Clone(): FormulaToken { return new ScSingleRefToken(this.mrSheetLimits, this.aSingleRef.clone(), this.eOp); }
}

export class ScDoubleRefToken extends FormulaToken {
  private readonly mrSheetLimits: ScSheetLimits;
  private aDoubleRef: ScComplexRefData;
  constructor(rLimits: ScSheetLimits, r: ScComplexRefData, e: OpCode = ocPush) {
    super(svDoubleRef, e);
    this.mrSheetLimits = rLimits;
    this.aDoubleRef = r;
  }
  override GetSingleRef(): ScSingleRefData { return this.aDoubleRef.Ref1; }
  override GetDoubleRef(): ScComplexRefData { return this.aDoubleRef; }
  override GetSingleRef2(): ScSingleRefData { return this.aDoubleRef.Ref2; }
  override TextEqual(r: FormulaToken): boolean { return this.equals(r); }
  override equals(r: FormulaToken): boolean { return super.equals(r) && this.aDoubleRef.equals(r.GetDoubleRef()); }
  override Clone(): FormulaToken { return new ScDoubleRefToken(this.mrSheetLimits, this.aDoubleRef.clone(), this.eOp); }
  GetSheetLimits(): ScSheetLimits { return this.mrSheetLimits; }
}

export class ScMatrixToken extends FormulaToken {
  private pMatrix: ScMatrix;
  constructor(p: ScMatrix) {
    super(svMatrix);
    this.pMatrix = p;
  }
  override GetMatrix(): ScMatrix { return this.pMatrix; }
  override equals(r: FormulaToken): boolean { return super.equals(r) && this.pMatrix === r.GetMatrix(); }
  override Clone(): FormulaToken { return new ScMatrixToken(this.pMatrix); }
}

/**
 * ScMatrixRangeToken: a matrix that represents a range reference (for implicit intersection of
 * array results); keeps the range next to the matrix.
 */
export class ScMatrixRangeToken extends FormulaToken {
  private mpMatrix: ScMatrix;
  private maRef: ScComplexRefData;
  constructor(pMat: ScMatrix, rRef: ScComplexRefData) {
    super(svMatrix);
    this.mpMatrix = pMat;
    this.maRef = rRef;
  }
  override GetMatrix(): ScMatrix { return this.mpMatrix; }
  override GetDoubleRef(): ScComplexRefData { return this.maRef; }
  override Clone(): FormulaToken { return new ScMatrixRangeToken(this.mpMatrix, this.maRef.clone()); }
}

/** Token storing multiple references, the result of the ocUnion operator. */
/** ScJumpMatrixToken: the jump matrix on the interpreter's stack. Only created from within the
    interpreter, never added to ScTokenArray. */
export class ScJumpMatrixToken extends FormulaToken {
  private mpJumpMatrix: ScJumpMatrix;
  constructor(p: ScJumpMatrix) {
    super(svJumpMatrix);
    this.mpJumpMatrix = p;
  }
  override GetJumpMatrix(): ScJumpMatrix { return this.mpJumpMatrix; }
  override equals(r: FormulaToken): boolean { return super.equals(r) && this.mpJumpMatrix === r.GetJumpMatrix(); }
  override Clone(): FormulaToken { return new ScJumpMatrixToken(this.mpJumpMatrix); }
}

export class ScRefListToken extends FormulaToken {
  private aRefList: ScRefList = [];
  private mbArrayResult: boolean;
  constructor(bArrayResult = false) {
    super(svRefList);
    this.mbArrayResult = bArrayResult;
  }
  IsArrayResult(): boolean { return this.mbArrayResult; }
  override GetRefList(): ScRefList { return this.aRefList; }
  override equals(r: FormulaToken): boolean {
    if (!super.equals(r)) return false;
    const b = r.GetRefList() as ScRefList;
    return b.length === this.aRefList.length && this.aRefList.every((x, i) => x.equals(b[i]!));
  }
  override Clone(): FormulaToken {
    const t = new ScRefListToken(this.mbArrayResult);
    t.aRefList = this.aRefList.map((x) => x.clone());
    return t;
  }
}

/** An empty cell in an interpreter result (LOOKUP, INDEX on an empty cell): 0 or "". */
export class ScEmptyCellToken extends FormulaToken {
  private bInherited: boolean;
  private bDisplayedAsString: boolean;
  constructor(bInheritedP: boolean, bDisplayAsString: boolean) {
    super(svEmptyCell);
    this.bInherited = bInheritedP;
    this.bDisplayedAsString = bDisplayAsString;
  }
  IsInherited(): boolean { return this.bInherited; }
  IsDisplayedAsString(): boolean { return this.bDisplayedAsString; }
  override GetDouble(): number { return 0.0; }
  override GetString(): string { return ''; }
  override equals(r: FormulaToken): boolean {
    return super.equals(r) && r instanceof ScEmptyCellToken && this.bInherited === r.bInherited && this.bDisplayedAsString === r.bDisplayedAsString;
  }
  override Clone(): FormulaToken { return new ScEmptyCellToken(this.bInherited, this.bDisplayedAsString); }
}

/** The result of an array (matrix) formula: the matrix and its upper-left cell's value. */
export class ScMatrixCellResultToken extends FormulaToken {
  protected xMatrix: ScMatrix | null;
  protected xUpperLeft: FormulaToken | null;
  constructor(pMat: ScMatrix | null, pUL: FormulaToken | null) {
    super(svMatrix);
    this.xMatrix = pMat;
    this.xUpperLeft = pUL;
  }
  override GetMatrix(): ScMatrix | null { return this.xMatrix; }
  GetUpperLeftToken(): FormulaToken | null { return this.xUpperLeft; }
  GetUpperLeftType(): StackVar { return this.xUpperLeft ? this.xUpperLeft.GetType() : svUnknown; }
  override GetDouble(): number { return this.xUpperLeft ? this.xUpperLeft.GetDouble() : 0.0; }
  override GetString(): string { return this.xUpperLeft ? this.xUpperLeft.GetString() : ''; }
  override Clone(): FormulaToken { return new ScMatrixCellResultToken(this.xMatrix, this.xUpperLeft); }
}

/**
 * extendRangeReference (token.cxx): a range from two references, Sheet1.A1:A2 built as
 * Sheet1.A1:A1 extended with A2. Returns null when the operands are no references.
 */
export function extendRangeReference(rLimits: ScSheetLimits, rTok1: FormulaToken, rTok2: FormulaToken, rPos: ScAddress, bReuseDoubleRef: boolean): FormulaToken | null {
  let sv1: StackVar = rTok1.GetType();
  // Doing a RangeOp with RefList is probably utter nonsense, but Xcl
  // supports it, so do we.
  if (sv1 !== svSingleRef && sv1 !== svDoubleRef && sv1 !== svRefList && sv1 !== svExternalSingleRef && sv1 !== svExternalDoubleRef) return null;
  let sv2: StackVar = rTok2.GetType();
  if (sv2 !== svSingleRef && sv2 !== svDoubleRef && sv2 !== svRefList) return null;

  let xRes: FormulaToken | null = null;
  if (sv1 === svSingleRef && sv2 === svSingleRef) {
    // Range references like Sheet1.A1:A2 are generalized and built by
    // first creating a DoubleRef from the first SingleRef, effectively
    // generating Sheet1.A1:A1, and then extending that with A2 as if
    // Sheet1.A1:A1:A2 was encountered, so the mechanisms to adjust the
    // references apply as well.
    const rRef2 = rTok2.GetSingleRef() as ScSingleRefData;
    const aRef = new ScComplexRefData();
    aRef.Ref1 = (rTok1.GetSingleRef() as ScSingleRefData).clone();
    aRef.Ref2 = aRef.Ref1.clone();
    aRef.Ref2.SetFlag3D(false);
    aRef.Extend(rLimits, rRef2, rPos);
    xRes = new ScDoubleRefToken(rLimits, aRef);
  } else {
    let pRefList: ScRefList | null = null;
    if (sv1 === svDoubleRef) {
      xRes = bReuseDoubleRef ? rTok1 : rTok1.Clone();
      sv1 = svUnknown; // mark as handled
    } else if (sv2 === svDoubleRef) {
      xRes = bReuseDoubleRef ? rTok2 : rTok2.Clone();
      sv2 = svUnknown; // mark as handled
    } else if (sv1 === svRefList) pRefList = rTok1.GetRefList() as ScRefList;
    else if (sv2 === svRefList) pRefList = rTok2.GetRefList() as ScRefList;
    if (pRefList) {
      if (!pRefList.length) return null;
      xRes = new ScDoubleRefToken(rLimits, pRefList[0]!.clone());
    }
    if (!xRes) return null; // shouldn't happen...
    const sv = [sv1, sv2];
    const pt = [rTok1, rTok2];
    const rRef = xRes.GetDoubleRef() as ScComplexRefData;
    for (let i = 0; i < 2; ++i) {
      switch (sv[i]) {
        case svSingleRef:
          rRef.Extend(rLimits, pt[i]!.GetSingleRef() as ScSingleRefData, rPos);
          break;
        case svDoubleRef:
          rRef.Extend(rLimits, pt[i]!.GetDoubleRef() as ScComplexRefData, rPos);
          break;
        case svRefList: {
          const p = pt[i]!.GetRefList() as ScRefList;
          if (!p.length) return null;
          for (const rRefData of p) rRef.Extend(rLimits, rRefData, rPos);
          break;
        }
        default:
      }
    }
  }
  return xRes;
}

// --- reference update helpers (token.cxx anonymous namespace) -----------------------------------

function getSelectedRange(rCxt: RefUpdateContext): ScRange {
  const aSelectedRange = ScRange.Invalid();
  if (rCxt.mnColDelta < 0) {
    // Delete and shift to left.
    aSelectedRange.aStart = new ScAddress(rCxt.maRange.aStart.Col() + rCxt.mnColDelta, rCxt.maRange.aStart.Row(), rCxt.maRange.aStart.Tab());
    aSelectedRange.aEnd = new ScAddress(rCxt.maRange.aStart.Col() - 1, rCxt.maRange.aEnd.Row(), rCxt.maRange.aEnd.Tab());
  } else if (rCxt.mnRowDelta < 0) {
    // Delete and shift up.
    aSelectedRange.aStart = new ScAddress(rCxt.maRange.aStart.Col(), rCxt.maRange.aStart.Row() + rCxt.mnRowDelta, rCxt.maRange.aStart.Tab());
    aSelectedRange.aEnd = new ScAddress(rCxt.maRange.aEnd.Col(), rCxt.maRange.aStart.Row() - 1, rCxt.maRange.aEnd.Tab());
  } else if (rCxt.mnTabDelta < 0) {
    // Deleting sheets.
    // TODO : Figure out what to do here.
  } else if (rCxt.mnColDelta > 0) {
    // Insert and shift to the right.
    aSelectedRange.aStart = rCxt.maRange.aStart.clone();
    aSelectedRange.aEnd = new ScAddress(rCxt.maRange.aStart.Col() + rCxt.mnColDelta - 1, rCxt.maRange.aEnd.Row(), rCxt.maRange.aEnd.Tab());
  } else if (rCxt.mnRowDelta > 0) {
    // Insert and shift down.
    aSelectedRange.aStart = rCxt.maRange.aStart.clone();
    aSelectedRange.aEnd = new ScAddress(rCxt.maRange.aEnd.Col(), rCxt.maRange.aStart.Row() + rCxt.mnRowDelta - 1, rCxt.maRange.aEnd.Tab());
  } else if (rCxt.mnTabDelta > 0) {
    // Inserting sheets.
    // TODO : Figure out what to do here.
  }
  return aSelectedRange;
}

function setRefDeleted(rRef: ScSingleRefData | ScComplexRefData, rCxt: RefUpdateContext): void {
  if (rRef instanceof ScComplexRefData) {
    setRefDeleted(rRef.Ref1, rCxt);
    setRefDeleted(rRef.Ref2, rCxt);
    return;
  }
  if (rCxt.mnColDelta < 0) rRef.SetColDeleted(true);
  else if (rCxt.mnRowDelta < 0) rRef.SetRowDeleted(true);
  else if (rCxt.mnTabDelta < 0) rRef.SetTabDeleted(true);
}

function restoreDeletedRef(rRef: ScSingleRefData | ScComplexRefData, rCxt: RefUpdateContext): void {
  if (rRef instanceof ScComplexRefData) {
    restoreDeletedRef(rRef.Ref1, rCxt);
    restoreDeletedRef(rRef.Ref2, rCxt);
    return;
  }
  if (rCxt.mnColDelta) {
    if (rRef.IsColDeleted()) rRef.SetColDeleted(false);
  } else if (rCxt.mnRowDelta) {
    if (rRef.IsRowDeleted()) rRef.SetRowDeleted(false);
  } else if (rCxt.mnTabDelta) {
    if (rRef.IsTabDeleted()) rRef.SetTabDeleted(false);
  }
}

const ShrinkResult = { UNMODIFIED: 0, SHRUNK: 1, STICKY: 2 } as const;
type ShrinkResult = (typeof ShrinkResult)[keyof typeof ShrinkResult];

function shrinkRange(rCxt: RefUpdateContext, rRefRange: ScRange, rDeletedRange: ScRange, rRef: ScComplexRefData): ShrinkResult {
  if (!rDeletedRange.Intersects(rRefRange)) return ShrinkResult.UNMODIFIED;
  const rDoc = rCxt.mrDoc;

  if (rCxt.mnColDelta < 0) {
    if (rRef.IsEntireRow(rDoc.GetSheetLimits())) return ShrinkResult.STICKY; // Entire rows are not affected, columns are anchored.
    // Shifting left.
    if (rRefRange.aStart.Row() < rDeletedRange.aStart.Row() || rDeletedRange.aEnd.Row() < rRefRange.aEnd.Row())
      return ShrinkResult.UNMODIFIED; // Deleted range is only partially overlapping in vertical direction. Bail out.

    if (rDeletedRange.aStart.Col() <= rRefRange.aStart.Col()) {
      if (rRefRange.aEnd.Col() <= rDeletedRange.aEnd.Col()) {
        // Reference is entirely deleted.
        rRefRange.SetInvalid();
      } else {
        // The reference range is truncated on the left.
        const nOffset = rDeletedRange.aStart.Col() - rRefRange.aStart.Col();
        const nDelta = rRefRange.aStart.Col() - rDeletedRange.aEnd.Col() - 1;
        rRefRange.IncEndColSticky(rDoc, nDelta + nOffset);
        rRefRange.aStart.IncCol(nOffset);
      }
    } else if (rDeletedRange.aEnd.Col() < rRefRange.aEnd.Col()) {
      if (rRefRange.IsEndColSticky(rDoc)) return ShrinkResult.STICKY; // Sticky end not affected.
      // Reference is deleted in the middle. Move the last column
      // position to the left.
      const nDelta = rDeletedRange.aStart.Col() - rDeletedRange.aEnd.Col() - 1;
      rRefRange.IncEndColSticky(rDoc, nDelta);
    } else {
      if (rRefRange.IsEndColSticky(rDoc)) return ShrinkResult.STICKY; // Sticky end not affected.
      // The reference range is truncated on the right.
      const nDelta = rDeletedRange.aStart.Col() - rRefRange.aEnd.Col() - 1;
      rRefRange.IncEndColSticky(rDoc, nDelta);
    }
    return ShrinkResult.SHRUNK;
  } else if (rCxt.mnRowDelta < 0) {
    if (rRef.IsEntireCol(rDoc.GetSheetLimits())) return ShrinkResult.STICKY; // Entire columns are not affected, rows are anchored.
    // Shifting up.
    if (rRefRange.aStart.Col() < rDeletedRange.aStart.Col() || rDeletedRange.aEnd.Col() < rRefRange.aEnd.Col())
      return ShrinkResult.UNMODIFIED; // Deleted range is only partially overlapping in horizontal direction. Bail out.

    if (rDeletedRange.aStart.Row() <= rRefRange.aStart.Row()) {
      if (rRefRange.aEnd.Row() <= rDeletedRange.aEnd.Row()) {
        // Reference is entirely deleted.
        rRefRange.SetInvalid();
      } else {
        // The reference range is truncated on the top.
        const nOffset = rDeletedRange.aStart.Row() - rRefRange.aStart.Row();
        const nDelta = rRefRange.aStart.Row() - rDeletedRange.aEnd.Row() - 1;
        rRefRange.IncEndRowSticky(rDoc, nDelta + nOffset);
        rRefRange.aStart.IncRow(nOffset);
      }
    } else if (rDeletedRange.aEnd.Row() < rRefRange.aEnd.Row()) {
      if (rRefRange.IsEndRowSticky(rDoc)) return ShrinkResult.STICKY; // Sticky end not affected.
      // Reference is deleted in the middle. Move the last row
      // position upward.
      const nDelta = rDeletedRange.aStart.Row() - rDeletedRange.aEnd.Row() - 1;
      rRefRange.IncEndRowSticky(rDoc, nDelta);
    } else {
      if (rRefRange.IsEndRowSticky(rDoc)) return ShrinkResult.STICKY; // Sticky end not affected.
      // The reference range is truncated on the bottom.
      const nDelta = rDeletedRange.aStart.Row() - rRefRange.aEnd.Row() - 1;
      rRefRange.IncEndRowSticky(rDoc, nDelta);
    }
    return ShrinkResult.SHRUNK;
  }
  return ShrinkResult.UNMODIFIED;
}

function expandRange(rCxt: RefUpdateContext, rRefRange: ScRange, rSelectedRange: ScRange, rRef: ScComplexRefData): boolean {
  if (!rSelectedRange.Intersects(rRefRange)) return false;
  const rDoc = rCxt.mrDoc;

  if (rCxt.mnColDelta > 0) {
    if (rRef.IsEntireRow(rDoc.GetSheetLimits())) return false; // Entire rows are not affected, columns are anchored.
    // Insert and shifting right.
    if (rRefRange.aStart.Row() < rSelectedRange.aStart.Row() || rSelectedRange.aEnd.Row() < rRefRange.aEnd.Row())
      return false; // Selected range is only partially overlapping in vertical direction. Bail out.
    if (rDoc.IsExpandRefs()) {
      if (rRefRange.aEnd.Col() - rRefRange.aStart.Col() < 1) return false; // Reference must be at least two columns wide.
    } else if (rSelectedRange.aStart.Col() <= rRefRange.aStart.Col()) {
      return false; // Selected range is at the left end and the edge expansion is turned off.  No expansion.
    }
    if (rRefRange.IsEndColSticky(rDoc)) return false; // Sticky end not affected.
    // Move the last column position to the right.
    const nDelta = rSelectedRange.aEnd.Col() - rSelectedRange.aStart.Col() + 1;
    rRefRange.IncEndColSticky(rDoc, nDelta);
    return true;
  } else if (rCxt.mnRowDelta > 0) {
    if (rRef.IsEntireCol(rDoc.GetSheetLimits())) return false; // Entire columns are not affected, rows are anchored.
    // Insert and shifting down.
    if (rRefRange.aStart.Col() < rSelectedRange.aStart.Col() || rSelectedRange.aEnd.Col() < rRefRange.aEnd.Col())
      return false; // Selected range is only partially overlapping in horizontal direction. Bail out.
    if (rDoc.IsExpandRefs()) {
      if (rRefRange.aEnd.Row() - rRefRange.aStart.Row() < 1) return false; // Reference must be at least two rows tall.
    } else if (rSelectedRange.aStart.Row() <= rRefRange.aStart.Row()) {
      return false; // Selected range is at the top end and the edge expansion is turned off.  No expansion.
    }
    if (rRefRange.IsEndRowSticky(rDoc)) return false; // Sticky end not affected.
    // Move the last row position down.
    const nDelta = rSelectedRange.aEnd.Row() - rSelectedRange.aStart.Row() + 1;
    rRefRange.IncEndRowSticky(rDoc, nDelta);
    return true;
  }
  return false;
}

/**
 * Check if the referenced range is expandable when the selected range is
 * not overlapping the referenced range.
 */
function expandRangeByEdge(rCxt: RefUpdateContext, rRefRange: ScRange, rSelectedRange: ScRange, rRef: ScComplexRefData): boolean {
  const rDoc = rCxt.mrDoc;
  if (!rDoc.IsExpandRefs()) return false; // Edge-expansion is turned off.
  if (rSelectedRange.aStart.Tab() > rRefRange.aStart.Tab() || rRefRange.aEnd.Tab() > rSelectedRange.aEnd.Tab()) return false; // Sheet references not within selected range.

  if (rCxt.mnColDelta > 0) {
    if (rRef.IsEntireRow(rDoc.GetSheetLimits())) return false; // Entire rows are not affected, columns are anchored.
    // Insert and shift right.
    if (rRefRange.aEnd.Col() - rRefRange.aStart.Col() < 1) return false; // Reference must be at least two columns wide.
    if (rRefRange.aStart.Row() < rSelectedRange.aStart.Row() || rSelectedRange.aEnd.Row() < rRefRange.aEnd.Row()) return false;
    if (rSelectedRange.aStart.Col() - rRefRange.aEnd.Col() !== 1) return false; // Selected range is not immediately adjacent. Bail out.
    if (rRefRange.IsEndColSticky(rDoc)) return false; // Sticky end not affected.
    // Move the last column position to the right.
    const nDelta = rSelectedRange.aEnd.Col() - rSelectedRange.aStart.Col() + 1;
    rRefRange.IncEndColSticky(rDoc, nDelta);
    return true;
  } else if (rCxt.mnRowDelta > 0) {
    if (rRef.IsEntireCol(rDoc.GetSheetLimits())) return false; // Entire columns are not affected, rows are anchored.
    if (rRefRange.aEnd.Row() - rRefRange.aStart.Row() < 1) return false; // Reference must be at least two rows tall.
    if (rRefRange.aStart.Col() < rSelectedRange.aStart.Col() || rSelectedRange.aEnd.Col() < rRefRange.aEnd.Col()) return false;
    if (rSelectedRange.aStart.Row() - rRefRange.aEnd.Row() !== 1) return false; // Selected range is not immediately adjacent. Bail out.
    if (rRefRange.IsEndRowSticky(rDoc)) return false; // Sticky end not affected.
    // Move the last row position down.
    const nDelta = rSelectedRange.aEnd.Row() - rSelectedRange.aStart.Row() + 1;
    rRefRange.IncEndRowSticky(rDoc, nDelta);
    return true;
  }
  return false;
}

function adjustSingleRefOnDeletedTab(rLimits: ScSheetLimits, rRef: ScSingleRefData, nDelPos: SCTAB, nSheets: SCTAB, rOldPos: ScAddress, rNewPos: ScAddress): boolean {
  const aAbs = rRef.toAbs(rLimits, rOldPos);
  if (nDelPos <= aAbs.Tab() && aAbs.Tab() < nDelPos + nSheets) {
    rRef.SetTabDeleted(true);
    return true;
  }
  if (nDelPos < aAbs.Tab()) {
    // Reference sheet needs to be adjusted.
    aAbs.IncTab(-1 * nSheets);
    rRef.SetAddress(rLimits, aAbs, rNewPos);
    return true;
  } else if (rOldPos.Tab() !== rNewPos.Tab()) {
    // Cell itself has moved.
    rRef.SetAddress(rLimits, aAbs, rNewPos);
    return true;
  }
  return false;
}

function adjustSingleRefOnInsertedTab(rLimits: ScSheetLimits, rRef: ScSingleRefData, nInsPos: SCTAB, nSheets: SCTAB, rOldPos: ScAddress, rNewPos: ScAddress): boolean {
  const aAbs = rRef.toAbs(rLimits, rOldPos);
  if (nInsPos <= aAbs.Tab()) {
    // Reference sheet needs to be adjusted.
    aAbs.IncTab(nSheets);
    rRef.SetAddress(rLimits, aAbs, rNewPos);
    return true;
  } else if (rOldPos.Tab() !== rNewPos.Tab()) {
    // Cell itself has moved.
    rRef.SetAddress(rLimits, aAbs, rNewPos);
    return true;
  }
  return false;
}

function adjustDoubleRefOnDeleteTab(rLimits: ScSheetLimits, rRef: ScComplexRefData, nDelPos: SCTAB, nSheets: SCTAB, rOldPos: ScAddress, rNewPos: ScAddress): boolean {
  const rRef1 = rRef.Ref1;
  const rRef2 = rRef.Ref2;
  const aStartPos = rRef1.toAbs(rLimits, rOldPos);
  const aEndPos = rRef2.toAbs(rLimits, rOldPos);
  const bMoreThanOneTab = aStartPos.Tab() !== aEndPos.Tab();
  let bModified = false;
  if (bMoreThanOneTab && aStartPos.Tab() === nDelPos && nDelPos + nSheets <= aEndPos.Tab()) {
    if (rRef1.IsTabRel() && aStartPos.Tab() < rOldPos.Tab()) {
      rRef1.IncTab(nSheets);
      bModified = true;
    }
  } else bModified = adjustSingleRefOnDeletedTab(rLimits, rRef1, nDelPos, nSheets, rOldPos, rNewPos);

  if (bMoreThanOneTab && aEndPos.Tab() === nDelPos && aStartPos.Tab() <= nDelPos - nSheets) {
    if (!rRef2.IsTabRel() || rOldPos.Tab() < aEndPos.Tab()) {
      rRef2.IncTab(-nSheets);
      bModified = true;
    }
  } else bModified = adjustSingleRefOnDeletedTab(rLimits, rRef2, nDelPos, nSheets, rOldPos, rNewPos) || bModified;
  return bModified;
}

/** ScRangeUpdater::UpdateDeleteTab (rangeutl.cxx) */
function UpdateDeleteTab(rAddr: ScAddress, rCxt: RefUpdateDeleteTabContext): void {
  if (rCxt.mnDeletePos <= rAddr.Tab()) rAddr.SetTab(Math.max(0, rAddr.Tab() - rCxt.mnSheets));
}

export class ScTokenArray extends FormulaTokenArray {
  private mxSheetLimits: ScSheetLimits;
  private mnHashValue = 0;

  constructor(rLimits: ScSheetLimits | { GetSheetLimits(): ScSheetLimits }) {
    super();
    this.mxSheetLimits = 'mnMaxCol' in rLimits ? rLimits : rLimits.GetSheetLimits();
  }

  GetSheetLimits(): ScSheetLimits { return this.mxSheetLimits; }

  Clone(): ScTokenArray {
    const p = new ScTokenArray(this.mxSheetLimits);
    p.Assign(this);
    p.mnHashValue = this.mnHashValue;
    return p;
  }

  /** Clear the array and the hash. */
  override Clear(): void {
    super.Clear();
    this.mnHashValue = 0;
  }

  /** A hash of the token opcodes and types (GenHash, reduced). */
  GenHash(): void {
    let nHash = 0;
    for (const p of this.pCode) nHash = (nHash * 31 + p.GetOpCode() * 7 + p.GetType()) | 0;
    this.mnHashValue = nHash;
  }
  GetHash(): number { return this.mnHashValue; }

  /** The unique tokens of the code and the RPN (TokenPointers). */
  private *tokens(): Generator<FormulaToken> {
    const seen = new Set<FormulaToken>();
    for (const t of this.pCode) if (!seen.has(t)) { seen.add(t); yield t; }
    for (const t of this.pRPN) if (!seen.has(t)) { seen.add(t); yield t; }
  }

  AddSingleReference(rRef: ScSingleRefData): FormulaToken | null { return this.Add(new ScSingleRefToken(this.mxSheetLimits, rRef)); }
  /** ScSingleRefOpToken with ocMatRef */
  AddMatrixSingleReference(rRef: ScSingleRefData): FormulaToken | null { return this.Add(new ScSingleRefToken(this.mxSheetLimits, rRef, ocMatRef)); }
  AddDoubleReference(rRef: ScComplexRefData): FormulaToken | null { return this.Add(new ScDoubleRefToken(this.mxSheetLimits, rRef)); }
  AddMatrix(p: ScMatrix): FormulaToken | null { return this.Add(new ScMatrixToken(p)); }
  AddRangeName(n: number, nSheet: SCTAB): void { this.Add(new FormulaIndexToken(ocName, n, nSheet)); }
  AddColRowName(rRef: ScSingleRefData): FormulaToken | null { return this.Add(new ScSingleRefToken(this.mxSheetLimits, rRef, ocColRowName)); }

  /** Returns the area or single reference the array consists of, if it is only a reference. */
  private ImplGetReference(rPos: ScAddress, bValidOnly: boolean): ScRange | null {
    const pCode = this.pCode;
    // Exactly one reference (after compile, the RPN holds the single push).
    let t: FormulaToken | null = null;
    if (this.pRPN.length === 1) t = this.pRPN[0]!;
    else if (this.pCode.length === 1) t = pCode[0]!;
    else {
      // with parentheses (A1) or spaces
      const p = pCode.filter((x) => x.GetOpCode() !== ocSpaces && x.GetOpCode() !== ocWhitespace && x.GetType() !== 23 /* svSep */);
      if (p.length === 1) t = p[0]!;
    }
    if (!t || t.GetOpCode() !== ocPush) return null;
    if (t.GetType() === svSingleRef) {
      const rRef = t.GetSingleRef() as ScSingleRefData;
      const aAbs = rRef.toAbs(this.mxSheetLimits, rPos);
      if (!bValidOnly || this.mxSheetLimits.ValidAddress(aAbs)) return new ScRange(aAbs);
    } else if (t.GetType() === svDoubleRef) {
      const rCompl = t.GetDoubleRef() as ScComplexRefData;
      const aAbs = rCompl.toAbs(this.mxSheetLimits, rPos);
      if (!bValidOnly || this.mxSheetLimits.ValidRange(aAbs)) return aAbs;
    }
    return null;
  }

  /** Exactly and only one range (valid or deleted). */
  IsReference(rPos: ScAddress): ScRange | null { return this.ImplGetReference(rPos, false); }
  /** Exactly and only one valid range (no #REF!s). */
  IsValidReference(rPos: ScAddress): ScRange | null { return this.ImplGetReference(rPos, true); }

  /** Whether the array refers to the sheet (other than through relative references only on the
      formula's own sheet). */
  ReferencesSheet(nTab: SCTAB, nPosTab: SCTAB): boolean {
    for (const p of this.tokens()) {
      if (p.GetType() === svSingleRef) {
        const r = p.GetSingleRef() as ScSingleRefData;
        if ((r.IsTabRel() ? r.Tab() + nPosTab : r.Tab()) === nTab) return true;
      } else if (p.GetType() === svDoubleRef) {
        const r = p.GetDoubleRef() as ScComplexRefData;
        const t1 = r.Ref1.IsTabRel() ? r.Ref1.Tab() + nPosTab : r.Ref1.Tab();
        const t2 = r.Ref2.IsTabRel() ? r.Ref2.Tab() + nPosTab : r.Ref2.Tab();
        if (t1 <= nTab && nTab <= t2) return true;
      }
    }
    return false;
  }

  /** Merges an inline array {1;2|3;4} at the end of pCode into one matrix token. */
  override MergeArray(): FormulaToken | null {
    let nCol = -1, nRow = 0;
    let i: number, nPrevRowSep = -1, nStart = 0;
    const nLen = this.pCode.length;
    let bPrevWasSep = false; // top of stack is ocArrayClose
    let t: FormulaToken;
    let bNumeric = false; // numeric value encountered in current element

    const checkArraySep = (bNewVal: boolean): boolean => {
      const bResult = bPrevWasSep === bNewVal;
      bPrevWasSep = bNewVal;
      return bResult;
    };

    // (1) Iterate from the end to the start to find matrix dims
    // and do basic validation.
    for (i = nLen; i-- > nStart;) {
      t = this.pCode[i]!;
      switch (t.GetOpCode()) {
        case ocPush:
          if (checkArraySep(false)) return null;
          // no references or nested arrays
          if (t.GetType() !== svDouble && t.GetType() !== svString) return null;
          bNumeric = t.GetType() === svDouble;
          break;
        case ocMissing:
        case ocTrue:
        case ocFalse:
          if (checkArraySep(false)) return null;
          bNumeric = false;
          break;
        case ocArrayColSep:
        case ocSep:
          if (checkArraySep(true)) return null;
          bNumeric = false;
          break;
        case ocArrayClose:
          // not possible with the , but check just in case
          // something changes in the future
          if (i !== nLen - 1) return null;
          if (checkArraySep(true)) return null;
          nPrevRowSep = i;
          bNumeric = false;
          break;
        case ocArrayOpen:
        case ocArrayRowSep:
          if (t.GetOpCode() === ocArrayOpen) nStart = i; // stop iteration
          if (checkArraySep(true)) return null;
          if (nPrevRowSep < 0 // missing ocArrayClose
            || (nPrevRowSep - i) % 2 === 1) // no complex elements
            return null;
          if (nCol < 0) nCol = (nPrevRowSep - i) / 2;
          else if ((nPrevRowSep - i) / 2 !== nCol) return null; // irregular array
          nPrevRowSep = i;
          nRow++;
          bNumeric = false;
          break;
        case ocNegSub:
        case ocAdd:
          // negation or unary plus must precede numeric value
          if (!bNumeric) return null;
          --nPrevRowSep; // shorten this row by 1
          bNumeric = false; // one level only, no --42
          break;
        case ocSpaces:
        case ocWhitespace:
          // ignore spaces
          --nPrevRowSep; // shorten this row by 1
          break;
        default:
          // no functions or operators
          return null;
      }
    }
    if (nCol <= 0 || nRow <= 0) return null;

    let nSign = 1;
    const pArray = new ScMatrix(nCol, nRow, 0.0);
    for (i = nStart, nCol = 0, nRow = 0; i < nLen; i++) {
      t = this.pCode[i]!;
      switch (t.GetOpCode()) {
        case ocPush:
          if (t.GetType() === svDouble) {
            pArray.PutDouble(t.GetDouble() * nSign, nCol, nRow);
            nSign = 1;
          } else if (t.GetType() === svString) pArray.PutString(t.GetString(), nCol, nRow);
          break;
        case ocMissing:
          pArray.PutEmpty(nCol, nRow);
          break;
        case ocTrue:
          pArray.PutBoolean(true, nCol, nRow);
          break;
        case ocFalse:
          pArray.PutBoolean(false, nCol, nRow);
          break;
        case ocArrayColSep:
        case ocSep:
          nCol++;
          break;
        case ocArrayRowSep:
          nRow++; nCol = 0;
          break;
        case ocNegSub:
          nSign = -nSign;
          break;
        default:
          break;
      }
    }
    this.pCode.length = nStart;
    return this.AddMatrix(pArray);
  }

  /** Merge the last three tokens ref ocRange ref into one double reference. */
  MergeRangeReference(rPos: ScAddress): void {
    const nLen = this.pCode.length;
    if (nLen < 3) return;
    // The actual types are checked in extendRangeReference().
    const p3 = this.pCode[nLen - 1]!; // ref
    const p2 = this.pCode[nLen - 2]!; // ocRange
    if (p2.GetOpCode() !== ocRange) return;
    const p1 = this.pCode[nLen - 3]!; // ref
    const p = extendRangeReference(this.mxSheetLimits, p1, p3, rPos, true);
    if (p) {
      this.pCode.length = nLen - 2;
      this.pCode[nLen - 3] = p;
    }
  }

  /**
   * Adjust all references in response to shifting of cells during cell
   * insertion and deletion.
   */
  AdjustReferenceOnShift(rCxt: RefUpdateContext, rOldPos: ScAddress): RefUpdateResult {
    const aSelectedRange = getSelectedRange(rCxt);
    const lim = this.mxSheetLimits;
    const aRes = new RefUpdateResult();
    const aNewPos = rOldPos.clone();
    const bCellShifted = rCxt.maRange.Contains(rOldPos);
    if (bCellShifted) aNewPos.Move(rCxt.mnColDelta, rCxt.mnRowDelta, rCxt.mnTabDelta, ScAddress.Invalid(), rCxt.mrDoc);

    for (const p of this.tokens()) {
      switch (p.GetType()) {
        case svSingleRef: {
          const rRef = p.GetSingleRef() as ScSingleRefData;
          let aAbs = rRef.toAbs(lim, rOldPos);

          if (rCxt.isDeleted() && aSelectedRange.Contains(aAbs)) {
            // This reference is in the deleted region.
            setRefDeleted(rRef, rCxt);
            aRes.mbValueChanged = true;
            break;
          }

          if (!rCxt.isDeleted() && rRef.IsDeleted()) {
            // Check if the token has reference to previously deleted region.
            const aCheckPos = rRef.toAbs(lim, aNewPos);
            if (rCxt.maRange.Contains(aCheckPos)) {
              restoreDeletedRef(rRef, rCxt);
              aRes.mbValueChanged = true;
              break;
            }
          }

          if (rCxt.maRange.Contains(aAbs)) {
            const aErrorPos = ScAddress.Invalid();
            if (!aAbs.Move(rCxt.mnColDelta, rCxt.mnRowDelta, rCxt.mnTabDelta, aErrorPos, rCxt.mrDoc)) aAbs = aErrorPos;
            aRes.mbReferenceModified = true;
          }

          rRef.SetAddress(lim, aAbs, aNewPos);
          break;
        }
        case svDoubleRef: {
          const rRef = p.GetDoubleRef() as ScComplexRefData;
          let aAbs = rRef.toAbs(lim, rOldPos);

          if (rCxt.isDeleted()) {
            if (aSelectedRange.Contains(aAbs)) {
              // This reference is in the deleted region.
              setRefDeleted(rRef, rCxt);
              aRes.mbValueChanged = true;
              break;
            } else if (aSelectedRange.Intersects(aAbs)) {
              const eSR = shrinkRange(rCxt, aAbs, aSelectedRange, rRef);
              if (eSR === ShrinkResult.SHRUNK) {
                // The reference range has been shrunk.
                rRef.SetRange(lim, aAbs, aNewPos);
                aRes.mbValueChanged = true;
                aRes.mbReferenceModified = true;
                break;
              } else if (eSR === ShrinkResult.STICKY) {
                // The reference range stays the same but a
                // new (empty) cell range is shifted in and
                // may change the calculation result.
                aRes.mbValueChanged = true;
                // Sticky when intersecting the selected
                // range means also that the other
                // conditions below are not met.
                break;
              }
            }
          }

          if (!rCxt.isDeleted() && rRef.IsDeleted()) {
            // Check if the token has reference to previously deleted region.
            const aCheckRange = rRef.toAbs(lim, aNewPos);
            if (aSelectedRange.Contains(aCheckRange)) {
              // This reference was previously in the deleted region. Restore it.
              restoreDeletedRef(rRef, rCxt);
              aRes.mbValueChanged = true;
              break;
            }
          }

          if (rCxt.isInserted()) {
            if (expandRange(rCxt, aAbs, aSelectedRange, rRef)) {
              // The reference range has been expanded.
              rRef.SetRange(lim, aAbs, aNewPos);
              aRes.mbValueChanged = true;
              aRes.mbReferenceModified = true;
              break;
            }
            if (expandRangeByEdge(rCxt, aAbs, aSelectedRange, rRef)) {
              // The reference range has been expanded on the edge.
              rRef.SetRange(lim, aAbs, aNewPos);
              aRes.mbValueChanged = true;
              aRes.mbReferenceModified = true;
              break;
            }
          }

          if (rCxt.maRange.Contains(aAbs)) {
            // We shift either by column or by row, not both,
            // so moving the reference has only to be done in
            // the non-sticky case.
            if ((rCxt.mnRowDelta && rRef.IsEntireCol(lim)) || (rCxt.mnColDelta && rRef.IsEntireRow(lim))) {
              // In entire col/row, values are shifted within
              // the reference, which affects all positional
              // results like in MATCH or matrix positions.
              aRes.mbValueChanged = true;
            } else {
              const aErrorRange = ScRange.Invalid();
              if (!aAbs.MoveSticky(rCxt.mrDoc, rCxt.mnColDelta, rCxt.mnRowDelta, rCxt.mnTabDelta, aErrorRange)) aAbs = aErrorRange;
              aRes.mbReferenceModified = true;
            }
          } else if (rCxt.maRange.Intersects(aAbs)) {
            // Part of the referenced range is being shifted. This
            // will change the values of the range.
            aRes.mbValueChanged = true;
          }

          rRef.SetRange(lim, aAbs, aNewPos);
          break;
        }
        default:
      }

      if (p.GetType() === svIndex && p.GetOpCode() === ocName) {
        const nOldTab = p.GetSheet();
        if (rCxt.mnTabDelta && rCxt.maRange.aStart.Tab() <= nOldTab && nOldTab <= rCxt.maRange.aEnd.Tab()) {
          aRes.mbNameModified = true;
          p.SetSheet(nOldTab + rCxt.mnTabDelta);
        }
      } else if (p.GetType() === svIndex && p.GetOpCode() === ocDBArea) {
        // database ranges are not ported
      }
    }
    return aRes;
  }

  /**
   * Adjust all references on sheet deletion.
   */
  AdjustReferenceOnDeletedTab(rCxt: RefUpdateDeleteTabContext, rOldPos: ScAddress): RefUpdateResult {
    const aRes = new RefUpdateResult();
    const aNewPos = rOldPos.clone();
    UpdateDeleteTab(aNewPos, rCxt);
    const lim = this.mxSheetLimits;
    for (const p of this.tokens()) {
      switch (p.GetType()) {
        case svSingleRef:
          if (adjustSingleRefOnDeletedTab(lim, p.GetSingleRef() as ScSingleRefData, rCxt.mnDeletePos, rCxt.mnSheets, rOldPos, aNewPos)) aRes.mbReferenceModified = true;
          break;
        case svDoubleRef:
          if (adjustDoubleRefOnDeleteTab(lim, p.GetDoubleRef() as ScComplexRefData, rCxt.mnDeletePos, rCxt.mnSheets, rOldPos, aNewPos)) aRes.mbReferenceModified = true;
          break;
        default:
      }
      if (p.GetType() === svIndex && p.GetOpCode() === ocName) {
        const nOldTab = p.GetSheet();
        if (rCxt.mnDeletePos <= nOldTab) {
          aRes.mbNameModified = true;
          if (rCxt.mnDeletePos + rCxt.mnSheets <= nOldTab) p.SetSheet(nOldTab - rCxt.mnSheets);
          // Would point to a deleted sheet. Invalidate.
          else p.SetSheet(0x7fff);
        }
      }
    }
    return aRes;
  }

  /**
   * Adjust all references on sheet insertion.
   */
  AdjustReferenceOnInsertedTab(rCxt: RefUpdateInsertTabContext, rOldPos: ScAddress): RefUpdateResult {
    const aRes = new RefUpdateResult();
    const aNewPos = rOldPos.clone();
    if (rCxt.mnInsertPos <= rOldPos.Tab()) aNewPos.IncTab(rCxt.mnSheets);
    const lim = this.mxSheetLimits;
    for (const p of this.tokens()) {
      switch (p.GetType()) {
        case svSingleRef:
          if (adjustSingleRefOnInsertedTab(lim, p.GetSingleRef() as ScSingleRefData, rCxt.mnInsertPos, rCxt.mnSheets, rOldPos, aNewPos)) aRes.mbReferenceModified = true;
          break;
        case svDoubleRef: {
          const rRef = p.GetDoubleRef() as ScComplexRefData;
          if (adjustSingleRefOnInsertedTab(lim, rRef.Ref1, rCxt.mnInsertPos, rCxt.mnSheets, rOldPos, aNewPos)) aRes.mbReferenceModified = true;
          if (adjustSingleRefOnInsertedTab(lim, rRef.Ref2, rCxt.mnInsertPos, rCxt.mnSheets, rOldPos, aNewPos)) aRes.mbReferenceModified = true;
          break;
        }
        default:
      }
      if (p.GetType() === svIndex && p.GetOpCode() === ocName) {
        const nOldTab = p.GetSheet();
        if (rCxt.mnInsertPos <= nOldTab) {
          aRes.mbNameModified = true;
          p.SetSheet(nOldTab + rCxt.mnSheets);
        }
      }
    }
    return aRes;
  }

  AdjustReferenceOnMovedTab(rCxt: RefUpdateMoveTabContext, rOldPos: ScAddress): RefUpdateResult {
    const aRes = new RefUpdateResult();
    if (rCxt.mnOldPos === rCxt.mnNewPos) return aRes;

    const adjustTabOnMove = (rPos: ScAddress): boolean => {
      const nNewTab = rCxt.getNewTab(rPos.Tab());
      if (nNewTab === rPos.Tab()) return false;
      rPos.SetTab(nNewTab);
      return true;
    };

    const aNewPos = rOldPos.clone();
    if (adjustTabOnMove(aNewPos)) {
      aRes.mbReferenceModified = true;
      aRes.mbValueChanged = true;
      aRes.mnTab = aNewPos.Tab(); // this sets the new tab position used when deleting
    }
    const lim = this.mxSheetLimits;
    for (const p of this.tokens()) {
      switch (p.GetType()) {
        case svSingleRef: {
          const rRef = p.GetSingleRef() as ScSingleRefData;
          const aAbs = rRef.toAbs(lim, rOldPos);
          if (adjustTabOnMove(aAbs)) aRes.mbReferenceModified = true;
          rRef.SetAddress(lim, aAbs, aNewPos);
          break;
        }
        case svDoubleRef: {
          const rRef = p.GetDoubleRef() as ScComplexRefData;
          const aAbs = rRef.toAbs(lim, rOldPos);
          if (adjustTabOnMove(aAbs.aStart)) aRes.mbReferenceModified = true;
          if (adjustTabOnMove(aAbs.aEnd)) aRes.mbReferenceModified = true;
          rRef.SetRange(lim, aAbs, aNewPos);
          break;
        }
        default:
      }
      if (p.GetType() === svIndex && p.GetOpCode() === ocName) {
        const nOldTab = p.GetSheet();
        const nNewTab = rCxt.getNewTab(nOldTab);
        if (nNewTab !== nOldTab) {
          aRes.mbNameModified = true;
          p.SetSheet(nNewTab);
        }
      }
    }
    return aRes;
  }

  /**
   * Adjust all references in response to moving of cells (cut and paste, drag and drop). The
   * context's range is the destination range.
   */
  AdjustReferenceOnMove(rCxt: RefUpdateContext, rOldPos: ScAddress, rNewPos: ScAddress): RefUpdateResult {
    const aRes = new RefUpdateResult();
    if (!rCxt.mnColDelta && !rCxt.mnRowDelta && !rCxt.mnTabDelta) return aRes; // The cell hasn't moved at all.

    // When moving, the range in the context is the destination range. We need
    // to use the old range prior to the move for hit analysis.
    const aOldRange = rCxt.maRange.clone();
    aOldRange.Move(-rCxt.mnColDelta, -rCxt.mnRowDelta, -rCxt.mnTabDelta, ScRange.Invalid(), rCxt.mrDoc);
    const lim = this.mxSheetLimits;

    for (const p of this.tokens()) {
      switch (p.GetType()) {
        case svSingleRef: {
          const rRef = p.GetSingleRef() as ScSingleRefData;
          let aAbs = rRef.toAbs(lim, rOldPos);
          // Do not update the reference in transposed case (cut paste transposed).
          if (rCxt.mbTransposed && (aOldRange.Contains(rOldPos) || aOldRange.Contains(aAbs))) break;
          if (aOldRange.Contains(aAbs)) {
            const aErrorPos = ScAddress.Invalid();
            if (!aAbs.Move(rCxt.mnColDelta, rCxt.mnRowDelta, rCxt.mnTabDelta, aErrorPos, rCxt.mrDoc)) aAbs = aErrorPos;
            aRes.mbReferenceModified = true;
          } else if (rCxt.maRange.Contains(aAbs)) {
            // Referenced cell has been overwritten.
            aRes.mbValueChanged = true;
          }
          rRef.SetAddress(lim, aAbs, rNewPos);
          rRef.SetFlag3D(rRef.IsFlag3D() || !rRef.IsTabRel() || aAbs.Tab() !== rNewPos.Tab());
          break;
        }
        case svDoubleRef: {
          const rRef = p.GetDoubleRef() as ScComplexRefData;
          let aAbs = rRef.toAbs(lim, rOldPos);
          if (rCxt.mbTransposed && (aOldRange.Contains(rOldPos) || aOldRange.Contains(aAbs))) break;
          if (aOldRange.Contains(aAbs)) {
            const aErrorRange = ScRange.Invalid();
            if (!aAbs.Move(rCxt.mnColDelta, rCxt.mnRowDelta, rCxt.mnTabDelta, aErrorRange, rCxt.mrDoc)) aAbs = aErrorRange;
            aRes.mbReferenceModified = true;
          } else if (rCxt.maRange.Contains(aAbs)) {
            // Referenced range has been entirely overwritten.
            aRes.mbValueChanged = true;
          }
          rRef.SetRange(lim, aAbs, rNewPos);
          let b1: boolean, b2: boolean;
          if (aAbs.aStart.Tab() !== aAbs.aEnd.Tab()) {
            // More than one sheet referenced => has to have
            // both 3D flags.
            b1 = b2 = true;
          } else {
            // Keep given 3D flag even for relative sheet
            // reference to same sheet.
            // Absolute sheet reference => set 3D flag.
            // Reference to another sheet => set 3D flag.
            b1 = rRef.Ref1.IsFlag3D() || !rRef.Ref1.IsTabRel() || rNewPos.Tab() !== aAbs.aStart.Tab();
            b2 = rRef.Ref2.IsFlag3D() || !rRef.Ref2.IsTabRel() || rNewPos.Tab() !== aAbs.aEnd.Tab();
            // End part has 3D flag => start part must have it too.
            if (b2) b1 = true;
            // End part sheet reference is identical to start
            // part sheet reference and end part sheet
            // reference was not explicitly given => clear end
            // part 3D flag.
            if (b1 && b2 && rRef.Ref1.IsTabRel() === rRef.Ref2.IsTabRel() && !rRef.Ref2.IsFlag3D()) b2 = false;
          }
          rRef.Ref1.SetFlag3D(b1);
          rRef.Ref2.SetFlag3D(b2);
          break;
        }
        default:
      }
    }
    return aRes;
  }

  /**
   * Adjust all internal references on base position change.
   */
  AdjustReferenceOnMovedOrigin(rOldPos: ScAddress, rNewPos: ScAddress): void {
    const lim = this.mxSheetLimits;
    for (const p of this.tokens()) {
      switch (p.GetType()) {
        case svSingleRef:
        case svExternalSingleRef: {
          const rRef = p.GetSingleRef() as ScSingleRefData;
          rRef.SetAddress(lim, rRef.toAbs(lim, rOldPos), rNewPos);
          break;
        }
        case svDoubleRef:
        case svExternalDoubleRef: {
          const rRef = p.GetDoubleRef() as ScComplexRefData;
          rRef.SetRange(lim, rRef.toAbs(lim, rOldPos), rNewPos);
          break;
        }
        default:
      }
    }
  }

  /**
   * Adjust all internal references on base position change if they point to a sheet other than
   * the one of rOldPos (copying a sheet).
   */
  AdjustReferenceOnMovedOriginIfOtherSheet(rOldPos: ScAddress, rNewPos: ScAddress): void {
    const lim = this.mxSheetLimits;
    for (const p of this.tokens()) {
      let bAdjust = false;
      switch (p.GetType()) {
        case svExternalSingleRef:
        case svSingleRef: {
          if (p.GetType() === svExternalSingleRef) bAdjust = true; // always
          const rRef = p.GetSingleRef() as ScSingleRefData;
          const aAbs = rRef.toAbs(lim, rOldPos);
          if (!bAdjust) bAdjust = aAbs.Tab() !== rOldPos.Tab();
          if (bAdjust) rRef.SetAddress(lim, aAbs, rNewPos);
          break;
        }
        case svExternalDoubleRef:
        case svDoubleRef: {
          if (p.GetType() === svExternalDoubleRef) bAdjust = true; // always
          const rRef = p.GetDoubleRef() as ScComplexRefData;
          const aAbs = rRef.toAbs(lim, rOldPos);
          if (!bAdjust) bAdjust = rOldPos.Tab() < aAbs.aStart.Tab() || aAbs.aEnd.Tab() < rOldPos.Tab();
          if (bAdjust) rRef.SetRange(lim, aAbs, rNewPos);
          break;
        }
        default:
      }
    }
  }

  /**
   * Adjust internal range references on base position change to justify / put in order the
   * relative references.
   */
  AdjustReferenceOnCopy(rNewPos: ScAddress): void {
    for (const p of this.tokens()) {
      if (p.GetType() === svDoubleRef) (p.GetDoubleRef() as ScComplexRefData).PutInOrder(rNewPos);
    }
  }

  /** Whether any of the references is deleted (shows #REF!). */
  HasDeletedRefs(): boolean {
    for (const p of this.tokens()) {
      if (p.GetType() === svSingleRef && (p.GetSingleRef() as ScSingleRefData).IsDeleted()) return true;
      if (p.GetType() === svDoubleRef && (p.GetDoubleRef() as ScComplexRefData).IsDeleted()) return true;
    }
    return false;
  }

  /** The error of the code, set e.g. by the compiler. */
  override GetCodeError(): FormulaError { return this.nError; }

  /** Whether the array contains references to cells (for listening). */
  HasCellRefs(): boolean {
    for (const p of this.pRPN) if (p.GetType() === svSingleRef || p.GetType() === svDoubleRef || p.GetType() === svEmptyCell) return true;
    return false;
  }
}

