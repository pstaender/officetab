// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/compiler.hxx reduced
// @upstream sc/source/core/tool/compiler.cxx reduced
// ScCompiler: tokenizes a formula string of a grammar (the en-US UI's Calc A1, ODFF, OOXML,
// English, Excel A1 and R1C1) into a ScTokenArray (CompileString) and writes token arrays back
// in a grammar (CreateStringFromSingleRef/DoubleRef/Index/Matrix and the conventions'
// makeRefStr). NextSymbol keeps upstream's scanner state machine and character tables; the
// i18n fallback for non-ASCII and quoted symbols (CharClass::parseAnyToken) is a reduced scanner.
// Left out: external references and names, table (structured) references, database ranges,
// column/row labels (ocColRowName), macros, legacy (non-UNO) add-ins, lambda (LET) names,
// auto-correction and the implicit intersection optimisation.
import { FormulaError } from '../../../../include/formula/errorcodes.ts';
import { FormulaGrammar, FormulaLanguage } from '../../../../include/formula/grammar.ts';
import * as OC from '../../../../include/formula/opcode.ts';
import {
  ocAdd, ocArrayClose, ocArrayColSep, ocArrayOpen, ocArrayRowSep, ocBad, ocCeil, ocCeil_Math, ocClose, ocErrRef, ocFalse, ocFloor, ocFloor_Math,
  ocMissing, ocName, ocNegSub, ocNone, ocOpen, ocPush, ocRange, ocSep, ocSpaces, ocSub, ocTrue, ocWhitespace, ocErrName, ocIf, ocIfError, ocIfNA, ocChoose, ocLet,
  ocWeek, ocAddress, ocTableRefOpen, ocTableRefClose, ocSkip, ocDBArea,
  SC_OPCODE_START_BIN_OP, SC_OPCODE_STOP_BIN_OP, type OpCode,
} from '../../../../include/formula/opcode.ts';
import { FormulaCompiler, type OpCodeMap } from '../../../../formula/source/core/api/FormulaCompiler.ts';
import { GetAddInCollection } from './addincol.ts';
import type { ScDBCollection } from './dbdata.ts';
import { g_aAddInMap, type AddInMap } from './odffmap.ts';
import {
  FORMULA_MAXJUMPCOUNT, FORMULA_MAXPARAMS, FormulaByteToken, FormulaDoubleToken, FormulaErrorToken, FormulaExternalToken, FormulaIndexToken, FormulaJumpToken,
  FormulaMissingToken, FormulaSpaceToken, FormulaStringOpToken, FormulaStringToken, FormulaToken, FormulaTokenArrayPlainIterator, ParamClass,
  svDoubleRef, svSep, svSingleRef,
} from '../../../../formula/source/core/api/token.ts';
import { stringToDouble } from '../../../../sal/rtl/math.ts';
import { GetType as NFGetType, IsNumberFormat, SvNumFormatType } from '../../../../svl/source/numbers/zforlist.ts';
import { ScAddress, ScAddressDetails, ScColToAlpha, ScRange, ScRefFlags, ValidTab, FindUnquoted, type ScAddressDocument } from '../../../inc/address.ts';
import { ScComplexRefData, ScSingleRefData } from '../../../inc/refdata.ts';
import type { ScSheetLimits } from '../../../inc/sheetlimits.ts';
import { ScParameterClassification } from './parclass.ts';
import { ScMatrix } from './scmatrix.ts';
import { ScDoubleRefToken, ScSingleRefToken, ScTokenArray, extendRangeReference } from './token.ts';
import type { ScRangeData, ScRangeName } from './rangenam.ts';

/** The document as the compiler sees it: sheets, limits and named expressions. */
export interface ScCompilerDocument extends ScAddressDocument {
  GetRangeName(nTab?: number): ScRangeName | null;
  /** The database ranges (named ones are found by name in formulas). */
  GetDBCollection?(): ScDBCollection;
  IsExpandRefs(): boolean;
  IsImportingXML?(): boolean;
}

export const ScCharFlags = {
  NONE: 0x00000000,
  Illegal: 0x00000000,
  Char: 0x00000001,
  CharBool: 0x00000002,
  CharWord: 0x00000004,
  CharValue: 0x00000008,
  CharString: 0x00000010,
  CharDontCare: 0x00000020,
  Bool: 0x00000040,
  Word: 0x00000080,
  WordSep: 0x00000100,
  Value: 0x00000200,
  ValueSep: 0x00000400,
  ValueExp: 0x00000800,
  ValueSign: 0x00001000,
  ValueValue: 0x00002000,
  StringSep: 0x00004000,
  NameSep: 0x00008000, // there can be only one! '\''
  CharIdent: 0x00010000, // identifier (built-in function) or reference start
  Ident: 0x00020000, // identifier or reference continuation
  OdfLBracket: 0x00040000, // ODF '[' reference bracket
  OdfRBracket: 0x00080000, // ODF ']' reference bracket
  OdfLabelOp: 0x00100000, // ODF '!!' automatic intersection of labels
  OdfNameMarker: 0x00200000, // ODF '$$' marker that starts a defined (range) name
  CharName: 0x00400000, // start character of a defined name
  Name: 0x00800000, // continuation character of a defined name
  CharErrConst: 0x01000000, // start character of an error constant ('#')
} as const;
const F = ScCharFlags;

export const SC_COMPILER_FILE_TAB_SEP = '#'; // 'Doc'#Tab

const ScanState = {
  ssGetChar: 0, ssGetBool: 1, ssGetValue: 2, ssGetString: 3, ssSkipString: 4, ssGetIdent: 5, ssGetReference: 6, ssSkipReference: 7,
  ssGetErrorConstant: 8, ssGetTableRefItem: 9, ssGetTableRefColumn: 10, ssStop: 11,
} as const;

function makeCommonCharTable(): number[] {
  const a = new Array<number>(128).fill(F.Illegal);
  const c = (ch: string) => ch.charCodeAt(0);
  // Allow tabs/newlines.
  // Allow saving whitespace as is (as per OpenFormula specification v.1.2, clause 5.14 "Whitespace").
  a[c('\t')] = F.CharDontCare | F.WordSep | F.ValueSep;
  a[c('\n')] = F.CharDontCare | F.WordSep | F.ValueSep;
  a[c('\r')] = F.CharDontCare | F.WordSep | F.ValueSep;
  a[c(' ')] = F.CharDontCare | F.WordSep | F.ValueSep;
  a[c('!')] = F.Char | F.WordSep | F.ValueSep;
  a[c('"')] = F.CharString | F.StringSep;
  a[c('#')] = F.WordSep | F.CharErrConst;
  a[c('$')] = F.CharWord | F.Word | F.CharIdent | F.Ident;
  a[c('%')] = F.Char | F.WordSep | F.ValueSep;
  a[c('&')] = F.Char | F.WordSep | F.ValueSep;
  a[c('\'')] = F.NameSep;
  a[c('(')] = F.Char | F.WordSep | F.ValueSep;
  a[c(')')] = F.Char | F.WordSep | F.ValueSep;
  a[c('*')] = F.Char | F.WordSep | F.ValueSep;
  a[c('+')] = F.Char | F.WordSep | F.ValueExp | F.ValueSign;
  a[c(',')] = F.CharValue | F.Value;
  a[c('-')] = F.Char | F.WordSep | F.ValueExp | F.ValueSign;
  a[c('.')] = F.Word | F.CharValue | F.Value | F.Ident | F.Name;
  a[c('/')] = F.Char | F.WordSep | F.ValueSep;
  for (let i = c('0'); i <= c('9'); i++) a[i] = F.CharValue | F.Word | F.Value | F.ValueExp | F.ValueValue | F.Ident | F.Name;
  a[c(':')] = F.Char | F.Word;
  a[c(';')] = F.Char | F.WordSep | F.ValueSep;
  a[c('<')] = F.CharBool | F.WordSep | F.ValueSep;
  a[c('=')] = F.Char | F.Bool | F.WordSep | F.ValueSep;
  a[c('>')] = F.CharBool | F.Bool | F.WordSep | F.ValueSep;
  a[c('?')] = F.CharWord | F.Word | F.Name;
  /* @ */ // FREE
  for (let i = c('A'); i <= c('Z'); i++) a[i] = F.CharWord | F.Word | F.CharIdent | F.Ident | F.CharName | F.Name;
  a[c('^')] = F.Char | F.WordSep | F.ValueSep;
  a[c('_')] = F.CharWord | F.Word | F.CharIdent | F.Ident | F.CharName | F.Name;
  for (let i = c('a'); i <= c('z'); i++) a[i] = F.CharWord | F.Word | F.CharIdent | F.Ident | F.CharName | F.Name;
  a[c('{')] = F.Char | F.WordSep | F.ValueSep; // array open
  a[c('|')] = F.Char | F.WordSep | F.ValueSep; // array row sep (Should be OOo specific)
  a[c('}')] = F.Char | F.WordSep | F.ValueSep; // array close
  a[c('~')] = F.Char; // OOo specific
  return a;
}

function makeCharTable(eConv: FormulaGrammar.AddressConvention): number[] {
  const a = makeCommonCharTable();
  const c = (ch: string) => ch.charCodeAt(0);
  switch (eConv) {
    case FormulaGrammar.CONV_ODF:
      a[c('!')] |= F.OdfLabelOp;
      a[c('$')] |= F.OdfNameMarker;
      a[c('[')] = F.OdfLBracket;
      a[c(']')] = F.OdfRBracket;
      return a;
    case FormulaGrammar.CONV_XL_A1:
    case FormulaGrammar.CONV_XL_OOX:
    case FormulaGrammar.CONV_XL_R1C1: {
      a[c(' ')] |= F.Word;
      a[c('!')] |= F.Ident | F.Word;
      a[c('"')] |= F.Word;
      a[c('#')] &= ~F.WordSep;
      a[c('#')] |= F.Word;
      a[c('%')] |= F.Word;
      a[c('&')] |= F.Word;
      a[c('\'')] |= F.Word;
      a[c('(')] |= F.Word;
      a[c(')')] |= F.Word;
      a[c('*')] |= F.Word;
      a[c('+')] |= F.Word;
      a[c(',')] |= F.Word;
      a[c('-')] |= F.Word;
      a[c(';')] |= F.Word;
      a[c('<')] |= F.Word;
      a[c('=')] |= F.Word;
      a[c('>')] |= F.Word;
      /* ? */ // question really is not permitted in sheet name
      a[c('@')] |= F.Word;
      a[c('[')] = F.Word;
      a[c(']')] = F.Word;
      a[c('{')] |= F.Word;
      a[c('|')] |= F.Word;
      a[c('}')] |= F.Word;
      a[c('~')] |= F.Word;
      if (eConv === FormulaGrammar.CONV_XL_R1C1) {
        a[c('[')] |= F.Ident;
        a[c(']')] |= F.Ident;
      } else {
        a[c('[')] |= F.Char;
        a[c(']')] |= F.Char;
        if (eConv === FormulaGrammar.CONV_XL_OOX) {
          a[c('[')] |= F.CharIdent;
          a[c(']')] |= F.Ident;
        }
      }
      return a;
    }
    default: // CONV_OOO
      a[c('[')] = F.Char;
      a[c(']')] = F.Char;
      return a;
  }
}

const STR_NO_REF_TABLE = '#REF!';

const SingletonDisplay = { SINGLETON_NONE: 0, SINGLETON_COL: 1, SINGLETON_ROW: 2 } as const;
type SingletonDisplay = (typeof SingletonDisplay)[keyof typeof SingletonDisplay];

/** ScCompiler::Convention: an address convention's character table and reference writer. */
export abstract class Convention {
  readonly meConv: FormulaGrammar.AddressConvention;
  protected mrCharTable: number[];
  constructor(eConv: FormulaGrammar.AddressConvention) {
    this.meConv = eConv;
    this.mrCharTable = makeCharTable(eConv);
  }
  getCharTableFlags(c: string, _cLast: string): number { return this.mrCharTable[c.charCodeAt(0)] ?? 0; }
  abstract makeRefStr(rLimits: ScSheetLimits, eGram: FormulaGrammar.Grammar, rPos: ScAddress, rErrRef: string, rTabNames: string[], rRef: ScComplexRefData, bSingleRef: boolean, bFromRangeName: boolean): string;
  /** ABS_SHEET_PREFIX or SHEET_SEPARATOR */
  abstract getSpecialSymbol(eSymType: 'ABS_SHEET_PREFIX' | 'SHEET_SEPARATOR'): string;
  /** The characters a symbol of this convention may additionally contain (parseAnyToken). */
  abstract addAllowed(): string;
}

function MakeColStr(rLimits: ScSheetLimits, nCol: number): string {
  if (!rLimits.ValidCol(nCol)) return STR_NO_REF_TABLE;
  return ScColToAlpha(nCol);
}

function MakeRowStr(rLimits: ScSheetLimits, nRow: number): string {
  if (!rLimits.ValidRow(nRow)) return STR_NO_REF_TABLE;
  return String(nRow + 1);
}

class ConventionOOO_A1 extends Convention {
  constructor(eConv: FormulaGrammar.AddressConvention = FormulaGrammar.CONV_OOO) { super(eConv); }

  static MakeTabStr(rTabNames: string[], nTab: number): string {
    if (nTab >= rTabNames.length) return `${STR_NO_REF_TABLE}.`;
    return `${rTabNames[nTab]}.`;
  }

  static MakeOneRefStrImpl(rLimits: ScSheetLimits, rErrRef: string, rTabNames: string[], rRef: ScSingleRefData, rAbsRef: ScAddress, bForceTab: boolean, bODF: boolean, eSingletonDisplay: SingletonDisplay): string {
    let rBuffer = '';
    if (rRef.IsFlag3D() || bForceTab) {
      if (!ValidTab(rAbsRef.Tab()) || rRef.IsTabDeleted()) {
        if (!rRef.IsTabRel()) rBuffer += '$';
        rBuffer += rErrRef;
        rBuffer += '.';
      } else {
        if (!rRef.IsTabRel()) rBuffer += '$';
        rBuffer += ConventionOOO_A1.MakeTabStr(rTabNames, rAbsRef.Tab());
      }
    } else if (bODF) rBuffer += '.';

    if (eSingletonDisplay !== SingletonDisplay.SINGLETON_ROW) {
      if (!rRef.IsColRel()) rBuffer += '$';
      if (!rLimits.ValidCol(rAbsRef.Col()) || rRef.IsColDeleted()) rBuffer += rErrRef;
      else rBuffer += MakeColStr(rLimits, rAbsRef.Col());
    }

    if (eSingletonDisplay !== SingletonDisplay.SINGLETON_COL) {
      if (!rRef.IsRowRel()) rBuffer += '$';
      if (!rLimits.ValidRow(rAbsRef.Row()) || rRef.IsRowDeleted()) rBuffer += rErrRef;
      else rBuffer += MakeRowStr(rLimits, rAbsRef.Row());
    }
    return rBuffer;
  }

  static getSingletonDisplay(rLimits: ScSheetLimits, rAbs1: ScAddress, rAbs2: ScAddress, rRef: ScComplexRefData, bFromRangeName: boolean): SingletonDisplay {
    // If any part is error, display as such.
    if (!rLimits.ValidCol(rAbs1.Col()) || rRef.Ref1.IsColDeleted() || !rLimits.ValidRow(rAbs1.Row()) || rRef.Ref1.IsRowDeleted()
      || !rLimits.ValidCol(rAbs2.Col()) || rRef.Ref2.IsColDeleted() || !rLimits.ValidRow(rAbs2.Row()) || rRef.Ref2.IsRowDeleted())
      return SingletonDisplay.SINGLETON_NONE;

    // A:A or $A:$A or A:$A or $A:A
    if (rRef.IsEntireCol(rLimits)) return SingletonDisplay.SINGLETON_COL;

    // Same if not in named expression and both rows of entire columns are
    // relative references.
    if (!bFromRangeName && rAbs1.Row() === 0 && rAbs2.Row() === rLimits.mnMaxRow && rRef.Ref1.IsRowRel() && rRef.Ref2.IsRowRel())
      return SingletonDisplay.SINGLETON_COL;

    // 1:1 or $1:$1 or 1:$1 or $1:1
    if (rRef.IsEntireRow(rLimits)) return SingletonDisplay.SINGLETON_ROW;

    // Same if not in named expression and both columns of entire rows are
    // relative references.
    if (!bFromRangeName && rAbs1.Col() === 0 && rAbs2.Col() === rLimits.mnMaxCol && rRef.Ref1.IsColRel() && rRef.Ref2.IsColRel())
      return SingletonDisplay.SINGLETON_ROW;

    return SingletonDisplay.SINGLETON_NONE;
  }

  override makeRefStr(rLimits: ScSheetLimits, _eGram: FormulaGrammar.Grammar, rPos: ScAddress, rErrRef: string, rTabNames: string[], rRef: ScComplexRefData, bSingleRef: boolean, bFromRangeName: boolean): string {
    // In case absolute/relative positions weren't separately available:
    // transform relative to absolute!
    const aAbs1 = rRef.Ref1.toAbs(rLimits, rPos);
    const aAbs2 = bSingleRef ? new ScAddress() : rRef.Ref2.toAbs(rLimits, rPos);
    const eSingleton = bSingleRef ? SingletonDisplay.SINGLETON_NONE : ConventionOOO_A1.getSingletonDisplay(rLimits, aAbs1, aAbs2, rRef, bFromRangeName);
    let r = ConventionOOO_A1.MakeOneRefStrImpl(rLimits, rErrRef, rTabNames, rRef.Ref1, aAbs1, false, false, eSingleton);
    if (!bSingleRef) {
      r += ':';
      r += ConventionOOO_A1.MakeOneRefStrImpl(rLimits, rErrRef, rTabNames, rRef.Ref2, aAbs2, aAbs1.Tab() !== aAbs2.Tab(), false, eSingleton);
    }
    return r;
  }

  override getSpecialSymbol(eSymType: 'ABS_SHEET_PREFIX' | 'SHEET_SEPARATOR'): string {
    return eSymType === 'ABS_SHEET_PREFIX' ? '$' : '.';
  }

  override addAllowed(): string { return '?#'; } // '?' allowed in range names because of Xcl :-/
}

class ConventionOOO_A1_ODF extends ConventionOOO_A1 {
  constructor() { super(FormulaGrammar.CONV_ODF); }

  override makeRefStr(rLimits: ScSheetLimits, eGram: FormulaGrammar.Grammar, rPos: ScAddress, rErrRef: string, rTabNames: string[], rRef: ScComplexRefData, bSingleRef: boolean, bFromRangeName: boolean): string {
    let rBuffer = '[';
    // In case absolute/relative positions weren't separately available:
    // transform relative to absolute!
    const aAbs1 = rRef.Ref1.toAbs(rLimits, rPos);
    const aAbs2 = bSingleRef ? new ScAddress() : rRef.Ref2.toAbs(rLimits, rPos);
    if (FormulaGrammar.isODFF(eGram) && (rRef.Ref1.IsDeleted() || !rLimits.ValidAddress(aAbs1) || (!bSingleRef && (rRef.Ref2.IsDeleted() || !rLimits.ValidAddress(aAbs2))))) {
      rBuffer += rErrRef;
      // For ODFF write [#REF!], but not for PODF so apps reading ODF
      // 1.0/1.1 may have a better chance if they implemented the old
      // form.
    } else {
      const eSingleton = bSingleRef ? SingletonDisplay.SINGLETON_NONE : ConventionOOO_A1.getSingletonDisplay(rLimits, aAbs1, aAbs2, rRef, bFromRangeName);
      rBuffer += ConventionOOO_A1.MakeOneRefStrImpl(rLimits, rErrRef, rTabNames, rRef.Ref1, aAbs1, false, true, eSingleton);
      if (!bSingleRef) {
        rBuffer += ':';
        rBuffer += ConventionOOO_A1.MakeOneRefStrImpl(rLimits, rErrRef, rTabNames, rRef.Ref2, aAbs2, aAbs1.Tab() !== aAbs2.Tab(), true, eSingleton);
      }
    }
    rBuffer += ']';
    return rBuffer;
  }
}

/** ConventionXL: the sheet part of Excel references. */
function XL_GetTab(rLimits: ScSheetLimits, rPos: ScAddress, rTabNames: string[], rRef: ScSingleRefData): string {
  const aAbs = rRef.toAbs(rLimits, rPos);
  if (rRef.IsTabDeleted() || aAbs.Tab() < 0 || aAbs.Tab() >= rTabNames.length) return STR_NO_REF_TABLE;
  return rTabNames[aAbs.Tab()]!;
}

function XL_MakeTabStr(rLimits: ScSheetLimits, rPos: ScAddress, rTabNames: string[], rRef: ScComplexRefData, bSingleRef: boolean): string {
  if (!rRef.Ref1.IsFlag3D()) return '';
  const aStartTabName = XL_GetTab(rLimits, rPos, rTabNames, rRef.Ref1);
  let aEndTabName = '';
  if (!bSingleRef && rRef.Ref2.IsFlag3D()) aEndTabName = XL_GetTab(rLimits, rPos, rTabNames, rRef.Ref2);
  let rBuf = aStartTabName;
  if (!bSingleRef && rRef.Ref2.IsFlag3D() && aStartTabName !== aEndTabName) rBuf = FormExcelSheetRange(rBuf, 0, aEndTabName);
  rBuf += '!';
  return rBuf;
}

class ConventionXL_A1 extends Convention {
  constructor(eConv: FormulaGrammar.AddressConvention = FormulaGrammar.CONV_XL_A1) { super(eConv); }

  static makeSingleCellStr(rLimits: ScSheetLimits, rRef: ScSingleRefData, rAbs: ScAddress): string {
    let rBuf = '';
    if (!rRef.IsColRel()) rBuf += '$';
    rBuf += MakeColStr(rLimits, rAbs.Col());
    if (!rRef.IsRowRel()) rBuf += '$';
    rBuf += MakeRowStr(rLimits, rAbs.Row());
    return rBuf;
  }

  override makeRefStr(rLimits: ScSheetLimits, _eGram: FormulaGrammar.Grammar, rPos: ScAddress, rErrRef: string, rTabNames: string[], rRef: ScComplexRefData, bSingleRef: boolean, _bFromRangeName: boolean): string {
    const aRef = rRef;
    // Play fast and loose with invalid refs.  There is not much point in producing
    // Foo!A1:#REF! versus #REF! at this point
    const aAbs1 = aRef.Ref1.toAbs(rLimits, rPos);
    let aAbs2 = new ScAddress();
    let rBuf = XL_MakeTabStr(rLimits, rPos, rTabNames, aRef, bSingleRef);

    if (!rLimits.ValidAddress(aAbs1)) return rBuf + rErrRef;

    if (!bSingleRef) {
      aAbs2 = aRef.Ref2.toAbs(rLimits, rPos);
      if (!rLimits.ValidAddress(aAbs2)) return rBuf + rErrRef;

      if (aAbs1.Col() === 0 && aAbs2.Col() >= rLimits.mnMaxCol) {
        if (!aRef.Ref1.IsRowRel()) rBuf += '$';
        rBuf += MakeRowStr(rLimits, aAbs1.Row());
        rBuf += ':';
        if (!aRef.Ref2.IsRowRel()) rBuf += '$';
        rBuf += MakeRowStr(rLimits, aAbs2.Row());
        return rBuf;
      }

      if (aAbs1.Row() === 0 && aAbs2.Row() >= rLimits.mnMaxRow) {
        if (!aRef.Ref1.IsColRel()) rBuf += '$';
        rBuf += MakeColStr(rLimits, aAbs1.Col());
        rBuf += ':';
        if (!aRef.Ref2.IsColRel()) rBuf += '$';
        rBuf += MakeColStr(rLimits, aAbs2.Col());
        return rBuf;
      }
    }

    rBuf += ConventionXL_A1.makeSingleCellStr(rLimits, aRef.Ref1, aAbs1);
    if (!bSingleRef && (aAbs1.Row() !== aAbs2.Row() || aRef.Ref1.IsRowRel() !== aRef.Ref2.IsRowRel() || aAbs1.Col() !== aAbs2.Col() || aRef.Ref1.IsColRel() !== aRef.Ref2.IsColRel())) {
      rBuf += ':';
      rBuf += ConventionXL_A1.makeSingleCellStr(rLimits, aRef.Ref2, aAbs2);
    }
    return rBuf;
  }

  override getSpecialSymbol(eSymType: 'ABS_SHEET_PREFIX' | 'SHEET_SEPARATOR'): string {
    return eSymType === 'ABS_SHEET_PREFIX' ? '\0' : '!';
  }

  override addAllowed(): string { return '?!'; } // '?' allowed in range names
}

class ConventionXL_OOX extends ConventionXL_A1 {
  constructor() { super(FormulaGrammar.CONV_XL_OOX); }

  override makeRefStr(rLimits: ScSheetLimits, eGram: FormulaGrammar.Grammar, rPos: ScAddress, rErrRef: string, rTabNames: string[], rRef: ScComplexRefData, bSingleRef: boolean, bFromRangeName: boolean): string {
    // In OOXML relative references in named expressions are relative to
    // column 0 and row 0. Relative sheet references don't exist.
    const aPos = rPos.clone();
    if (bFromRangeName) {
      // XXX NOTE: by decrementing the reference position we may end up
      // with resolved references with negative values. There's no proper
      // way to solve that or wrap them around without sheet dimensions
      // that are stored along. That, or blindly assume fixed dimensions
      // here and in import.
      aPos.SetCol(0);
      aPos.SetRow(0);
    }

    if (rRef.Ref1.IsDeleted() || (!bSingleRef && rRef.Ref2.IsDeleted())) {
      // For OOXML write plain "#REF!" instead of detailed sheet/col/row
      // information.
      return rErrRef;
    }

    {
      const aAbs1 = rRef.Ref1.toAbs(rLimits, rPos);
      if (!rLimits.ValidAddress(aAbs1) || aAbs1.Tab() >= rTabNames.length) return rErrRef;
    }

    if (!bSingleRef) {
      const aAbs2 = rRef.Ref2.toAbs(rLimits, rPos);
      if (!rLimits.ValidAddress(aAbs2) || aAbs2.Tab() >= rTabNames.length) return rErrRef;
    }

    return super.makeRefStr(rLimits, eGram, aPos, rErrRef, rTabNames, rRef, bSingleRef, bFromRangeName);
  }
}

function r1c1_add_col(rRef: ScSingleRefData, rAbsRef: ScAddress): string {
  let rBuf = 'C';
  if (rRef.IsColRel()) {
    const nCol = rRef.Col();
    if (nCol !== 0) rBuf += `[${nCol}]`;
  } else rBuf += String(rAbsRef.Col() + 1);
  return rBuf;
}

function r1c1_add_row(rRef: ScSingleRefData, rAbsRef: ScAddress): string {
  let rBuf = 'R';
  if (rRef.IsRowRel()) {
    if (rRef.Row() !== 0) rBuf += `[${rRef.Row()}]`;
  } else rBuf += String(rAbsRef.Row() + 1);
  return rBuf;
}

class ConventionXL_R1C1 extends Convention {
  constructor() { super(FormulaGrammar.CONV_XL_R1C1); }

  override getCharTableFlags(c: string, cLast: string): number {
    let nFlags = this.mrCharTable[c.charCodeAt(0)] ?? 0;
    // '-' can occur within a reference string only after '[' e.g. R[-1]C.
    if (c === '-' && cLast === '[') nFlags |= F.Ident;
    return nFlags;
  }

  override makeRefStr(rLimits: ScSheetLimits, _eGram: FormulaGrammar.Grammar, rPos: ScAddress, rErrRef: string, rTabNames: string[], rRef: ScComplexRefData, bSingleRef: boolean, _bFromRangeName: boolean): string {
    const aAbsRef = rRef.toAbs(rLimits, rPos);
    let rBuf = XL_MakeTabStr(rLimits, rPos, rTabNames, rRef, bSingleRef);

    // Play fast and loose with invalid refs.  There is not much point in producing
    // Foo!A1:#REF! versus #REF! at this point
    if (!rLimits.ValidCol(aAbsRef.aStart.Col()) || !rLimits.ValidRow(aAbsRef.aStart.Row())) return rBuf + rErrRef;

    if (!bSingleRef) {
      if (!rLimits.ValidCol(aAbsRef.aEnd.Col()) || !rLimits.ValidRow(aAbsRef.aEnd.Row())) return rBuf + rErrRef;

      if (aAbsRef.aStart.Col() === 0 && aAbsRef.aEnd.Col() >= rLimits.mnMaxCol) {
        rBuf += r1c1_add_row(rRef.Ref1, aAbsRef.aStart);
        if (aAbsRef.aStart.Row() !== aAbsRef.aEnd.Row() || rRef.Ref1.IsRowRel() !== rRef.Ref2.IsRowRel()) {
          rBuf += ':';
          rBuf += r1c1_add_row(rRef.Ref2, aAbsRef.aEnd);
        }
        return rBuf;
      }

      if (aAbsRef.aStart.Row() === 0 && aAbsRef.aEnd.Row() >= rLimits.mnMaxRow) {
        rBuf += r1c1_add_col(rRef.Ref1, aAbsRef.aStart);
        if (aAbsRef.aStart.Col() !== aAbsRef.aEnd.Col() || rRef.Ref1.IsColRel() !== rRef.Ref2.IsColRel()) {
          rBuf += ':';
          rBuf += r1c1_add_col(rRef.Ref2, aAbsRef.aEnd);
        }
        return rBuf;
      }
    }

    rBuf += r1c1_add_row(rRef.Ref1, aAbsRef.aStart);
    rBuf += r1c1_add_col(rRef.Ref1, aAbsRef.aStart);
    if (!bSingleRef) {
      rBuf += ':';
      rBuf += r1c1_add_row(rRef.Ref2, aAbsRef.aEnd);
      rBuf += r1c1_add_col(rRef.Ref2, aAbsRef.aEnd);
    }
    return rBuf;
  }

  override getSpecialSymbol(eSymType: 'ABS_SHEET_PREFIX' | 'SHEET_SEPARATOR'): string {
    return eSymType === 'ABS_SHEET_PREFIX' ? '\0' : '!';
  }

  override addAllowed(): string { return '?-[]!'; } // '?' allowed in range names
}

const pConventions = new Map<FormulaGrammar.AddressConvention, Convention>();
function GetRefConvention(eConv: FormulaGrammar.AddressConvention): Convention {
  let p = pConventions.get(eConv);
  if (p) return p;
  switch (eConv) {
    case FormulaGrammar.CONV_ODF: p = new ConventionOOO_A1_ODF(); break;
    case FormulaGrammar.CONV_XL_A1: p = new ConventionXL_A1(); break;
    case FormulaGrammar.CONV_XL_R1C1: p = new ConventionXL_R1C1(); break;
    case FormulaGrammar.CONV_XL_OOX: p = new ConventionXL_OOX(); break;
    default: p = new ConventionOOO_A1(); break;
  }
  pConventions.set(eConv, p);
  return p;
}

// --- static helpers (used by address.ts as well) -----------------------------------------------

function lcl_TabContainsReference(rString: string): boolean {
  const nLen = rString.length;
  let nPos = 0;
  const isAlpha = (c: string | undefined) => c !== undefined && /[A-Za-z]/.test(c);
  const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';

  if (nLen < 2 || !isAlpha(rString[0])) return false;

  // If the first two characters are a R1C1 style reference, Excel always quotes the string
  const first = rString[0];
  if ((first === 'R' || first === 'r' || first === 'C' || first === 'c') && isDigit(rString[1])) return true;

  // Check for A1 style refernce
  while (nPos < nLen && isAlpha(rString[nPos])) nPos++;
  const nAlphaEnd = nPos;
  while (nPos < nLen && isDigit(rString[nPos])) nPos++;

  if (nPos !== nLen || nAlphaEnd === nLen || nAlphaEnd > 3) return false;

  // Max row: 2^20 and Max col: XFD
  const MAX_ROW = 1048576;
  const sCol = rString.slice(0, nAlphaEnd).toUpperCase();
  const nRow = Number(rString.slice(nAlphaEnd));
  const bValidCol = nAlphaEnd < 3 || sCol < 'XFD';
  const bValidRow = nRow > 0 && nRow <= MAX_ROW;
  return bValidCol && bValidRow;
}

/** ScCompiler::CheckTabQuotes: the sheet name quoted where the convention needs it. */
export function CheckTabQuotes(rString: string, eConv: FormulaGrammar.AddressConvention): string {
  // parsePredefinedToken(IDENTNAME) with ANY_LETTER | ASC_UNDERSCORE start and ANY_NUMBER
  // continuation: the whole string must be one such identifier.
  const bIdent = /^[\p{L}_][\p{L}\p{N}_]*$/u.test(rString);
  const bNeedsQuote = !bIdent || lcl_TabContainsReference(rString);

  switch (eConv) {
    default:
    case FormulaGrammar.CONV_UNSPECIFIED:
      break;
    case FormulaGrammar.CONV_OOO:
    case FormulaGrammar.CONV_XL_A1:
    case FormulaGrammar.CONV_XL_R1C1:
    case FormulaGrammar.CONV_XL_OOX:
    case FormulaGrammar.CONV_ODF:
      // escape embedded quotes
      if (bNeedsQuote) rString = rString.replaceAll('\'', '\'\'');
      break;
  }
  if (bNeedsQuote) rString = `'${rString}'`;
  return rString;
}

/** ScCompiler::FormExcelSheetRange: appends :EndTab to the buffer, merging the quotes. */
export function FormExcelSheetRange(rBuf: string, nQuotePos: number, rEndTabName: string): string {
  let aEndTabName = rEndTabName;
  if (nQuotePos < rBuf.length) {
    const bQuoted1 = rBuf[nQuotePos] === '\'';
    const bQuoted2 = !!aEndTabName && aEndTabName[0] === '\'';
    if (bQuoted1 && bQuoted2) { // Both sheets are quoted
      rBuf = rBuf.slice(0, -1);
      aEndTabName = aEndTabName.slice(1);
    } else if (bQuoted1) { // Only Sheet1 is quoted
      rBuf = rBuf.slice(0, -1);
      if (aEndTabName) aEndTabName += '\'';
    } else if (bQuoted2) { // Only Sheet2 is quoted
      rBuf = `${rBuf.slice(0, nQuotePos)}'${rBuf.slice(nQuotePos)}`;
      aEndTabName = aEndTabName.slice(1);
    }
  }
  return `${rBuf}:${aEndTabName}`;
}

/** ScCompiler::GetDocTabPos: the position of the # of a 'Doc'#Tab name, -1 if none. */
export function GetDocTabPos(rString: string): number {
  if (rString[0] !== '\'') return -1;
  let nPos = FindUnquoted(rString, SC_COMPILER_FILE_TAB_SEP);
  // it must be 'Doc'#
  if (nPos !== -1 && rString[nPos - 1] !== '\'') nPos = -1;
  return nPos;
}

/** ExtendedErrorDetection */
export const ExtendedErrorDetection = { EXTENDED_ERROR_DETECTION_NONE: 0, EXTENDED_ERROR_DETECTION_NAME_BREAK: 1, EXTENDED_ERROR_DETECTION_NAME_NO_BREAK: 2 } as const;

const MAXSTRLEN = 1024;

export class ScCompiler extends FormulaCompiler {
  private rDoc: ScCompilerDocument;
  private aPos: ScAddress;
  private pConv: Convention;
  private aFormula = '';
  private nSrcPos = 0;
  private cSymbol = '';
  /** The token NextNewToken produced (upstream's ScRawToken). */
  private maRawToken: FormulaToken = new FormulaByteToken(ocNone);
  private maPendingOpCodes: OpCode[] = [];
  private mnRangeOpPosInSymbol = -1;
  private mnPredetectedReference = 0;
  private mnCurrentSheetEndPos = 0;
  private mnCurrentSheetTab = -1;
  private mbRewind = false;
  private mbCloseBrackets = true;
  private meExtendedErrorDetection: number = ExtendedErrorDetection.EXTENDED_ERROR_DETECTION_NONE;
  private maTabNames: string[] | null = null;

  constructor(rDoc: ScCompilerDocument, rPos: ScAddress, rArr?: ScTokenArray | null, eGrammar: FormulaGrammar.Grammar = FormulaGrammar.GRAM_DEFAULT, bMatrixFlag = false) {
    super(rArr ?? null, bMatrixFlag);
    this.rDoc = rDoc;
    this.aPos = rPos.clone();
    this.pConv = GetRefConvention(FormulaGrammar.CONV_OOO);
    this.SetGrammar(eGrammar === FormulaGrammar.GRAM_UNSPECIFIED ? FormulaGrammar.GRAM_DEFAULT : eGrammar);
  }

  static CheckTabQuotes(rString: string, eConv: FormulaGrammar.AddressConvention = FormulaGrammar.CONV_OOO): string { return CheckTabQuotes(rString, eConv); }
  static FormExcelSheetRange(rBuf: string, nQuotePos: number, rEndTabName: string): string { return FormExcelSheetRange(rBuf, nQuotePos, rEndTabName); }
  static GetDocTabPos(rString: string): number { return GetDocTabPos(rString); }
  static GetRefConvention(eConv: FormulaGrammar.AddressConvention): Convention { return GetRefConvention(eConv); }

  // --- add-in names (fillFromAddIn*, FindAddInFunction, LocalizeString, GetExcelName) ---

  protected override HasAddInMappings(): boolean { return true; }

  override fillFromAddInMap(xMap: OpCodeMap, _eGrammar: FormulaGrammar.Grammar): void {
    let nSymbolOffset: keyof AddInMap;
    switch (_eGrammar) {
      // XFunctionAccess and XCell::setFormula()/getFormula() API always used
      // PODF grammar symbols, keep it.
      case FormulaGrammar.GRAM_API:
      case FormulaGrammar.GRAM_PODF:
        nSymbolOffset = 'pUpper';
        break;
      default:
      case FormulaGrammar.GRAM_ODFF:
        nSymbolOffset = 'pODFF';
        break;
      case FormulaGrammar.GRAM_ENGLISH:
        nSymbolOffset = 'pEnglish';
        break;
    }
    for (const pMap of g_aAddInMap) xMap.putExternal(pMap[nSymbolOffset], pMap.pOriginal);
    if (_eGrammar === FormulaGrammar.GRAM_API) {
      // Add English names additionally to programmatic names, so they
      // can be used in XCell::setFormula() non-localized API calls.
      // Note the reverse map will still deliver programmatic names for
      // XCell::getFormula().
      for (const pMap of g_aAddInMap) xMap.putExternal(pMap.pEnglish, pMap.pOriginal);
    }
  }

  override fillFromAddInCollectionUpperName(xMap: OpCodeMap): void {
    const pColl = GetAddInCollection();
    const nCount = pColl.GetFuncCount();
    for (let i = 0; i < nCount; ++i) {
      const pFuncData = pColl.GetFuncData(i);
      if (pFuncData) xMap.putExternalSoftly(pFuncData.GetUpperName(), pFuncData.GetOriginalName());
    }
  }

  override fillFromAddInCollectionEnglishName(xMap: OpCodeMap): void {
    const pColl = GetAddInCollection();
    const nCount = pColl.GetFuncCount();
    for (let i = 0; i < nCount; ++i) {
      const pFuncData = pColl.GetFuncData(i);
      if (pFuncData) {
        const aName = pFuncData.GetUpperEnglish();
        if (aName) xMap.putExternalSoftly(aName, pFuncData.GetOriginalName());
        else xMap.putExternalSoftly(pFuncData.GetUpperName(), pFuncData.GetOriginalName());
      }
    }
  }

  override fillFromAddInCollectionExcelName(xMap: OpCodeMap): void {
    const pColl = GetAddInCollection();
    const nCount = pColl.GetFuncCount();
    for (let i = 0; i < nCount; ++i) {
      const pFuncData = pColl.GetFuncData(i);
      const aExcelName = pFuncData ? pFuncData.GetExcelName('en-US', true) : null;
      if (pFuncData && aExcelName !== null) {
        // Note that function names not defined in OOXML but implemented by
        // Excel should have the "_xlfn." prefix. We have no way to check
        // though what an Add-In actually implements.
        xMap.putExternalSoftly(aExcelName.toUpperCase(), pFuncData.GetOriginalName());
      }
    }
  }

  /** The exact name of an add-in function by its upper-case name (FindAddInFunction). */
  FindAddInFunction(rUpperName: string, bLocalFirst: boolean): string {
    return GetAddInCollection().FindFunction(rUpperName, bLocalFirst); // bLocalFirst=false for english
  }

  protected override LocalizeString(rName: string): string {
    return GetAddInCollection().LocalizeString(rName);
  }

  protected override GetExcelName(rName: string): string | null {
    return GetAddInCollection().GetExcelName(rName, 'en-US');
  }

  override SetGrammar(eGrammar: FormulaGrammar.Grammar): void {
    // Edit engine / UI grammars default to the document's convention (Calc A1).
    if (eGrammar === FormulaGrammar.GRAM_UNSPECIFIED) eGrammar = FormulaGrammar.GRAM_DEFAULT;
    super.SetGrammar(eGrammar);
    let eConv = FormulaGrammar.extractRefConvention(eGrammar);
    if (eConv === FormulaGrammar.CONV_UNSPECIFIED) eConv = FormulaGrammar.CONV_OOO;
    this.pConv = GetRefConvention(eConv);
    this.meGrammar = FormulaGrammar.mergeToGrammar(eGrammar, eConv);
  }

  SetRefConvention(eConv: FormulaGrammar.AddressConvention): void {
    this.pConv = GetRefConvention(eConv);
    this.meGrammar = FormulaGrammar.mergeToGrammar(this.meGrammar, eConv);
  }

  SetExtendedErrorDetection(eVal: number): void { this.meExtendedErrorDetection = eVal; }
  SetCloseBrackets(bVal: boolean): void { this.mbCloseBrackets = bVal; }

  /** The sheet names quoted for the convention (GetSetupTabNames). */
  private GetSetupTabNames(): string[] {
    if (!this.maTabNames) {
      this.maTabNames = [];
      for (let i = 0; i < this.rDoc.GetTableCount(); i++) this.maTabNames.push(CheckTabQuotes(this.rDoc.GetName(i) ?? '', this.pConv.meConv));
    }
    return this.maTabNames;
  }

  override SetError(nError: FormulaError): void {
    if (this.pArr && this.pArr.GetCodeError() === FormulaError.NONE) this.pArr.SetCodeError(nError);
  }

  private GetCharTableFlags(c: string, cLast: string): number {
    return c.charCodeAt(0) < 128 ? this.pConv.getCharTableFlags(c, cLast) : F.NONE;
  }

  private at(i: number): string { return i < this.aFormula.length ? this.aFormula[i]! : '\0'; }

  /** NextSymbol: scans the next symbol into cSymbol, returns the whitespace before it. */
  private NextSymbol(bInArray: boolean): { cChar: string; nCount: number }[] {
    const vSpaces: { cChar: string; nCount: number }[] = [];
    let pSym = '';
    let pSrc = this.nSrcPos;
    let bi18n = false;
    let c = this.at(pSrc);
    let cLast = '\0';
    let bQuote = false;
    this.mnRangeOpPosInSymbol = -1;
    let eState: number = ScanState.ssGetChar;
    let aSpace = { cChar: '\0', nCount: 0 };
    const cSep = this.mxSymbols.getSymbolChar(ocSep);
    const cArrayColSep = this.mxSymbols.getSymbolChar(ocArrayColSep);
    const cArrayRowSep = this.mxSymbols.getSymbolChar(ocArrayRowSep);
    const cDecSep = '.';
    const cDecSepAlt = '\0';

    // special symbols specific to address convention used
    const cSheetPrefix = this.pConv.getSpecialSymbol('ABS_SHEET_PREFIX');
    const cSheetSep = this.pConv.getSpecialSymbol('SHEET_SEPARATOR');

    let nDecSeps = 0;
    let bAutoIntersection = false;
    let nAutoIntersectionSpacesPos = 0;
    let nRefInName = 0;
    let bErrorConstantHadSlash = false;
    this.mnPredetectedReference = 0;

    const addWhitespace = (cChar: string, nCount = 1) => {
      if (aSpace.cChar !== cChar) {
        if (aSpace.cChar && aSpace.nCount > 0) vSpaces.push(aSpace);
        aSpace = { cChar, nCount: 0 };
      }
      aSpace.nCount += nCount;
    };

    // try to parse simple tokens before calling i18n parser
    while (c !== '\0' && eState !== ScanState.ssStop) {
      pSrc++;
      let nMask = this.GetCharTableFlags(c, cLast);

      // The parameter separator and the array column and row separators end
      // things unconditionally if not in string or reference.
      if (c === cSep || (bInArray && (c === cArrayColSep || c === cArrayRowSep))) {
        switch (eState) {
          // these are to be continued
          case ScanState.ssGetString:
          case ScanState.ssSkipString:
          case ScanState.ssGetReference:
          case ScanState.ssSkipReference:
          case ScanState.ssGetTableRefItem:
          case ScanState.ssGetTableRefColumn:
            break;
          default:
            if (eState === ScanState.ssGetChar) pSym += c;
            else pSrc--;
            eState = ScanState.ssStop;
        }
      }

      let bAgain: boolean;
      do {
        bAgain = false;
        switch (eState) {
          case ScanState.ssGetChar: {
            // Order is important!
            if (nMask & F.OdfLabelOp) {
              // '!!' automatic intersection
              if (this.GetCharTableFlags(this.at(pSrc), '\0') & F.OdfLabelOp) {
                if (!bAutoIntersection) {
                  ++pSrc;
                  // Add 2 because it must match the character count
                  // for bi18n.
                  addWhitespace(' ', 2);
                  // Position of Whitespace where it will be added to
                  // vector.
                  nAutoIntersectionSpacesPos = vSpaces.length;
                  bAutoIntersection = true;
                } else {
                  pSrc--;
                  eState = ScanState.ssStop;
                }
              } else {
                nMask &= ~F.OdfLabelOp;
                bAgain = true;
              }
            } else if (nMask & F.OdfNameMarker) {
              // '$$' defined name marker
              if (this.GetCharTableFlags(this.at(pSrc), '\0') & F.OdfNameMarker) {
                // both eaten, not added to pSym
                ++pSrc;
              } else {
                nMask &= ~F.OdfNameMarker;
                bAgain = true;
              }
            } else if (nMask & F.Char) {
              // '[' is a special case in Excel syntax, it can start an
              // external reference, ID in OOXML like [1]Sheet1!A1 or
              // Excel_A1 [filename]Sheet!A1 or Excel_R1C1
              // [filename]Sheet!R1C1 that needs to be scanned
              // entirely, or can be ocTableRefOpen.
              if (c === '[' && FormulaGrammar.isExcelSyntax(this.meGrammar) && this.eLastOp !== ocDBArea) {
                // [0]!Global_Range_Name, is a special case in OOXML
                // syntax, where the '0' is referencing to self.
                if (FormulaGrammar.isRefConventionOOXML(this.meGrammar) && this.at(pSrc) === '0' && this.at(pSrc + 1) === ']' && this.at(pSrc + 2) === '!') {
                  pSrc += 3;
                  c = this.at(pSrc);
                  continue;
                }
                nMask &= ~F.Char;
                bAgain = true;
              } else {
                pSym += c;
                eState = ScanState.ssStop;
              }
            } else if (nMask & F.OdfLBracket) {
              // eaten, not added to pSym
              eState = ScanState.ssGetReference;
              this.mnPredetectedReference = 1;
            } else if (nMask & F.CharBool) {
              pSym += c;
              eState = ScanState.ssGetBool;
            } else if (nMask & F.CharValue) {
              pSym += c;
              eState = ScanState.ssGetValue;
            } else if (nMask & F.CharString) {
              pSym += c;
              eState = ScanState.ssGetString;
            } else if (nMask & F.CharErrConst) {
              pSym += c;
              eState = ScanState.ssGetErrorConstant;
            } else if (nMask & F.CharDontCare) {
              addWhitespace(c);
            } else if (nMask & F.CharIdent) {
              // try to get a simple ASCII identifier before calling
              // i18n, to gain performance during import
              pSym += c;
              eState = ScanState.ssGetIdent;
            } else {
              bi18n = true;
              eState = ScanState.ssStop;
            }
            break;
          }
          case ScanState.ssGetIdent: {
            if (nMask & F.Ident) {
              // This catches also $Sheet1.A$1, for example.
              if (pSym.length >= MAXSTRLEN) {
                this.SetError(FormulaError.StringOverflow);
                eState = ScanState.ssStop;
              } else pSym += c;
            } else if (c === '#' && this.aFormula.slice(pSrc, pSrc + 4).toUpperCase() === 'REF!') {
              // Completely ugly means to catch broken
              // [$]#REF!.[$]#REF![$]#REF! (one or multiple parts)
              // references that were written in ODF named ranges
              // (without embracing [] hence no predetected reference)
              // and to OOXML and handle them as one symbol.
              // Also catches these in UI, so we can process them
              // further.
              let i = 0;
              for (; i < 5; ++i) {
                pSym += c;
                c = this.at(pSrc++);
              }
              if (i === 5) c = this.at(--pSrc - 1); // position last/next character correctly
            } else if (c === ':' && this.mnRangeOpPosInSymbol < 0) {
              // One range operator may form Sheet1.A:A, which we need to
              // pass as one entity to IsReference().
              this.mnRangeOpPosInSymbol = pSym.length;
              pSym += c;
            } else if (c.charCodeAt(0) >= 128 || c === '\'') {
              // High values need reparsing with i18n,
              // single quoted $'sheet' names too (otherwise we'd had to
              // implement everything twice).
              bi18n = true;
              eState = ScanState.ssStop;
            } else {
              pSrc--;
              eState = ScanState.ssStop;
            }
            break;
          }
          case ScanState.ssGetBool: {
            if (nMask & F.Bool) {
              pSym += c;
              eState = ScanState.ssStop;
            } else {
              pSrc--;
              eState = ScanState.ssStop;
            }
            break;
          }
          case ScanState.ssGetValue: {
            if (pSym.length >= MAXSTRLEN) {
              this.SetError(FormulaError.StringOverflow);
              eState = ScanState.ssStop;
            } else if (c === cDecSep || (cDecSepAlt !== '\0' && c === cDecSepAlt)) {
              if (++nDecSeps > 1) {
                // reparse with i18n, may be numeric sheet name as well
                bi18n = true;
                eState = ScanState.ssStop;
              } else pSym += c;
            } else if (nMask & F.Value) pSym += c;
            else if (nMask & F.ValueSep) {
              pSrc--;
              eState = ScanState.ssStop;
            } else if (c === 'E' || c === 'e') {
              if (this.GetCharTableFlags(this.at(pSrc), '\0') & F.ValueExp) pSym += c;
              else {
                // reparse with i18n
                bi18n = true;
                eState = ScanState.ssStop;
              }
            } else if (nMask & F.ValueSign) {
              if ((cLast === 'E' || cLast === 'e') && this.GetCharTableFlags(this.at(pSrc), '\0') & F.ValueValue) pSym += c;
              else {
                pSrc--;
                eState = ScanState.ssStop;
              }
            } else {
              // reparse with i18n
              bi18n = true;
              eState = ScanState.ssStop;
            }
            break;
          }
          case ScanState.ssGetString: {
            if (nMask & F.StringSep) {
              if (!bQuote) {
                if (this.at(pSrc) === '"') bQuote = true; // "" => literal "
                else eState = ScanState.ssStop;
              } else bQuote = false;
            }
            if (!bQuote) {
              if (pSym.length >= MAXSTRLEN) {
                this.SetError(FormulaError.StringOverflow);
                eState = ScanState.ssSkipString;
              } else pSym += c;
            }
            break;
          }
          case ScanState.ssSkipString:
            if (nMask & F.StringSep) eState = ScanState.ssStop;
            break;
          case ScanState.ssGetErrorConstant: {
            // ODFF Error ::= '#' [A-Z0-9]+ ([!?] | ('/' ([A-Z] | ([0-9] [!?]))))
            // BUT, in UI these may have been translated! So don't
            // check for ASCII alnum. Note that this construct can't be
            // parsed with i18n.
            let bAdd = true;
            if (c === '?') eState = ScanState.ssStop;
            else if (c === '!') {
              // Check if this is #REF! that starts an invalid reference.
              // Note we have an implicit '!' here at the end.
              if (pSym.length === 4 && pSym.toUpperCase() === '#REF' && this.GetCharTableFlags(this.at(pSrc), c) & F.Ident) eState = ScanState.ssGetIdent;
              else eState = ScanState.ssStop;
            } else if (c === '/') {
              if (!bErrorConstantHadSlash) bErrorConstantHadSlash = true;
              else {
                bAdd = false;
                eState = ScanState.ssStop;
              }
            } else if (nMask & F.WordSep || (c.charCodeAt(0) < 128 && !/[A-Za-z0-9]/.test(c))) {
              bAdd = false;
              eState = ScanState.ssStop;
            }
            if (!bAdd) --pSrc;
            else if (pSym.length >= MAXSTRLEN) {
              this.SetError(FormulaError.StringOverflow);
              eState = ScanState.ssStop;
            } else pSym += c;
            break;
          }
          case ScanState.ssGetReference:
          case ScanState.ssSkipReference: {
            if (eState === ScanState.ssGetReference && pSym.length >= MAXSTRLEN) {
              this.SetError(FormulaError.StringOverflow);
              eState = ScanState.ssSkipReference;
            }
            // ODF reference: ['External'#$'Sheet'.A1:.B2] with dots being
            // mandatory also if no sheet name. 'External'# is optional,
            // sheet name is optional, quotes around sheet name are
            // optional if no quote contained. [#REF!] is valid.
            // 2nd usage: ['Sheet'.$$'DefinedName']
            const kDollar = 1 << 1;
            const kOpen = 1 << 2;
            const kName = 1 << 3;
            const kQuote = 1 << 4;
            const kClose = 1 << 5;
            const kFileSep = 1 << 6;
            const kPast = 1 << 7;
            const kMarkAhead = 1 << 8;
            const kDefName = 1 << 9;
            const kRefErr = 1 << 10;

            let bAddToSymbol = true;
            if (nMask & F.OdfRBracket && !(nRefInName & kOpen)) {
              // eaten, not added to pSym
              bAddToSymbol = false;
              eState = ScanState.ssStop;
            } else if (cSheetSep === c && nRefInName === 0) {
              // eat it, no sheet name [.A1]
              bAddToSymbol = false;
              nRefInName |= kPast;
              if (this.at(pSrc) === '$' && this.at(pSrc + 1) === '$') nRefInName |= kMarkAhead;
            } else if (!(nRefInName & kPast) || nRefInName & (kMarkAhead | kDefName)) {
              // Not in col/row yet.
              if (c === SC_COMPILER_FILE_TAB_SEP && nRefInName & kFileSep) nRefInName = 0;
              else if (c === '$' && this.at(pSrc) === '$' && !(nRefInName & kOpen)) {
                nRefInName &= ~kMarkAhead;
                if (!(nRefInName & kDefName)) {
                  // eaten, not added to pSym (2 chars)
                  bAddToSymbol = false;
                  ++pSrc;
                  nRefInName &= kPast;
                  nRefInName |= kDefName;
                } else {
                  // ScAddress::Parse() will recognize this as
                  // invalid later.
                  if (eState !== ScanState.ssSkipReference) {
                    pSym += c;
                    pSym += this.at(pSrc++);
                  }
                  bAddToSymbol = false;
                }
              } else if (cSheetPrefix === c && nRefInName === 0) nRefInName |= kDollar;
              else if (c === '\'') {
                // TODO: The conventions' parseExternalName()
                // should handle quoted names, but as long as they
                // don't remove non-embedded quotes here.
                if (!(nRefInName & kName)) {
                  nRefInName |= kOpen | kName;
                  bAddToSymbol = !(nRefInName & kDefName);
                } else if (!(nRefInName & kOpen)) {
                  // a ''' without the name being enclosed in '...' violates ODF spec
                } else if (nRefInName & kQuote) {
                  // escaped embedded quote
                  nRefInName &= ~kQuote;
                } else {
                  if (this.at(pSrc) === '\'') {
                    // escapes embedded quote
                    nRefInName |= kQuote;
                  } else {
                    // sheet name should follow
                    if (this.at(pSrc) === SC_COMPILER_FILE_TAB_SEP) nRefInName |= kFileSep;
                    // quote not followed by quote => close
                    nRefInName |= kClose;
                    nRefInName &= ~kOpen;
                  }
                  bAddToSymbol = !(nRefInName & kDefName);
                }
              } else if (c === '#' && nRefInName === 0) nRefInName |= kRefErr;
              else if (cSheetSep === c && !(nRefInName & kOpen)) {
                // unquoted sheet name separator
                nRefInName |= kPast;
                if (this.at(pSrc) === '$' && this.at(pSrc + 1) === '$') nRefInName |= kMarkAhead;
              } else if (c === ':' && !(nRefInName & kOpen)) {
                // range operator ':' without prior sheet name separator '.' violates ODF spec
                nRefInName = 0;
                ++this.mnPredetectedReference;
              } else if (!(nRefInName & kName)) {
                // start unquoted name
                nRefInName |= kName;
              }
            } else if (c === ':') {
              // range operator
              nRefInName = 0;
              ++this.mnPredetectedReference;
            }
            if (bAddToSymbol && eState !== ScanState.ssSkipReference) pSym += c; // everything is part of reference
            break;
          }
          case ScanState.ssStop:
            // nothing, prevent warning
            break;
        }
      } while (bAgain);
      cLast = c;
      c = this.at(pSrc);
    }
    if (aSpace.nCount && aSpace.cChar !== '\0') vSpaces.push(aSpace);
    if (bi18n) {
      const nOldSrcPos = this.nSrcPos;
      for (const r of vSpaces) this.nSrcPos += r.nCount;
      let aSymbol = '';
      this.mnRangeOpPosInSymbol = -1;
      let nErr: FormulaError = FormulaError.NONE;
      do {
        bi18n = false;
        // special case  (e.g. $'sheetname' in OOO A1)
        if (this.at(this.nSrcPos) === cSheetPrefix && this.at(this.nSrcPos + 1) === '\'') aSymbol += this.at(this.nSrcPos++);
        const aRes = this.parseAnyToken(this.nSrcPos);
        if (!aRes.TokenType) {
          nErr = FormulaError.IllegalChar;
          this.SetError(nErr); // parsed chars as string
        }
        if (aRes.EndPos <= this.nSrcPos) {
          // Could not parse anything meaningful.
          nErr = FormulaError.IllegalChar;
          this.SetError(nErr);
          // Caller has to act on an empty symbol for
          // nSrcPos < aFormula.getLength()
          this.nSrcPos = nOldSrcPos;
          aSymbol = '';
        } else {
          // When having parsed a second reference part, ensure that the
          // i18n parser did not mistakenly parse a number that included
          // a separator which happened to be meant as a parameter
          // separator instead.
          if (this.mnRangeOpPosInSymbol >= 0 && aRes.TokenType === 'number') {
            for (let i = this.nSrcPos; i < aRes.EndPos; ++i) if (this.at(i) === cSep) { aRes.EndPos = i; break; }
          }
          aSymbol += this.aFormula.slice(this.nSrcPos, aRes.EndPos);
          this.nSrcPos = aRes.EndPos;
          c = this.at(this.nSrcPos);
          if (aRes.TokenType === 'quoted') {
            // special cases (e.g. 'sheetname'. or 'filename'# in OOO A1)
            bi18n = c === cSheetSep || c === SC_COMPILER_FILE_TAB_SEP;
          }
          // One range operator restarts parsing for second reference.
          if (c === ':' && this.mnRangeOpPosInSymbol < 0) {
            this.mnRangeOpPosInSymbol = aSymbol.length;
            bi18n = true;
          }
          if (bi18n) aSymbol += this.at(this.nSrcPos++);
        }
      } while (bi18n && nErr === FormulaError.NONE);
      if (aSymbol.length > MAXSTRLEN) {
        this.SetError(FormulaError.StringOverflow);
        aSymbol = aSymbol.slice(0, MAXSTRLEN);
      }
      if (this.mnRangeOpPosInSymbol >= aSymbol.length) this.mnRangeOpPosInSymbol = -1;
      pSym = aSymbol;
    } else {
      this.nSrcPos = pSrc;
    }
    if (this.mnRangeOpPosInSymbol >= 0 && this.mnRangeOpPosInSymbol === pSym.length - 1) {
      // This is a trailing range operator, which is nonsense. Will be caught
      // in next round.
      this.mnRangeOpPosInSymbol = -1;
      pSym = pSym.slice(0, -1);
      --this.nSrcPos;
    }
    this.cSymbol = pSym;
    if (bAutoIntersection && vSpaces[nAutoIntersectionSpacesPos] && vSpaces[nAutoIntersectionSpacesPos]!.nCount > 1)
      --vSpaces[nAutoIntersectionSpacesPos]!.nCount; // replace '!!' with only one space
    return vSpaces;
  }

  /**
   * Convention::parseAnyToken, reduced: a quoted name ('...' with '' escapes), a number in the
   * English notation, or an identifier of letters, digits, '_', '$', '.' and the convention's
   * additional characters. TokenType is 'quoted', 'number', 'ident' or '' when nothing parsed.
   */
  private parseAnyToken(nSrcPos: number): { TokenType: string; EndPos: number } {
    const s = this.aFormula;
    if (s[nSrcPos] === '\'') {
      let nPos = nSrcPos + 1;
      while (nPos < s.length) {
        if (s[nPos] === '\'') {
          if (nPos + 1 === s.length || s[nPos + 1] !== '\'') return { TokenType: 'quoted', EndPos: nPos + 1 };
          ++nPos;
        }
        ++nPos;
      }
      return { TokenType: '', EndPos: nSrcPos };
    }
    const m = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(nSrcPos));
    const add = this.pConv.addAllowed();
    const isStart = (ch: string) => /[\p{L}\p{N}_$]/u.test(ch) || add.includes(ch);
    const isCont = (ch: string) => /[\p{L}\p{N}_$.]/u.test(ch) || add.includes(ch);
    let p = nSrcPos;
    if (p < s.length && isStart(s[p]!)) {
      p++;
      while (p < s.length && isCont(s[p]!)) p++;
      if (m && m[0].length >= p - nSrcPos) return { TokenType: 'number', EndPos: nSrcPos + m[0].length };
      return { TokenType: 'ident', EndPos: p };
    }
    if (m) return { TokenType: 'number', EndPos: nSrcPos + m[0].length };
    return { TokenType: '', EndPos: nSrcPos };
  }

  // --- raw token setters (ScRawToken) ------------------------------------------------------------

  private SetOpCode(eOp: OpCode): void {
    switch (eOp) {
      case ocIf:
      case ocIfError:
      case ocIfNA:
      case ocChoose:
      case ocLet: {
        const n = eOp === ocChoose ? FORMULA_MAXJUMPCOUNT + 1 : eOp === ocLet ? FORMULA_MAXPARAMS + 1 : eOp === ocIf ? 3 : 2;
        const nJump = new Array<number>(n + 1).fill(0);
        nJump[0] = n;
        this.maRawToken = new FormulaJumpToken(eOp, nJump);
        break;
      }
      case OC.ocOpen:
      case ocClose:
      case ocSep:
      case ocArrayOpen:
      case ocArrayClose:
      case ocArrayRowSep:
      case ocArrayColSep:
        this.maRawToken = new FormulaToken(svSep, eOp);
        break;
      case ocMissing:
        this.maRawToken = new FormulaMissingToken();
        break;
      default:
        this.maRawToken = new FormulaByteToken(eOp);
    }
  }

  /** NextNewToken: the next token of the formula into maRawToken. */
  private NextNewToken(bInArray: boolean): boolean {
    if (this.maPendingOpCodes.length) {
      this.SetOpCode(this.maPendingOpCodes.shift()!);
      return true;
    }

    const bAllowBooleans = bInArray;
    const vSpaces = this.NextSymbol(bInArray);
    const cSymbol = this.cSymbol;

    if (!cSymbol) {
      if (this.nSrcPos < this.aFormula.length) {
        // Nothing could be parsed, remainder as bad string.
        // NextSymbol() must had set an error for this.
        const aBad = this.aFormula.slice(this.nSrcPos);
        this.maRawToken = new FormulaStringOpToken(ocBad, aBad);
        this.nSrcPos = this.aFormula.length;
        // Add bad string as last token.
        return true;
      }
      return false;
    }

    if (vSpaces.length) {
      for (const rSpace of vSpaces) {
        let t: FormulaToken;
        if (rSpace.cChar === ' ') {
          // For now keep this a FormulaByteToken for the nasty
          // significant whitespace intersection.
          t = new FormulaByteToken(ocSpaces, Math.min(rSpace.nCount, 255));
        } else t = new FormulaSpaceToken(Math.min(rSpace.nCount, 255), rSpace.cChar);
        if (!(this.pArr as ScTokenArray).Add(t)) {
          this.SetError(FormulaError.CodeOverflow);
          return false;
        }
      }
    }

    // Short cut for references when reading ODF to speedup things.
    if (this.mnPredetectedReference) {
      const aStr = cSymbol;
      if (!this.ParsePredetectedReference(aStr)) this.maRawToken = new FormulaStringOpToken(ocBad, aStr);
      return true;
    }

    if ((cSymbol[0] === '#' || cSymbol[0] === '$') && cSymbol.length === 1) {
      // special case to speed up broken [$]#REF documents
      const aBad = this.aFormula.slice(this.nSrcPos - 1);
      const pBadToken = this.pArr!.AddBad(aBad);
      this.eLastOp = pBadToken ? pBadToken.GetOpCode() : ocNone;
      return false;
    }

    if (this.ParseString()) return true;

    let bMayBeFuncName: boolean;
    let bAsciiNonAlnum: boolean; // operators, separators, ...
    const c0 = cSymbol.charCodeAt(0);
    if (c0 < 128) {
      bMayBeFuncName = /[A-Za-z]/.test(cSymbol[0]!) || (cSymbol[0] === '_' && this.mxSymbols.isOOXML() && /[A-Za-z]/.test(cSymbol[1] ?? ''));
      bAsciiNonAlnum = !bMayBeFuncName && !/[0-9]/.test(cSymbol[0]!);
    } else {
      bMayBeFuncName = /\p{L}/u.test(cSymbol[0]!);
      bAsciiNonAlnum = false;
    }

    if (bAsciiNonAlnum && cSymbol.length === 1 && (this.eLastOp !== ocTableRefOpen || cSymbol[0] === '[' || cSymbol[0] === ']')) {
      // Shortcut for operators and separators that need no further checks or upper.
      if (this.ParseOpCode(cSymbol, bInArray)) return true;
    }

    if (bMayBeFuncName) {
      // a function name must be followed by a parenthesis
      let p = this.nSrcPos;
      while (this.at(p) === ' ') p++;
      bMayBeFuncName = this.at(p) === '(';
    }

    // Italian ARCTAN.2 resulted in #REF! => ParseOpcode() before
    // ParseReference().

    let aUpper = '';

    for (;;) {
      const aOrg = this.cSymbol;
      this.mbRewind = false;
      aUpper = '';

      if (bAsciiNonAlnum) {
        aUpper = aOrg.toUpperCase();
        if (this.cSymbol[0] === '#') {
          // This can be either an error constant ...
          if (this.ParseErrorConstant(aUpper)) return true;
          // ... or some invalidated reference starting with #REF!
          // which is handled after the do loop.
          break; // do; create ocBad token or set error.
        }
        if (this.ParseOpCode(aUpper, bInArray)) return true;
      }

      if (bMayBeFuncName) {
        if (!aUpper) aUpper = aOrg.toUpperCase();
        if (this.ParseOpCode(aUpper, bInArray)) return true;
      }

      // Column 'DM' ("Deutsche Mark", German currency) couldn't be
      // referred => ParseReference() before ParseValue().
      // Preserve case of file names in external references.
      if (this.ParseReference(aOrg)) {
        if (this.mbRewind) continue; // do; up to range operator.
        // If a syntactically correct reference was recognized but invalid
        // e.g. because of non-existing sheet name => entire reference
        // ocBad to preserve input instead of #REF!.A1
        if (!this.IsValidReference(this.maRawToken)) {
          aUpper = aOrg; // ensure for ocBad
          break; // do; create ocBad token or set error.
        }
        return true;
      }

      if (!aUpper) aUpper = aOrg.toUpperCase();

      // ParseBoolean() before ParseValue() to catch inline bools without the kludge
      //    for inline arrays.
      if (bAllowBooleans && this.ParseBoolean(aUpper)) return true;

      if (this.ParseValue(aUpper)) return true;

      // User defined names and such do need i18n upper also in ODF.
      aUpper = aOrg.toUpperCase();

      if (this.ParseNamedRange(aUpper)) return true;

      if (this.ParseDBRange(aUpper)) return true;

      if (bMayBeFuncName && this.ParseOpCode2(aUpper)) return true;
      break;
    }

    // Last chance: it could be a broken invalidated reference that contains
    // #REF! (but is not equal to), which we also wrote to ODFF between 2013
    // and 2016 until 5.1.4
    const aErrRef = this.mxSymbols.getSymbol(ocErrRef);
    if (aUpper.indexOf(aErrRef) >= 0 && this.ParseReference(aUpper, aErrRef)) {
      if (!this.mbRewind) return true;
      // a rewind here would restart the loop; treat as reference part
      return this.NextNewTokenRewound(bInArray);
    }

    if (this.meExtendedErrorDetection !== ExtendedErrorDetection.EXTENDED_ERROR_DETECTION_NONE) {
      // set an error
      this.SetError(FormulaError.NoName);
      if (this.meExtendedErrorDetection === ExtendedErrorDetection.EXTENDED_ERROR_DETECTION_NAME_BREAK) return false; // end compilation
    }

    // Provide single token information and continue. Do not set an error, that
    // would prematurely end compilation. Simple unknown names are handled by
    // the interpreter.
    aUpper = aUpper.toLowerCase();
    this.maRawToken = new FormulaStringOpToken(ocBad, aUpper);
    return true;
  }

  /** The Label_Rewind of NextNewToken after the last-chance #REF! parse rewound the symbol. */
  private NextNewTokenRewound(bInArray: boolean): boolean {
    const aOrg = this.cSymbol;
    if (this.ParseReference(aOrg)) return true;
    void bInArray;
    this.maRawToken = new FormulaStringOpToken(ocBad, aOrg.toLowerCase());
    return true;
  }

  /** Whether the raw token is a valid reference (ScRawToken::IsValidReference). */
  private IsValidReference(t: FormulaToken): boolean {
    if (t.GetType() === svSingleRef) {
      const r = t.GetSingleRef() as ScSingleRefData;
      return r.Valid(this.rDoc);
    }
    if (t.GetType() === svDoubleRef) {
      const r = t.GetDoubleRef() as ScComplexRefData;
      return r.Valid(this.rDoc);
    }
    return true;
  }

  private ParseOpCode(rName: string, bInArray: boolean): boolean {
    let eOp = this.mxSymbols.getHashMap().get(rName);
    let bFound = eOp !== undefined;
    if (eOp !== undefined) {
      if (bInArray) {
        if (rName === this.mxSymbols.getSymbol(ocArrayColSep)) eOp = ocArrayColSep;
        else if (rName === this.mxSymbols.getSymbol(ocArrayRowSep)) eOp = ocArrayRowSep;
      } else if (eOp === ocArrayColSep || eOp === ocArrayRowSep) {
        if (rName === this.mxSymbols.getSymbol(ocSep)) eOp = ocSep;
        else if (rName === ';') {
          switch (FormulaGrammar.extractFormulaLanguage(this.meGrammar)) {
            // Only for languages/grammars that actually use ';'
            // parameter separator.
            case FormulaLanguage.NATIVE:
            case FormulaLanguage.ENGLISH:
            case FormulaLanguage.ODFF:
            case FormulaLanguage.ODF_11:
              eOp = ocSep;
          }
        }
      } else if (eOp === ocCeil && this.mxSymbols.isOOXML()) {
        // Ensure that _xlfn.CEILING.MATH maps to ocCeil_Math. ocCeil is
        // unassigned for import.
        eOp = ocCeil_Math;
      } else if (eOp === ocFloor && this.mxSymbols.isOOXML()) {
        // Ensure that _xlfn.FLOOR.MATH maps to ocFloor_Math. ocFloor is
        // unassigned for import.
        eOp = ocFloor_Math;
      }
      this.SetOpCode(eOp);
    } else if (this.mxSymbols.isODFF()) {
      // ODFF names that are not written in the current mapping but to be
      // recognized.
      const aOdffAliases: [string, OpCode][] = [
        // Renamed old names, still accept them:
        ['B', OC.ocB], // B -> BINOM.DIST.RANGE
        ['TDIST', OC.ocTDist], // TDIST -> LEGACY.TDIST
        ['ORG.OPENOFFICE.EASTERSUNDAY', OC.ocEasterSunday], // ORG.OPENOFFICE.EASTERSUNDAY -> EASTERSUNDAY
        ['ZGZ', OC.ocRRI], // ZGZ -> RRI
        ['COLOR', OC.ocColor], // COLOR -> ORG.LIBREOFFICE.COLOR
        ['GOALSEEK', OC.ocBackSolver], // GOALSEEK -> ORG.OPENOFFICE.GOALSEEK
        ['COM.MICROSOFT.F.DIST', OC.ocFDist_LT], // fdo#40835, -> FDIST -> COM.MICROSOFT.F.DIST
        ['COM.MICROSOFT.F.INV', OC.ocFInv_LT], // tdf#94214, COM.MICROSOFT.F.INV -> FINV (ODF)
      ];
      for (const [pName, e] of aOdffAliases) {
        if (rName.toUpperCase() === pName) {
          this.SetOpCode(e);
          bFound = true;
          break;
        }
      }
    } else if (this.mxSymbols.isOOXML()) {
      // OOXML names that are not written in the current mapping but to be
      // recognized as old versions wrote them.
      const aOoxmlAliases: [string, OpCode][] = [
        ['EFFECTIVE', OC.ocEffect], // EFFECTIVE -> EFFECT
        ['ERRORTYPE', OC.ocErrorType], // ERRORTYPE -> _xlfn.ORG.OPENOFFICE.ERRORTYPE
        ['MULTIRANGE', OC.ocMultiArea], // MULTIRANGE -> _xlfn.ORG.OPENOFFICE.MULTIRANGE
        ['GOALSEEK', OC.ocBackSolver], // GOALSEEK -> _xlfn.ORG.OPENOFFICE.GOALSEEK
        ['EASTERSUNDAY', OC.ocEasterSunday], // EASTERSUNDAY -> _xlfn.ORG.OPENOFFICE.EASTERSUNDAY
        ['CURRENT', OC.ocCurrent], // CURRENT -> _xlfn.ORG.OPENOFFICE.CURRENT
        ['STYLE', OC.ocStyle], // STYLE -> _xlfn.ORG.OPENOFFICE.STYLE
      ];
      for (const [pName, e] of aOoxmlAliases) {
        if (rName.toUpperCase() === pName) {
          this.SetOpCode(e);
          bFound = true;
          break;
        }
      }
    } else if (this.mxSymbols.isPODF()) {
      if (rName.toUpperCase() === 'EFFECT') {
        this.SetOpCode(OC.ocEffect);
        bFound = true;
      }
    }
    if (!bFound) {
      let aIntName = '';
      if (this.mxSymbols.hasExternals()) {
        // If symbols are set by filters get mapping to exact name.
        const iExt = this.mxSymbols.getExternalHashMap().get(rName);
        if (iExt !== undefined) {
          if (GetAddInCollection().GetFuncData(iExt)) aIntName = iExt;
        }
      } else {
        // bLocalFirst=false for (English) upper full original name
        // (service.function)
        aIntName = GetAddInCollection().FindFunction(rName, !this.mxSymbols.isEnglish());
      }
      if (aIntName) {
        this.maRawToken = new FormulaExternalToken(OC.ocExternal, aIntName); // international name
        bFound = true;
      }
    }
    if (!bFound) return false;
    const e = this.maRawToken.GetOpCode();
    if (e === ocSub || e === ocNegSub) {
      const eLastOp = this.eLastOp;
      const bShouldBeNegSub = eLastOp === OC.ocOpen || eLastOp === ocSep || eLastOp === ocNegSub
        || (SC_OPCODE_START_BIN_OP <= eLastOp && eLastOp < SC_OPCODE_STOP_BIN_OP)
        || eLastOp === ocArrayOpen || eLastOp === ocArrayColSep || eLastOp === ocArrayRowSep;
      if (bShouldBeNegSub && e === ocSub) this.maRawToken.NewOpCode(ocNegSub);
      //TODO: if ocNegSub had ForceArray we'd have to set it here
      else if (!bShouldBeNegSub && e === ocNegSub) this.maRawToken.NewOpCode(ocSub);
    }
    return bFound;
  }

  private ParseOpCode2(rName: string): boolean {
    if (rName === 'TTT') { this.SetOpCode(OC.ocTTT); return true; }
    if (rName === '__DEBUG_VAR') { this.SetOpCode(OC.ocDebugVar); return true; }
    return false;
  }

  private lcl_ParenthesisFollows(p: number): boolean {
    while (this.at(p) === ' ') p++;
    return this.at(p) === '(';
  }

  private ParseValue(rSym: string): boolean {
    const nFormulaLanguage = FormulaGrammar.extractFormulaLanguage(this.GetGrammar());
    if (nFormulaLanguage === FormulaLanguage.ODFF || nFormulaLanguage === FormulaLanguage.OOXML) {
      // Speedup things for ODFF, only well-formed numbers, not locale
      // dependent nor user input.
      const { fVal, eStatus, nParseEnd } = stringToDouble(rSym, '.', '\0');
      if (nParseEnd !== rSym.length) {
        // Not (only) a number.
        if (nParseEnd > 0) return false; // partially a number => no such thing
        if (this.lcl_ParenthesisFollows(this.nSrcPos)) return false; // some function name, not a constant
        // Could be TRUE or FALSE constant.
        let eOpFunc: OpCode = ocNone;
        if (rSym.toUpperCase() === 'TRUE') eOpFunc = ocTrue;
        else if (rSym.toUpperCase() === 'FALSE') eOpFunc = ocFalse;
        if (eOpFunc !== ocNone) {
          this.SetOpCode(eOpFunc);
          // add missing trailing parentheses
          this.maPendingOpCodes.push(OC.ocOpen);
          this.maPendingOpCodes.push(ocClose);
          return true;
        }
        return false;
      }
      if (eStatus !== 0) {
        if (!Number.isFinite(fVal) && rSym === 'INF') {
          if (this.GetRangeData(rSym)) return false;
        }
        this.SetError(FormulaError.IllegalArgument);
      }
      this.maRawToken = new FormulaDoubleToken(fVal);
      return true;
    }
    // English locale: the number formatter of en-US (the UI of this port).
    const r = IsNumberFormat(rSym, 'en-US');
    if (!r) return false;
    const nType = NFGetType(r.code, 'en-US');
    // Don't accept 3:3 as time, it is a reference to entire row 3 instead.
    // Dates should never be entered directly and automatically converted
    // to serial, because the serial would be wrong if null-date changed.
    // Usually it wouldn't be accepted anyway because the date separator
    // clashed with other separators or operators.
    if (nType === SvNumFormatType.TIME || nType === SvNumFormatType.DATE || nType === SvNumFormatType.DATETIME) return false;
    if (nType === SvNumFormatType.LOGICAL) {
      if (this.lcl_ParenthesisFollows(this.nSrcPos)) return false; // Boolean function instead.
      // Upstream pushes the value of the boolean number format (1 or 0) here; TRUE and FALSE
      // become the functions as in the ODFF branch above, so the formula keeps its type.
      this.SetOpCode(r.value ? ocTrue : ocFalse);
      this.maPendingOpCodes.push(OC.ocOpen);
      this.maPendingOpCodes.push(ocClose);
      return true;
    }
    if (nType === SvNumFormatType.TEXT) this.SetError(FormulaError.IllegalArgument); // HACK: number too big!
    this.maRawToken = new FormulaDoubleToken(r.value);
    return true;
  }

  private ParseString(): boolean {
    const cSymbol = this.cSymbol;
    if (cSymbol[0] !== '"') return false;
    const nLen = cSymbol.length - 1;
    if (!nLen || cSymbol[nLen] !== '"') return false;
    this.maRawToken = new FormulaStringToken(cSymbol.slice(1, nLen));
    return true;
  }

  private ParsePredetectedErrRefReference(rName: string, pErrRef: string): boolean {
    switch (this.mnPredetectedReference) {
      case 1: return this.ParseSingleReference(rName, pErrRef);
      case 2: return this.ParseDoubleReference(rName, pErrRef);
      default: return false;
    }
  }

  private ParsePredetectedReference(rName: string): boolean {
    // Speedup documents with lots of broken references, e.g. sheet deleted.
    // It could also be a broken invalidated reference that contains #REF!
    // (but is not equal to), which we wrote prior to ODFF and also to ODFF
    // between 2013 and 2016 until 5.1.4
    const aErrRef = '#REF!'; // not localized in ODFF
    const nPos = rName.indexOf(aErrRef);
    if (nPos !== -1) {
      if (nPos === 0) {
        // Per ODFF the correct string for a reference error is just #REF!,
        // so pass it on.
        if (rName.length === 5) return this.ParseErrorConstant(rName);
        // #REF!.AB42 or #REF!42 or #REF!#REF!
        return this.ParsePredetectedErrRefReference(rName, aErrRef);
      }
      let c = rName[nPos - 1]!; // before #REF!
      if (c === '$') {
        if (nPos === 1) {
          // $#REF!.AB42 or $#REF!42 or $#REF!#REF!
          return this.ParsePredetectedErrRefReference(rName, aErrRef);
        }
        c = rName[nPos - 2]!; // before $#REF!
      }
      const c2 = nPos + 5 < rName.length ? rName[nPos + 5]! : '\0'; // after #REF!
      switch (c) {
        case '.':
          if (c2 === '$' || c2 === '#' || (c2 >= '0' && c2 <= '9')) {
            // sheet.#REF!42 or sheet.#REF!#REF!
            return this.ParsePredetectedErrRefReference(rName, aErrRef);
          }
          break;
        case ':':
          if (this.mnPredetectedReference > 1 && (c2 === '.' || c2 === '$' || c2 === '#' || (c2 >= '0' && c2 <= '9'))) {
            // :#REF!.AB42 or :#REF!42 or :#REF!#REF!
            return this.ParsePredetectedErrRefReference(rName, aErrRef);
          }
          break;
        default:
          if (/[A-Za-z]/.test(c) && ((this.mnPredetectedReference > 1 && c2 === ':') || c2 === '\0')) {
            // AB#REF!: or AB#REF!
            return this.ParsePredetectedErrRefReference(rName, aErrRef);
          }
      }
    }
    switch (this.mnPredetectedReference) {
      case 1: return this.ParseSingleReference(rName);
      case 2: return this.ParseDoubleReference(rName);
    }
    return false;
  }

  private ParseDoubleReference(rName: string, pErrRef?: string): boolean {
    const aRange = new ScRange(this.aPos, this.aPos);
    const aDetails = ScAddressDetails(this.pConv.meConv, this.aPos);
    const nFlags = aRange.Parse(rName, this.rDoc, aDetails, pErrRef);
    if (nFlags & ScRefFlags.VALID) {
      const aRef = new ScComplexRefData();
      aRef.InitRange(aRange);
      aRef.Ref1.SetColRel((nFlags & ScRefFlags.COL_ABS) === 0);
      aRef.Ref1.SetRowRel((nFlags & ScRefFlags.ROW_ABS) === 0);
      aRef.Ref1.SetTabRel((nFlags & ScRefFlags.TAB_ABS) === 0);
      if (!(nFlags & ScRefFlags.TAB_VALID)) aRef.Ref1.SetTabDeleted(true); // #REF!
      aRef.Ref1.SetFlag3D((nFlags & ScRefFlags.TAB_3D) !== 0);
      aRef.Ref2.SetColRel((nFlags & ScRefFlags.COL2_ABS) === 0);
      aRef.Ref2.SetRowRel((nFlags & ScRefFlags.ROW2_ABS) === 0);
      aRef.Ref2.SetTabRel((nFlags & ScRefFlags.TAB2_ABS) === 0);
      if (!(nFlags & ScRefFlags.TAB2_VALID)) aRef.Ref2.SetTabDeleted(true); // #REF!
      aRef.Ref2.SetFlag3D((nFlags & ScRefFlags.TAB2_3D) !== 0);
      aRef.SetRange(this.rDoc.GetSheetLimits(), aRange, this.aPos);
      this.maRawToken = new ScDoubleRefToken(this.rDoc.GetSheetLimits(), aRef);
    }
    return (nFlags & ScRefFlags.VALID) !== 0;
  }

  private ParseSingleReference(rName: string, pErrRef?: string): boolean {
    this.mnCurrentSheetEndPos = 0;
    this.mnCurrentSheetTab = -1;
    const aAddr = this.aPos.clone();
    const aDetails = ScAddressDetails(this.pConv.meConv, this.aPos);
    const pSheetEndPos = { value: 0 };
    let nFlags = aAddr.Parse(rName, this.rDoc, aDetails, pSheetEndPos, pErrRef);
    this.mnCurrentSheetEndPos = pSheetEndPos.value;
    // Something must be valid in order to recognize Sheet1.blah or blah.a1
    // as a (wrong) reference.
    if (nFlags & (ScRefFlags.COL_VALID | ScRefFlags.ROW_VALID | ScRefFlags.TAB_VALID)) {
      // Valid given tab and invalid col or row may indicate a sheet-local
      // named expression, bail out early and don't create a reference token.
      if (!(nFlags & ScRefFlags.VALID) && this.mnCurrentSheetEndPos > 0 && nFlags & ScRefFlags.TAB_VALID && nFlags & ScRefFlags.TAB_3D) {
        this.mnCurrentSheetTab = aAddr.Tab();
        return false;
      }
      const aRef = new ScSingleRefData();
      aRef.InitAddress(aAddr);
      aRef.SetColRel((nFlags & ScRefFlags.COL_ABS) === 0);
      aRef.SetRowRel((nFlags & ScRefFlags.ROW_ABS) === 0);
      aRef.SetTabRel((nFlags & ScRefFlags.TAB_ABS) === 0);
      aRef.SetFlag3D((nFlags & ScRefFlags.TAB_3D) !== 0);
      // the reference is really invalid
      if (!(nFlags & ScRefFlags.VALID)) {
        if (!(nFlags & ScRefFlags.COL_VALID)) aRef.SetColDeleted(true);
        if (!(nFlags & ScRefFlags.ROW_VALID)) aRef.SetRowDeleted(true);
        if (!(nFlags & ScRefFlags.TAB_VALID)) aRef.SetTabDeleted(true);
        nFlags |= ScRefFlags.VALID;
      }
      aRef.SetAddress(this.rDoc.GetSheetLimits(), aAddr, this.aPos);
      this.maRawToken = new ScSingleRefToken(this.rDoc.GetSheetLimits(), aRef);
    }
    return (nFlags & ScRefFlags.VALID) !== 0;
  }

  private ParseReference(rName: string, pErrRef?: string): boolean {
    // Has to be called before ParseValue

    // A later ParseNamedRange() relies on these, being set in ParseSingleReference()
    // if so, reset in all cases.
    this.mnCurrentSheetEndPos = 0;
    this.mnCurrentSheetTab = -1;

    const ch1 = rName[0]!;
    const cDecSep = '.';
    if (ch1 === cDecSep) return false;
    // Who was that imbecile introducing '.' as the sheet name separator!?!
    if (/[0-9]/.test(ch1) && this.pConv.getSpecialSymbol('SHEET_SEPARATOR') === '.') {
      // Numerical sheet name is valid.
      // But English 1.E2 or 1.E+2 is value 100, 1.E-2 is 0.01
      // Don't create a #REF! of values. But also do not bail out on
      // something like 3:3, meaning entire row 3.
      do {
        const nPos = FindUnquoted(rName, '.');
        if (nPos === -1) {
          if (FindUnquoted(rName, ':') !== -1) break; // may be 3:3, continue as usual
          return false;
        }
        const ch2 = rName[nPos + 1] ?? '\0'; // maybe a column identifier
        if (!(ch2 === '$' || /[A-Za-z]/.test(ch2))) return false;
        if ((ch2 === 'E' || ch2 === 'e') && this.GetCharTableFlags(rName[nPos + 2] ?? '\0', ch2) & F.ValueExp) {
          // If it is an 1.E2 expression check if "1" is an existent sheet
          // name. If so, a desired value 1.E2 would have to be entered as
          // 1E2 or 1.0E2 or 1.E+2, sorry.
          const aTabName = rName.slice(0, nPos);
          if (this.rDoc.GetTable(aTabName) < 0) return false;
          // If sheet "1" exists and the expression is 1.E+2 continue as
          // usual, the ScRange/ScAddress parser will take care of it.
        }
      } while (false);
    }

    if (this.ParseSingleReference(rName, pErrRef)) return true;

    // Though the range operator is handled explicitly, when encountering
    // something like Sheet1.A:A we will have to treat it as one entity if it
    // doesn't pass as single cell reference.
    if (this.mnRangeOpPosInSymbol > 0) { // ":foo" would be nonsense
      if (this.ParseDoubleReference(rName, pErrRef)) return true;
      // Now try with a symbol up to the range operator, rewind source
      // position.
      const nLen = this.cSymbol.length;
      this.cSymbol = this.cSymbol.slice(0, this.mnRangeOpPosInSymbol);
      this.nSrcPos -= nLen - this.mnRangeOpPosInSymbol;
      this.mnRangeOpPosInSymbol = -1;
      this.mbRewind = true;
      return true; // end all checks
    } else {
      const eConv = this.pConv.meConv;
      if (eConv === FormulaGrammar.CONV_XL_A1 || eConv === FormulaGrammar.CONV_XL_OOX) {
        // Special treatment for the 'E:\[doc]Sheet1:Sheet3'!D5 Excel
        // sickness, mnRangeOpPosInSymbol did not catch the range
        // operator as it is within a quoted name.
        if (rName[0] !== '\'') return false; // Document name has to be single quoted.
      }
      if (eConv === FormulaGrammar.CONV_XL_A1 || eConv === FormulaGrammar.CONV_XL_OOX || eConv === FormulaGrammar.CONV_XL_R1C1) {
        // C2 or C[1] are valid entire column references.
        if (this.ParseDoubleReference(rName, pErrRef)) return true;
      }
    }
    return false;
  }

  /** ScCompiler::GetRangeData for an upper case name: local names first, then global ones. */
  private GetRangeData(rUpperName: string): { pData: ScRangeData; nSheet: number } | null {
    // try local names first
    let nSheet = this.aPos.Tab();
    let pRangeName = this.rDoc.GetRangeName(nSheet);
    let pData: ScRangeData | null = null;
    if (pRangeName) pData = pRangeName.findByUpperName(rUpperName);
    if (!pData) {
      pRangeName = this.rDoc.GetRangeName();
      if (pRangeName) pData = pRangeName.findByUpperName(rUpperName);
      if (pData) nSheet = -1;
    }
    return pData ? { pData, nSheet } : null;
  }

  /** The named expression of an ocName token. */
  GetRangeDataOfToken(rToken: FormulaToken): ScRangeData | null {
    const nTab = rToken.GetSheet();
    const pRangeName = nTab >= 0 ? this.rDoc.GetRangeName(nTab) : this.rDoc.GetRangeName();
    return pRangeName ? pRangeName.findByIndex(rToken.GetIndex()) : null;
  }

  private ParseNamedRange(rUpperName: string, onlyCheck = false): boolean {
    // ParseNamedRange is called only from NextNewToken, with an upper-case string
    const r = this.GetRangeData(rUpperName);
    if (r) {
      if (!onlyCheck) this.maRawToken = new FormulaIndexToken(ocName, r.pData.GetIndex(), r.nSheet);
      return true;
    }

    // Sheet-local name with sheet specified.
    if (this.mnCurrentSheetEndPos > 0 && this.mnCurrentSheetTab >= 0) {
      const aName = rUpperName.slice(this.mnCurrentSheetEndPos);
      const pRangeName = this.rDoc.GetRangeName(this.mnCurrentSheetTab);
      if (pRangeName) {
        const pData = pRangeName.findByUpperName(aName);
        if (pData) {
          if (!onlyCheck) this.maRawToken = new FormulaIndexToken(ocName, pData.GetIndex(), this.mnCurrentSheetTab);
          return true;
        }
      }
    }
    return false;
  }

  /** A named database range (ParseDBRange): an ocDBArea token with the range's index. */
  private ParseDBRange(rName: string): boolean {
    const rDBs = this.rDoc.GetDBCollection?.().getNamedDBs();
    const p = rDBs?.findByUpperName(rName);
    if (!p) return false;
    this.maRawToken = new FormulaIndexToken(ocDBArea, p.GetIndex(), -1); // DB range is always global.
    return true;
  }

  /** A database range in the RPN: its area as a reference (HandleDbData). */
  override HandleDbData(): boolean {
    const pDBData = this.rDoc.GetDBCollection?.().getNamedDBs().findByIndex(this.mpToken.GetIndex());
    if (!pDBData) this.SetError(FormulaError.NoName);
    else if (this.mbJumpCommandReorder) {
      const aRefData = new ScComplexRefData();
      aRefData.InitFlags();
      const aRange = pDBData.GetArea();
      aRange.aEnd.SetTab(aRange.aStart.Tab());
      aRefData.SetRange(this.rDoc.GetSheetLimits(), aRange, this.aPos);
      const pNew = new ScTokenArray(this.rDoc.GetSheetLimits());
      pNew.AddDoubleReference(aRefData);
      this.PushTokenArray(pNew, true);
      return this.GetToken();
    }
    return true;
  }

  private ParseBoolean(rName: string): boolean {
    const e = this.mxSymbols.getHashMap().get(rName);
    if (e !== undefined && (e === ocTrue || e === ocFalse)) {
      this.SetOpCode(e);
      return true;
    }
    return false;
  }

  private ParseErrorConstant(rName: string): boolean {
    const nError = this.GetErrorConstant(rName);
    if (nError !== FormulaError.NONE) {
      this.maRawToken = new FormulaErrorToken(nError);
      return true;
    }
    return false;
  }

  /** Compiles a formula string into a token array (the code, no RPN yet). */
  CompileString(rFormula: string): ScTokenArray {
    const aArr = new ScTokenArray(this.rDoc.GetSheetLimits());
    this.pArr = aArr;
    this.maArrIterator = new FormulaTokenArrayPlainIterator(aArr);
    this.aFormula = rFormula.replace(/^ +| +$/g, '');
    this.nSrcPos = 0;
    let nForced = 0; // ==formula forces recalc even if cell is not visible
    if (this.nSrcPos < this.aFormula.length && this.aFormula[this.nSrcPos] === '=') {
      this.nSrcPos++;
      nForced++;
    }
    if (this.nSrcPos < this.aFormula.length && this.aFormula[this.nSrcPos] === '=') {
      this.nSrcPos++;
      nForced++;
    }

    // FunctionStack only used if PODF or OOXML!
    const bPODF = FormulaGrammar.isPODF(this.meGrammar);
    const bOOXML = FormulaGrammar.isOOXML(this.meGrammar);
    const bUseFunctionStack = bPODF || bOOXML;
    const pFunctionStack: { eOp: OpCode; nSep: number }[] = [{ eOp: ocNone, nSep: 0 }];
    let nFunction = 0;
    let nHighWatermark = 0;
    let nBrackets = 0;
    let bInArray = false;
    this.eLastOp = OC.ocOpen;
    while (this.NextNewToken(bInArray)) {
      const eOp = this.maRawToken.GetOpCode();
      if (eOp === ocSkip) continue;

      switch (eOp) {
        case OC.ocOpen: {
          ++nBrackets;
          if (bUseFunctionStack) {
            ++nFunction;
            pFunctionStack[nFunction] = { eOp: this.eLastOp, nSep: 0 };
            nHighWatermark = nFunction;
          }
          break;
        }
        case ocClose: {
          if (!nBrackets) this.SetError(FormulaError.PairExpected);
          else nBrackets--;
          if (bUseFunctionStack && nFunction) --nFunction;
          break;
        }
        case ocSep: {
          if (bUseFunctionStack) ++pFunctionStack[nFunction]!.nSep;
          break;
        }
        case ocArrayOpen: {
          if (bInArray) this.SetError(FormulaError.NestedArray);
          else bInArray = true;
          // Don't count following column separator as parameter separator.
          if (bUseFunctionStack) {
            ++nFunction;
            pFunctionStack[nFunction] = { eOp, nSep: 0 };
            nHighWatermark = nFunction;
          }
          break;
        }
        case ocArrayClose: {
          if (bInArray) bInArray = false;
          else this.SetError(FormulaError.PairExpected);
          if (bUseFunctionStack && nFunction) --nFunction;
          break;
        }
        case ocTableRefOpen:
          if (bUseFunctionStack) {
            ++nFunction;
            pFunctionStack[nFunction] = { eOp, nSep: 0 };
            nHighWatermark = nFunction;
          }
          break;
        case ocTableRefClose:
          if (bUseFunctionStack && nFunction) --nFunction;
          break;
        default:
          break;
      }
      const eLastOp = this.eLastOp;
      if ((eLastOp !== OC.ocOpen || eOp !== ocClose)
        && (eLastOp === OC.ocOpen || eLastOp === ocSep || eLastOp === ocArrayRowSep || eLastOp === ocArrayColSep || eLastOp === ocArrayOpen)
        && (eOp === ocSep || eOp === ocClose || eOp === ocArrayRowSep || eOp === ocArrayColSep || eOp === ocArrayClose)) {
        // TODO: should we check for known functions with optional empty
        // args so the correction dialog can do better?
        if (!aArr.Add(new FormulaMissingToken())) {
          this.SetError(FormulaError.CodeOverflow);
          break;
        }
      }
      if (bOOXML) {
        // Append a parameter for WEEKNUM, all 1.0
        // Function is already closed, parameter count is nSep+1
        const nFunc = nFunction + 1;
        if (eOp === ocClose && nFunc <= nHighWatermark && pFunctionStack[nFunc]!.nSep === 0 && pFunctionStack[nFunc]!.eOp === ocWeek) { // 2nd week start
          if (!aArr.Add(new FormulaToken(svSep, ocSep)) || !aArr.Add(new FormulaDoubleToken(1.0))) {
            this.SetError(FormulaError.CodeOverflow);
            break;
          }
        }
      } else if (bPODF) {
        // Insert ADDRESS() new empty parameter 4 if there is a 4th, now to be 5th.
        if (eOp === ocSep && pFunctionStack[nFunction]!.eOp === ocAddress && pFunctionStack[nFunction]!.nSep === 3) {
          if (!aArr.Add(new FormulaToken(svSep, ocSep)) || !aArr.Add(new FormulaDoubleToken(1.0))) {
            this.SetError(FormulaError.CodeOverflow);
            break;
          }
          ++pFunctionStack[nFunction]!.nSep;
        }
      }
      const pNewToken = aArr.Add(this.maRawToken);
      if (!pNewToken && eOp === ocArrayClose && aArr.OpCodeBefore(aArr.GetLen()) === ocArrayClose) {
        // Nested inline array or non-value/non-string in array. The
        // original tokens are still in the ScTokenArray and not merged
        // into an ScMatrixToken. Set error but keep on tokenizing.
        this.SetError(FormulaError.BadArrayContent);
      } else if (!pNewToken) {
        this.SetError(FormulaError.CodeOverflow);
        break;
      } else if (eLastOp === ocRange && pNewToken.GetOpCode() === ocPush && pNewToken.GetType() === svSingleRef) {
        aArr.MergeRangeReference(this.aPos);
      }
      this.eLastOp = this.maRawToken.GetOpCode();
    }
    if (this.mbCloseBrackets) {
      if (bInArray) {
        if (!aArr.Add(new FormulaByteToken(ocArrayClose))) this.SetError(FormulaError.CodeOverflow);
      }
      if (nBrackets) {
        while (nBrackets--) {
          if (!aArr.Add(new FormulaToken(svSep, ocClose))) {
            this.SetError(FormulaError.CodeOverflow);
            break; // while
          }
        }
      }
    }

    if (nForced >= 2) aArr.SetRecalcModeForced();

    aArr.GenHash();
    this.pArr = aArr;
    this.maArrIterator = new FormulaTokenArrayPlainIterator(aArr);
    return aArr;
  }

  /** Compiles the code of the token array into RPN. */
  override CompileTokenArray(): boolean {
    this.maTabNames = null;
    return super.CompileTokenArray();
  }

  override ExtendRangeReference(rTok1: FormulaToken, rTok2: FormulaToken): FormulaToken | null {
    return extendRangeReference(this.rDoc.GetSheetLimits(), rTok1, rTok2, this.aPos, true /*bReuseDoubleRef*/);
  }

  override GetForceArrayParameter(pToken: FormulaToken, nParam: number): ParamClass {
    return ScParameterClassification.GetParameterType(pToken, nParam);
  }

  override HandleRange(): boolean {
    const pRangeData = this.GetRangeDataOfToken(this.mpToken);
    if (pRangeData) {
      const nErr = pRangeData.GetErrCode();
      if (nErr !== FormulaError.NONE) this.SetError(nErr);
      else if (this.mbJumpCommandReorder) {
        // put named formula into parentheses.
        // But only if there aren't any yet, parenthetical
        // ocSep doesn't work, e.g. SUM((...;...))
        // or if not directly between ocSep/parenthesis,
        // e.g. SUM(...;(...;...)) no, SUM(...;(...)*3) yes,
        // in short: if it isn't a self-contained expression.
        const p1 = this.maArrIterator.PeekPrevNoSpaces();
        const p2 = this.maArrIterator.PeekNextNoSpaces();
        const eOp1 = p1 ? p1.GetOpCode() : ocSep;
        const eOp2 = p2 ? p2.GetOpCode() : ocSep;
        const bBorder1 = eOp1 === ocSep || eOp1 === OC.ocOpen;
        const bBorder2 = eOp2 === ocSep || eOp2 === ocClose;
        const bAddPair = !(bBorder1 && bBorder2);
        if (bAddPair) {
          const pNew = new ScTokenArray(this.rDoc.GetSheetLimits());
          pNew.AddOpCode(ocClose);
          this.PushTokenArray(pNew, true);
        }
        const pNew = pRangeData.GetCode()!.Clone();
        pNew.SetFromRangeName(true);
        this.PushTokenArray(pNew, true);
        if (pRangeData.HasReferences()) {
          // Relative sheet references in sheet-local named expressions
          // shall still point to the same sheet as if used on the
          // original sheet, not shifted to the current position where
          // they are used.
          const nSheetTab = this.mpToken.GetSheet();
          if (nSheetTab >= 0 && nSheetTab !== this.aPos.Tab()) this.AdjustSheetLocalNameRelReferences(nSheetTab - this.aPos.Tab());
          this.SetRelNameReference();
          this.MoveRelWrap();
        }
        this.maArrIterator.Reset();
        if (bAddPair) {
          const pOpen = new ScTokenArray(this.rDoc.GetSheetLimits());
          pOpen.AddOpCode(OC.ocOpen);
          this.PushTokenArray(pOpen, true);
        }
        return this.GetToken();
      }
    } else {
      // No ScRangeData for an already compiled token can happen in BIFF .xls
      // import if the original range is not present in the document.
      const pNew = new ScTokenArray(this.rDoc.GetSheetLimits());
      pNew.Add(new FormulaErrorToken(FormulaError.NoName));
      this.PushTokenArray(pNew, true);
      return this.GetToken();
    }
    return true;
  }

  /** Relative sheet references of a sheet-local name used on another sheet keep their sheet. */
  private AdjustSheetLocalNameRelReferences(nDelta: number): void {
    const it = new FormulaTokenArrayPlainIterator(this.pArr!);
    for (let t = it.GetNextReference(); t; t = it.GetNextReference()) {
      const rRef1 = t.GetSingleRef() as ScSingleRefData;
      if (rRef1.IsTabRel()) rRef1.IncTab(nDelta);
      if (t.GetType() === svDoubleRef) {
        const rRef2 = t.GetDoubleRef().Ref2 as ScSingleRefData;
        if (rRef2.IsTabRel()) rRef2.IncTab(nDelta);
      }
    }
  }

  /** Set bRelName on relative references of the expanded named expression. */
  private SetRelNameReference(): void {
    const it = new FormulaTokenArrayPlainIterator(this.pArr!);
    for (let t = it.GetNextReference(); t; t = it.GetNextReference()) {
      const rRef1 = t.GetSingleRef() as ScSingleRefData;
      if (rRef1.IsColRel() || rRef1.IsRowRel() || rRef1.IsTabRel()) rRef1.SetRelName(true);
      if (t.GetType() === svDoubleRef) {
        const rRef2 = t.GetDoubleRef().Ref2 as ScSingleRefData;
        if (rRef2.IsColRel() || rRef2.IsRowRel() || rRef2.IsTabRel()) rRef2.SetRelName(true);
      }
    }
  }

  /** Put relative references of the named expression into the sheet's dimensions (ScRefUpdate::MoveRelWrap). */
  private MoveRelWrap(): void {
    const lim = this.rDoc.GetSheetLimits();
    const wrap = (r: ScSingleRefData) => {
      if (r.IsColRel()) {
        let n = r.Col() + this.aPos.Col();
        if (n < 0) n += lim.GetMaxColCount();
        else if (n > lim.MaxCol()) n -= lim.GetMaxColCount();
        r.SetRelCol(n - this.aPos.Col());
      }
      if (r.IsRowRel()) {
        let n = r.Row() + this.aPos.Row();
        if (n < 0) n += lim.GetMaxRowCount();
        else if (n > lim.MaxRow()) n -= lim.GetMaxRowCount();
        r.SetRelRow(n - this.aPos.Row());
      }
    };
    const it = new FormulaTokenArrayPlainIterator(this.pArr!);
    for (let t = it.GetNextReference(); t; t = it.GetNextReference()) {
      if (t.GetType() === svSingleRef) wrap(t.GetSingleRef());
      else {
        wrap(t.GetDoubleRef().Ref1);
        wrap(t.GetDoubleRef().Ref2);
      }
    }
  }

  override CreateStringFromSingleRef(pToken: FormulaToken): string {
    const aErrRef = this.GetCurrentOpCodeMap().getSymbol(ocErrRef);
    const rRef = pToken.GetSingleRef() as ScSingleRefData;
    const aRef = new ScComplexRefData();
    aRef.Ref1 = rRef;
    aRef.Ref2 = rRef;
    return this.pConv.makeRefStr(this.rDoc.GetSheetLimits(), this.meGrammar, this.aPos, aErrRef, this.GetSetupTabNames(), aRef, true, !!this.pArr && this.pArr.IsFromRangeName());
  }

  override CreateStringFromDoubleRef(pToken: FormulaToken): string {
    const aErrRef = this.GetCurrentOpCodeMap().getSymbol(ocErrRef);
    return this.pConv.makeRefStr(this.rDoc.GetSheetLimits(), this.meGrammar, this.aPos, aErrRef, this.GetSetupTabNames(), pToken.GetDoubleRef() as ScComplexRefData, false, !!this.pArr && this.pArr.IsFromRangeName());
  }

  override CreateStringFromIndex(pToken: FormulaToken): string {
    const eOp = pToken.GetOpCode();
    let aBuffer = '';
    switch (eOp) {
      case ocName: {
        const pData = this.GetRangeDataOfToken(pToken);
        if (pData) {
          const nTab = pToken.GetSheet();
          if (nTab >= 0 && nTab !== this.aPos.Tab()) {
            // Sheet-local on other sheet.
            const aName = this.rDoc.GetName(nTab);
            if (aName !== undefined) aBuffer += CheckTabQuotes(aName, this.pConv.meConv);
            else aBuffer += FormulaCompiler.GetNativeSymbol(ocErrName);
            aBuffer += this.pConv.getSpecialSymbol('SHEET_SEPARATOR');
          }
          aBuffer += pData.GetName();
        }
        break;
      }
      case ocDBArea: {
        const pDBData = this.rDoc.GetDBCollection?.().getNamedDBs().findByIndex(pToken.GetIndex());
        if (pDBData) aBuffer += pDBData.GetName();
        break;
      }
      default:
      // nothing
    }
    if (aBuffer) return aBuffer;
    return FormulaCompiler.GetNativeSymbol(ocErrName);
  }

  override CreateStringFromMatrix(pTokenP: FormulaToken): string {
    const pMatrix = pTokenP.GetMatrix() as ScMatrix;
    const { nC: nC, nR: nR } = pMatrix.GetDimensions();
    let rBuffer = this.mxSymbols.getSymbol(ocArrayOpen);
    for (let nRow = 0; nRow < nR; nRow++) {
      if (nRow > 0) rBuffer += this.mxSymbols.getSymbol(ocArrayRowSep);
      for (let nCol = 0; nCol < nC; nCol++) {
        if (nCol > 0) rBuffer += this.mxSymbols.getSymbol(ocArrayColSep);
        if (pMatrix.IsValue(nCol, nRow)) {
          if (pMatrix.IsBoolean(nCol, nRow)) rBuffer += this.AppendBoolean(pMatrix.GetDouble(nCol, nRow) !== 0.0);
          else {
            const nErr = pMatrix.GetError(nCol, nRow);
            if (nErr !== FormulaError.NONE) rBuffer += this.AppendErrorConstant(nErr);
            else rBuffer += this.AppendDouble(pMatrix.GetDouble(nCol, nRow));
          }
        } else if (pMatrix.IsEmpty(nCol, nRow)) {
          // nothing
        } else if (pMatrix.IsStringOrEmpty(nCol, nRow)) rBuffer += FormulaCompiler.AppendString(pMatrix.GetString(nCol, nRow));
      }
    }
    rBuffer += this.mxSymbols.getSymbol(ocArrayClose);
    return rBuffer;
  }

  /** CreateStringFromTokenArray for the token array this compiler was given. */
  CreateString(): string { return this.CreateStringFromTokenArray(); }

  /** Sets a new token array to work on (for stringifying or compiling). */
  SetTokenArray(rArr: ScTokenArray): void {
    this.pArr = rArr;
    this.maArrIterator = new FormulaTokenArrayPlainIterator(rArr);
    this.maTabNames = null;
  }

  GetPos(): ScAddress { return this.aPos; }
}

export { ocNone, ocPush, ocAdd, ocRange, ocSpaces, ocWhitespace };
