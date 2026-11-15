// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/filter/oox/defnamesbuffer.cxx reduced
// DefinedNamesBuffer: the definedName elements of workbook.xml as global or sheet-local named
// expressions (ScRangeData, compiled in the OOXML grammar), and the built-in names _xlnm.Print_Area
// and _xlnm.Print_Titles as the sheets' print ranges and repeated columns and rows. Reduced: the
// BIFF12 records, the macro and function names (not created, as upstream) and the external link
// information (names referring to other documents are skipped and the caller reports external
// links) are left out; the filter database names are created as plain names.
import { FormulaError } from '../../../../include/formula/errorcodes.ts';
import { FormulaGrammar } from '../../../../include/formula/grammar.ts';
import { ScAddress, ScRange } from '../../../inc/address.ts';
import { ScCompiler } from '../../core/tool/compiler.ts';
import { ScRangeData, ScRangeDataType } from '../../core/tool/rangenam.ts';
import type { ScDocument } from '../../core/data/document.ts';
import type { AttributeList } from '../../../../oox/source/helper/attributelist.ts';

export const BIFF_DEFNAME_CONSOLIDATE = 0;
export const BIFF_DEFNAME_CRITERIA = 5;
export const BIFF_DEFNAME_PRINTAREA = 6;
export const BIFF_DEFNAME_PRINTTITLES = 7;
export const BIFF_DEFNAME_FILTERDATABASE = 13;
export const BIFF_DEFNAME_UNKNOWN = 14;

const spcOoxPrefix = '_xlnm.';

const sppcBaseNames = [
  'Consolidate_Area',
  'Auto_Open',
  'Auto_Close',
  'Extract',
  'Database',
  'Criteria',
  'Print_Area',
  'Print_Titles',
  'Recorder',
  'Data_Form',
  'Auto_Activate',
  'Auto_Deactivate',
  'Sheet_Title',
  '_FilterDatabase',
];

export function lclGetBaseName(cBuiltinId: number): string {
  return cBuiltinId < sppcBaseNames.length ? sppcBaseNames[cBuiltinId]! : String(cBuiltinId);
}

export const lclGetPrefixedName = (cBuiltinId: number) => spcOoxPrefix + lclGetBaseName(cBuiltinId);

/** returns the built-in name identifier from a prefixed built-in name, e.g. '_xlnm.Print_Area'. */
export function lclGetBuiltinIdFromPrefixedName(aModelName: string): number {
  if (aModelName.toLowerCase().startsWith(spcOoxPrefix.toLowerCase())) {
    for (let cBuiltinId = 0; cBuiltinId < sppcBaseNames.length; ++cBuiltinId) {
      const aBaseName = lclGetBaseName(cBuiltinId);
      if (aModelName.length === spcOoxPrefix.length + aBaseName.length && aModelName.slice(spcOoxPrefix.length).toLowerCase() === aBaseName.toLowerCase()) return cBuiltinId;
    }
  }
  return BIFF_DEFNAME_UNKNOWN;
}

interface DefinedNameModel { maName: string; maFormula: string; mnSheet: number; mbMacro: boolean; mbFunction: boolean; mbVBName: boolean; mbHidden: boolean }

export class DefinedName {
  maModel: DefinedNameModel;
  private mnCalcSheet: number;
  private mcBuiltinId: number;
  private maScRangeData: ScRangeData | null = null;

  constructor(rAttribs: AttributeList) {
    this.maModel = {
      maName: rAttribs.getXString('name', '')!,
      maFormula: '',
      mnSheet: rAttribs.getInteger('localSheetId', -1),
      mbMacro: rAttribs.getBool('xlm', false),
      mbFunction: rAttribs.getBool('function', false),
      mbVBName: rAttribs.getBool('vbProcedure', false),
      mbHidden: rAttribs.getBool('hidden', false),
    };
    this.mnCalcSheet = this.maModel.mnSheet;
    /*  Detect built-in state from name itself, there is no built-in flag.
        Built-in names are prefixed with '_xlnm.' instead. */
    this.mcBuiltinId = lclGetBuiltinIdFromPrefixedName(this.maModel.maName);
  }

  setFormula(rFormula: string): void { this.maModel.maFormula = rFormula; }
  isGlobalName(): boolean { return this.maModel.mnSheet < 0; }
  isBuiltinName(): boolean { return this.mcBuiltinId !== BIFF_DEFNAME_UNKNOWN; }
  /** isValid: no reference to an external document ("[1]Sheet!A1"). */
  isValid(): boolean { return !/(^|[^"])\[\d+\]/.test(this.maModel.maFormula); }

  createNameObject(rDoc: ScDocument): void {
    // do not create names for (macro) functions or VBA procedures
    // #163146# do not ignore hidden names (may be regular names created by VBA scripts)
    if (this.maModel.mbFunction || this.maModel.mbVBName) return;
    if (this.maModel.mnSheet >= rDoc.GetTableCount()) return;

    // convert original name to final Calc name (TODO: filter invalid characters from model name)
    const maCalcName = this.isBuiltinName() ? lclGetPrefixedName(this.mcBuiltinId) : this.maModel.maName;

    // special flags for this name
    let nNameFlags = 0;
    if (!this.isGlobalName()) switch (this.mcBuiltinId) {
      case BIFF_DEFNAME_CRITERIA:
      case BIFF_DEFNAME_FILTERDATABASE:
        nNameFlags = ScRangeDataType.Criteria;
        break;
      case BIFF_DEFNAME_PRINTAREA:
        nNameFlags = ScRangeDataType.PrintArea;
        break;
      case BIFF_DEFNAME_PRINTTITLES:
        nNameFlags = ScRangeDataType.ColHeader | ScRangeDataType.RowHeader;
        break;
    }
    // Set the appropriate flag if it is a hidden named range
    if (this.maModel.mbHidden) nNameFlags |= ScRangeDataType.Hidden;

    // create the name and insert it into the document
    const aPos = new ScAddress(0, 0, this.mnCalcSheet < 0 ? 0 : this.mnCalcSheet);
    const p = new ScRangeData(rDoc, maCalcName, '', aPos, nNameFlags, FormulaGrammar.GRAM_OOXML);
    const pNames = rDoc.GetRangeName(this.maModel.mnSheet >= 0 ? this.maModel.mnSheet : undefined);
    if (pNames && pNames.insert(p)) this.maScRangeData = p;
  }

  convertFormula(rDoc: ScDocument): void {
    const pScRangeData = this.maScRangeData;
    // macro function or vba procedure
    if (!pScRangeData) return;

    // mnCalcSheet < 0 means global name and results in tab deleted when
    // compiling a reference without sheet reference. tdf#164895
    const aReferenceAddr = new ScAddress(0, 0, this.mnCalcSheet < 0 ? 0 : this.mnCalcSheet);
    const aCompiler = new ScCompiler(rDoc, aReferenceAddr, null, FormulaGrammar.GRAM_OOXML);
    const pArray = aCompiler.CompileString(this.maModel.maFormula);
    // Compile the tokens into RPN once to populate information into tokens
    // where necessary. RPN can be discarded after, a resulting error must be reset.
    const nErr: FormulaError = pArray.GetCodeError();
    aCompiler.CompileTokenArray();
    pArray.DelRPN();
    pArray.SetCodeError(nErr);
    pScRangeData.SetCode(pArray);

    // set built-in names (print ranges, repeated titles, filter ranges)
    if (this.isGlobalName()) return;
    const nTab = this.mnCalcSheet;
    switch (this.mcBuiltinId) {
      case BIFF_DEFNAME_PRINTAREA: {
        const aPrintRanges = pScRangeData.GetReferences().filter((r) => r.aStart.Tab() === nTab || r.aStart.Tab() < 0);
        if (aPrintRanges.length) {
          rDoc.ClearPrintRanges(nTab);
          for (const r of aPrintRanges) { const x = r.clone(); x.aStart.SetTab(nTab); x.aEnd.SetTab(nTab); rDoc.AddPrintRange(nTab, x); }
        }
        break;
      }
      case BIFF_DEFNAME_PRINTTITLES: {
        const aTitleRanges = pScRangeData.GetReferences();
        let bHasRowTitles = false;
        let bHasColTitles = false;
        const nMaxCol = rDoc.MaxCol(), nMaxRow = rDoc.MaxRow();
        for (const rRange of aTitleRanges) {
          const bFullRow = (rRange.aStart.Col() === 0) && (rRange.aEnd.Col() >= nMaxCol);
          const bFullCol = (rRange.aStart.Row() === 0) && (rRange.aEnd.Row() >= nMaxRow);
          if (!bHasRowTitles && bFullRow && !bFullCol) {
            rDoc.SetRepeatRowRange(nTab, new ScRange(rRange.aStart.Col(), rRange.aStart.Row(), nTab, rRange.aEnd.Col(), rRange.aEnd.Row(), nTab));
            bHasRowTitles = true;
          } else if (!bHasColTitles && bFullCol && !bFullRow) {
            rDoc.SetRepeatColRange(nTab, new ScRange(rRange.aStart.Col(), rRange.aStart.Row(), nTab, rRange.aEnd.Col(), rRange.aEnd.Row(), nTab));
            bHasColTitles = true;
          }
        }
        break;
      }
    }
  }
}

export class DefinedNamesBuffer {
  private maDefNames: DefinedName[] = [];

  importDefinedName(rAttribs: AttributeList, rFormula: string): DefinedName {
    const xDefName = new DefinedName(rAttribs);
    xDefName.setFormula(rFormula);
    this.maDefNames.push(xDefName);
    return xDefName;
  }

  /** Whether a name refers to another document. */
  hasExternalNames(): boolean { return this.maDefNames.some((n) => !n.isValid()); }

  finalizeImport(rDoc: ScDocument): void {
    // first insert all names without formula definition into the document, and insert them into the maps
    const aValid = this.maDefNames.filter((n) => n.isValid());
    for (const xDefName of aValid) xDefName.createNameObject(rDoc);
    // now convert all name formulas, so that the formula parser can find all names in case of
    // former forward references
    for (const xDefName of aValid) xDefName.convertFormula(rDoc);
  }
}
