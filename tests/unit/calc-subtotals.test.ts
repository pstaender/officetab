// Data - Subtotals (ScTable::DoSubTotals, ScDBDocFunc::DoSubTotals): rows with SUBTOTAL formulas
// per group and the grand total, removal, undo.
import { describe, expect, test } from 'vitest';
import { ScAddress } from '../../src/lo/sc/inc/address.ts';
import { ScSubTotalFunc } from '../../src/lo/sc/inc/global.ts';
import { ScInputOptions } from '../../src/lo/sc/inc/inputopt.ts';
import { ScDBDocFunc } from '../../src/lo/sc/source/ui/docshell/dbdocfun.ts';
import { ScDocShell } from '../../src/lo/sc/source/ui/docshell/docsh.ts';
import { ScTabViewShell } from '../../src/lo/sc/source/ui/view/tabvwsh.ts';
import { putAll } from './calchelper.ts';

describe('subtotals', () => {
  test('sum per group with the grand total, sorted first; removal and undo', () => {
    const sh = new ScDocShell();
    const v = new ScTabViewShell(sh, () => new ScInputOptions());
    const doc = sh.GetDocument();
    putAll(doc, { A1: 'Fruit', B1: 'Count', A2: 'pear', B2: 5, A3: 'apple', B3: 3, A4: 'pear', B4: 2, A5: 'apple', B5: 1 });
    v.SetCursor(0, 0);
    const pDBData = v.GetDBData(false)!;
    const aParam = pDBData.GetSubTotalParam();
    aParam.aGroups[0]!.bActive = true;
    aParam.aGroups[0]!.nField = 0;
    aParam.SetSubTotals(1, [1], [ScSubTotalFunc.SUBTOTAL_FUNC_SUM], 1);
    new ScDBDocFunc(sh).DoSubTotals(0, aParam, true, false);
    const col = (c: number) => Array.from({ length: 9 }, (_, r) => doc.GetString(new ScAddress(c, r, 0)));
    expect(col(0)).toEqual(['Fruit', 'apple', 'apple', 'apple Sum', 'pear', 'pear', 'pear Sum', 'Grand Sum', '']);
    expect(col(1)).toEqual(['Count', '3', '1', '4', '5', '2', '7', '11', '']);
    expect(doc.GetFormula(new ScAddress(1, 3, 0))).toBe('=SUBTOTAL(9,$B$2:$B$3)');
    expect(pDBData.GetArea().aEnd.Row()).toBe(7);

    // done again with bReplace: the old subtotal rows go first
    new ScDBDocFunc(sh).DoSubTotals(0, pDBData.GetSubTotalParam(), true, false);
    expect(col(0)).toEqual(['Fruit', 'apple', 'apple', 'apple Sum', 'pear', 'pear', 'pear Sum', 'Grand Sum', '']);

    // remove only
    const aRemove = pDBData.GetSubTotalParam();
    aRemove.bRemoveOnly = true;
    new ScDBDocFunc(sh).DoSubTotals(0, aRemove, true, false);
    expect(col(0)).toEqual(['Fruit', 'apple', 'apple', 'pear', 'pear', '', '', '', '']);

    sh.GetUndoManager().Undo();
    expect(col(0)).toEqual(['Fruit', 'apple', 'apple', 'apple Sum', 'pear', 'pear', 'pear Sum', 'Grand Sum', '']);
    sh.GetUndoManager().Undo();
    sh.GetUndoManager().Undo();
    expect(col(0).slice(0, 5)).toEqual(['Fruit', 'pear', 'apple', 'pear', 'apple']);
  });
});
