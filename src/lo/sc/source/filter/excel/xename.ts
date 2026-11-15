// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/filter/excel/xename.cxx reduced
// XclExpNameManager: the definedNames of workbook.xml: first the built-in names of every sheet
// (_xlnm.Print_Area from the print ranges, _xlnm.Print_Titles from the repeated columns and rows,
// CreateBuiltInNames), then the global and sheet-local named expressions (CreateUserNames) in the
// OOXML grammar; a user name that equals a built-in one already written is dropped
// (FindBuiltInNameIdx). Reduced: the BIFF token arrays, the names created for external and
// invalid references while compiling formulas and the emulation of relative global names are
// left out.
import { escapeXml } from '../../../../xmloff/source/core/xmlparse.ts';
import { encodeXString } from '../../../../oox/source/helper/attributelist.ts';
import { FormulaGrammar } from '../../../../include/formula/grammar.ts';
import { ScColToAlpha, type ScRange } from '../../../inc/address.ts';
import { ScRangeDataType } from '../../core/tool/rangenam.ts';
import type { ScDocument } from '../../core/data/document.ts';

/** A sheet name as OOXML formulas write it (quoted when needed). */
export function QuoteSheetName(rName: string): string {
  return /^[A-Za-z_À-￿][A-Za-z0-9_.À-￿]*$/.test(rName) && !/^[A-Za-z]{1,3}\d+$/.test(rName) && !/^R\d*C\d*$/i.test(rName) ? rName : `'${rName.replace(/'/g, "''")}'`;
}

const absRange = (rSheet: string, r: ScRange) => `${rSheet}!$${ScColToAlpha(r.aStart.Col())}$${r.aStart.Row() + 1}:$${ScColToAlpha(r.aEnd.Col())}$${r.aEnd.Row() + 1}`;

/** The definedNames element ('' for none). */
export function SaveDefinedNamesXml(rDoc: ScDocument): string {
  const aNames: string[] = [];
  const aBuiltIn = new Set<string>(); // "tab/NAME"
  const nMaxCol = rDoc.MaxCol(), nMaxRow = rDoc.MaxRow();
  const name = (n: string, nTab: number, sym: string, bHidden = false) =>
    `<definedName${bHidden ? ' hidden="true"' : ''}${nTab >= 0 ? ` localSheetId="${nTab}"` : ''} name="${escapeXml(encodeXString(n))}">${escapeXml(sym)}</definedName>`;

  // *** built-in names *** -----------------------------------------------------
  for (let nTab = 0; nTab < rDoc.GetTableCount(); nTab++) {
    const aSheet = QuoteSheetName(rDoc.GetName(nTab) ?? '');
    // 1) print ranges
    const aPrint: string[] = [];
    for (let i = 0; i < rDoc.GetPrintRangeCount(nTab); i++) {
      const r = rDoc.GetPrintRange(nTab, i);
      if (r) aPrint.push(absRange(aSheet, r));
    }
    if (aPrint.length) { aNames.push(name('_xlnm.Print_Area', nTab, aPrint.join(','))); aBuiltIn.add(`${nTab}/_XLNM.PRINT_AREA`); }
    // 2) print titles
    const aTitles: string[] = [];
    const oCol = rDoc.GetRepeatColRange(nTab), oRow = rDoc.GetRepeatRowRange(nTab);
    // repeated columns, repeated rows (whole columns and rows)
    if (oCol) aTitles.push(`${aSheet}!$${ScColToAlpha(oCol.aStart.Col())}:$${ScColToAlpha(oCol.aEnd.Col())}`);
    if (oRow) aTitles.push(`${aSheet}!$${oRow.aStart.Row() + 1}:$${oRow.aEnd.Row() + 1}`);
    void nMaxCol; void nMaxRow;
    if (aTitles.length) { aNames.push(name('_xlnm.Print_Titles', nTab, aTitles.join(','))); aBuiltIn.add(`${nTab}/_XLNM.PRINT_TITLES`); }
  }

  // *** user names *** ---------------------------------------------------------
  const user = (nTab: number) => {
    const pNames = rDoc.GetRangeName(nTab >= 0 ? nTab : undefined);
    if (!pNames) return;
    for (const p of pNames.begin()) {
      if (aBuiltIn.has(`${nTab}/${p.GetUpperName()}`)) continue;
      const sym = p.GetSymbol(FormulaGrammar.GRAM_OOXML);
      aNames.push(name(p.GetName(), nTab, sym, p.HasType(ScRangeDataType.Hidden)));
    }
  };
  user(-1);
  for (let nTab = 0; nTab < rDoc.GetTableCount(); nTab++) user(nTab);
  return aNames.length ? `<definedNames>${aNames.join('')}</definedNames>` : '';
}
