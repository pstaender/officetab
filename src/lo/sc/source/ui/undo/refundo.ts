// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/refundo.hxx reduced
// @upstream sc/source/ui/undo/refundo.cxx reduced
// ScRefUndoData: the document-level data with references that an insertion or deletion of cells
// or sheets may change, saved for undo. Reduced to the global named expressions; the database
// ranges, print ranges, pivot tables, detective operations, chart listeners, area links and UNO
// references are not in the model. Two name lists are equal when they hold the same names with
// the same symbols.
import type { ScDocument } from '../../core/data/document.ts';
import type { ScRangeName } from '../../core/tool/rangenam.ts';

function lcl_Equal(a: ScRangeName, b: ScRangeName): boolean {
  if (a.size() !== b.size()) return false;
  const m = new Map<string, string>();
  for (const d of a.begin()) m.set(d.GetUpperName(), d.GetSymbol());
  for (const d of b.begin()) if (m.get(d.GetUpperName()) !== d.GetSymbol()) return false;
  return true;
}

export class ScRefUndoData {
  private pRangeName: ScRangeName | null = null;

  constructor(rDoc: ScDocument) {
    const pOldRanges = rDoc.GetRangeName();
    if (pOldRanges && !pOldRanges.empty()) this.pRangeName = pOldRanges.clone(rDoc);
  }

  DeleteUnchanged(rDoc: ScDocument): void {
    if (this.pRangeName) {
      const pNewRanges = rDoc.GetRangeName();
      if (pNewRanges && lcl_Equal(this.pRangeName, pNewRanges)) this.pRangeName = null;
    }
  }

  DoUndo(rDoc: ScDocument, bUndoRefFirst: boolean): void {
    void bUndoRefFirst;
    if (this.pRangeName) {
      rDoc.SetRangeName(this.pRangeName.clone(rDoc));
      // CompileAll: the formulas look their names up again when calculated
      rDoc.SetAllFormulasDirty();
    }
  }
}
