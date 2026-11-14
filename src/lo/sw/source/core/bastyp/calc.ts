// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/bastyp/calc.cxx reduced
// @upstream sw/inc/calc.hxx reduced
// SwCalc: the expression evaluator of table formulas. Operators and functions as upstream (+ - * /
// ^ %, sum mean average count min max mod product round date abs sign int sqrt sin cos tan asin
// acos atan not and or xor, eq neq leq geq l g == != < > <= >=, add sub mul div pow phd), lists
// separated by | and the round and date arguments by ;. Values are numbers or booleans (SbxVariant
// reduced); strings in double quotes count as 0. The variables are pi, e, true and false, those set
// with name=expression (VarInsert) or VarChange, and the user fields (VarLook asks `m_fnVarLook`,
// which calculates a user field's content with this calculator, guarded by Push and Pop); a string
// variable counts as its text read as a number. Database columns are not ported, and unknown names
// count as 0 (as upstream allows).
// Numbers are read in the document language's notation (CharClass::parseAnyToken).

export const SwCalcError = { NONE: 0, Syntax: 1, DivByZero: 2, FaultyBrackets: 3, OverflowInPower: 4, Overflow: 5 } as const;
export type SwCalcError = (typeof SwCalcError)[keyof typeof SwCalcError];

type Op =
  | 'NUMBER' | 'NAME' | 'END' | 'PRINT' | '+' | '-' | '*' | '/' | '(' | ')' | '='
  | 'EQ' | 'NEQ' | 'LEQ' | 'GEQ' | 'LES' | 'GRE' | 'AND' | 'OR' | 'XOR' | 'NOT'
  | 'SUM' | 'MEAN' | 'AVERAGE' | 'COUNT' | 'MIN' | 'MAX' | 'MOD' | 'PRODUCT' | 'DATE' | 'ROUND' | 'PHD' | 'POW'
  | 'SQRT' | 'SIN' | 'COS' | 'TAN' | 'ASIN' | 'ACOS' | 'ATAN' | 'ABS' | 'SIGN' | 'INT'
  | 'MIN_IN' | 'MAX_IN' | 'MOD_IN' | 'MONTH' | 'DAY';

/** aOpTable */
const OPERATORS: Record<string, Op> = {
  abs: 'ABS', acos: 'ACOS', add: '+', and: 'AND', asin: 'ASIN', atan: 'ATAN', average: 'AVERAGE', cos: 'COS', count: 'COUNT', date: 'DATE', div: '/',
  eq: 'EQ', g: 'GRE', geq: 'GEQ', int: 'INT', l: 'LES', leq: 'LEQ', max: 'MAX', mean: 'MEAN', min: 'MIN', mod: 'MOD', mul: '*', neq: 'NEQ',
  not: 'NOT', or: 'OR', phd: 'PHD', pow: 'POW', product: 'PRODUCT', round: 'ROUND', sign: 'SIGN', sin: 'SIN', sqrt: 'SQRT', sub: '-', sum: 'SUM',
  tan: 'TAN', xor: 'XOR',
};

/** SwSbxValue, reduced: a number, possibly a boolean. */
interface Val { v: number; bool?: boolean }
const num = (v: number): Val => ({ v });
const bool = (b: boolean): Val => ({ v: b ? 1 : 0, bool: true });

const nRoundVal = [5.0e-1, 5.0e-2, 5.0e-3, 5.0e-4, 5.0e-5, 5.0e-6, 5.0e-7, 5.0e-8, 5.0e-9, 5.0e-10, 5.0e-11, 5.0e-12, 5.0e-13, 5.0e-14, 0.5e-15, 0.5e-16];

export class SwCalc {
  private m_sCommand = '';
  private m_nCommandPos = 0;
  private m_eCurrOper: Op = 'END';
  private m_eCurrListOper: Op = '+';
  private m_nNumberValue: Val = num(0);
  private m_aVarName = '';
  private m_nListPor = 0;
  private m_bHasNumber = false;
  private m_eError: SwCalcError = SwCalcError.NONE;
  private readonly m_cDecimal: string;
  /** VarLook for the names the shell does not know. */
  m_aVars = new Map<string, number>([['pi', Math.PI], ['e', Math.E], ['true', 1], ['false', 0]]);

  /** The document's part of VarLook (the field types' table): a user field's value, or undefined. */
  m_fnVarLook: ((rName: string) => number | undefined) | null = null;
  /** The field types being calculated (Push and Pop), against recursion. */
  private m_aRekurStack: unknown[] = [];

  /** The group separator numbers may have (CharClass::parseAnyToken's GROUP_SEPARATOR_IN_NUMBER), if any. */
  private readonly m_cGroup: string | null;

  constructor(cDecimal = '.', cGroup: string | null = null) { this.m_cDecimal = cDecimal; this.m_cGroup = cGroup; }

  /** SwCalc::VarChange: sets a variable (by its name, ignoring case). */
  VarChange(rStr: string, nValue: number): void { this.m_aVars.set(rStr.toLowerCase(), nValue); }

  /** SwCalc::Push: false when the field type is already being calculated. */
  Push(pPtr: unknown): boolean {
    if (this.m_aRekurStack.includes(pPtr)) return false;
    this.m_aRekurStack.push(pPtr);
    return true;
  }
  /** SwCalc::Pop */
  Pop(): void { this.m_aRekurStack.pop(); }

  /** SwCalc::VarLook, reduced: the variable, else the document's field type of the name. */
  private VarLook(rStr: string): number | undefined {
    const aStr = rStr.toLowerCase();
    const v = this.m_aVars.get(aStr);
    if (v !== undefined) return v;
    if (!this.m_fnVarLook) return undefined;
    // Save the current values...
    const saved = [this.m_nListPor, this.m_bHasNumber, this.m_nNumberValue, this.m_nCommandPos, this.m_eCurrOper, this.m_eCurrListOper, this.m_sCommand, this.m_aVarName, this.m_eError] as const;
    const r = this.m_fnVarLook(rStr);
    // ...and write them back.
    const eErr = this.m_eError;
    [this.m_nListPor, this.m_bHasNumber, this.m_nNumberValue, this.m_nCommandPos, this.m_eCurrOper, this.m_eCurrListOper, this.m_sCommand, this.m_aVarName, this.m_eError] = saved;
    if (eErr !== SwCalcError.NONE) this.m_eError = eErr;
    return r;
  }

  /**
   * SwCalc::IsValidVarName (the app's CharClass::parseAnyToken for an identifier): whether the
   * whole text is a name, and the name it starts with after leading blanks (empty if none).
   */
  static IsValidVarName(rStr: string): { bRet: boolean; sValidName: string } {
    const m = /^(\s*)([\p{L}_][\p{L}\p{N}_.]*)/u.exec(rStr);
    if (!m) return { bRet: false, sValidName: '' };
    return { bRet: m[0].length === rStr.length, sValidName: m[2]! };
  }

  GetCalcError(): SwCalcError { return this.m_eError; }
  SetCalcError(e: SwCalcError = SwCalcError.Syntax): void { this.m_eError = e; }
  IsCalcError(): boolean { return this.m_eError !== SwCalcError.NONE; }

  /** SwCalc::Calculate */
  Calculate(rStr: string): number {
    this.m_eError = SwCalcError.NONE;
    if (!rStr) return 0;
    this.m_nListPor = 0;
    this.m_eCurrListOper = '+'; // default: sum
    this.m_sCommand = rStr;
    this.m_nCommandPos = 0;
    let nResult = num(0);
    while (this.GetToken() !== 'END' && !this.m_eError) nResult = this.Expr();
    if (this.m_eError) return NaN;
    return nResult.v;
  }

  private GetToken(): Op {
    const s = this.m_sCommand;
    while (this.m_nCommandPos < s.length && /\s/.test(s[this.m_nCommandPos]!) && s[this.m_nCommandPos] !== '\n') this.m_nCommandPos++;
    if (this.m_nCommandPos >= s.length) { this.m_eCurrOper = 'END'; return this.m_eCurrOper; }
    const rest = s.slice(this.m_nCommandPos);
    const dec = this.m_cDecimal === '.' ? '\\.' : `[${this.m_cDecimal}.]`;
    // With a group separator, digits grouped by three (5.000 in German) are one number.
    const grp = this.m_cGroup ? new RegExp(`^\\d{1,3}(?:\\${this.m_cGroup}\\d{3})+(?:\\${this.m_cDecimal}\\d*)?(?![\\d])`).exec(rest) : null;
    const nm = grp ?? new RegExp(`^(\\d+(?:${dec}\\d*)?|${dec}\\d+)(?:[eE][+-]?\\d+)?`).exec(rest);
    if (nm) {
      this.m_nNumberValue = num(Number((grp ? nm[0].split(this.m_cGroup!).join('') : nm[0]).replace(this.m_cDecimal, '.')));
      this.m_eCurrOper = 'NUMBER';
      this.m_nCommandPos += nm[0].length;
      return this.m_eCurrOper;
    }
    const id = /^[\p{L}_][\p{L}\p{N}_.]*/u.exec(rest);
    if (id) {
      this.m_nCommandPos += id[0].length;
      const lower = id[0].toLowerCase();
      const op = OPERATORS[lower];
      if (op) {
        this.m_eCurrOper = op;
        switch (op) {
          case 'SUM': case 'MEAN': case 'AVERAGE': case 'COUNT': this.m_eCurrListOper = '+'; break;
          case 'MIN': this.m_eCurrListOper = 'MIN_IN'; break;
          case 'MAX': this.m_eCurrListOper = 'MAX_IN'; break;
          case 'MOD': this.m_eCurrListOper = 'MOD_IN'; break;
          case 'DATE': this.m_eCurrListOper = 'MONTH'; break;
          case 'PRODUCT': this.m_eCurrListOper = '*'; break;
          default: break;
        }
        return op;
      }
      this.m_aVarName = id[0];
      this.m_eCurrOper = 'NAME';
      return this.m_eCurrOper;
    }
    const c = rest[0]!;
    if (c === '"') {
      const e = rest.indexOf('"', 1);
      this.m_nCommandPos += e < 0 ? rest.length : e + 1;
      this.m_nNumberValue = num(0);
      this.m_eCurrOper = 'NUMBER';
      return this.m_eCurrOper;
    }
    this.m_nCommandPos++;
    switch (c) {
      case ';':
        if (this.m_eCurrListOper === 'MONTH' || this.m_eCurrListOper === 'DAY') { this.m_eCurrOper = this.m_eCurrListOper; break; }
        this.m_eCurrOper = 'PRINT'; break;
      case '\n': this.m_eCurrOper = 'PRINT'; break;
      // CALC_PHD is '%', CALC_POW '^'
      case '%': this.m_eCurrOper = 'PHD'; break;
      case '^': this.m_eCurrOper = 'POW'; break;
      case '*': case '/': case '+': case '-': case '(': case ')': this.m_eCurrOper = c; break;
      case '=': case '!':
        this.m_eCurrOper = c === '=' ? '=' : 'NOT';
        if (s[this.m_nCommandPos] === '=') { this.m_eCurrOper = c === '=' ? 'EQ' : 'NEQ'; this.m_nCommandPos++; }
        break;
      case '|': this.m_eCurrOper = this.m_eCurrListOper; break;
      case '<': case '>':
        this.m_eCurrOper = c === '<' ? 'LES' : 'GRE';
        if (s[this.m_nCommandPos] === '=') { this.m_eCurrOper = c === '<' ? 'LEQ' : 'GEQ'; this.m_nCommandPos++; }
        break;
      default:
        this.m_eError = SwCalcError.Syntax;
        this.m_eCurrOper = 'PRINT';
    }
    return this.m_eCurrOper;
  }

  /** The current operator (read anew, as GetToken changes it). */
  private cur(): Op { return this.m_eCurrOper; }

  private Term(): Val {
    let left = this.Prim();
    for (;;) {
      let sbx: Op | null = null;
      switch (this.m_eCurrOper) {
        case 'AND': { this.GetToken(); const bB = this.Prim().v !== 0; left = bool(left.v !== 0 && bB); break; }
        case 'OR': { this.GetToken(); const bB = this.Prim().v !== 0; left = bool(left.v !== 0 || bB); break; }
        case 'XOR': { this.GetToken(); const bR = this.Prim().v !== 0; left = bool((left.v !== 0) !== bR); break; }
        case 'EQ': case 'NEQ': case 'LEQ': case 'GEQ': case 'GRE': case 'LES': case '*': case '/': sbx = this.m_eCurrOper; break;
        case 'MIN_IN': { this.GetToken(); const e = this.Prim(); left = left.v < e.v ? left : e; break; }
        case 'MAX_IN': { this.GetToken(); const e = this.Prim(); left = left.v > e.v ? left : e; break; }
        case 'MOD_IN': {
          this.GetToken();
          const e = this.Prim();
          if (e.v === 0) this.m_eError = SwCalcError.DivByZero;
          else left = num(Math.trunc(left.v) % Math.trunc(e.v));
          break;
        }
        case 'MONTH': {
          this.GetToken();
          const e = this.Prim();
          // year in the low 16 bits, month above
          left = num((Math.floor(left.v) & 0xffff) + ((Math.floor(e.v) & 0xff) << 16));
          this.m_eCurrOper = 'DAY';
          break;
        }
        case 'DAY': {
          this.GetToken();
          const e = this.Prim();
          const ym = Math.floor(left.v) & 0xffffff;
          const y = ym & 0xffff, m = (ym >> 16) & 0xff, d = Math.floor(e.v) & 0xff;
          // lcl_ConvertToDateValue: days since the document's null date (1899-12-30)
          left = num((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
          break;
        }
        case 'ROUND': {
          this.GetToken();
          const e = this.Prim();
          const nDec = Math.floor(e.v);
          if (nDec < -20 || nDec > 20) { this.m_eError = SwCalcError.Overflow; return num(0); }
          const fFac = 10 ** nDec;
          let fVal = left.v * fFac;
          const bSign = fVal < 0;
          if (bSign) fVal = -fVal;
          // rounding
          let fNum = fVal, nExp = 0;
          if (fNum > 0) { while (fNum < 1.0) { fNum *= 10.0; --nExp; } while (fNum >= 10.0) { fNum /= 10.0; ++nExp; } }
          nExp = 15 - nExp;
          if (nExp > 15) nExp = 15; else if (nExp <= 1) nExp = 0;
          fVal = Math.floor(fVal + 0.5 + nRoundVal[nExp]!);
          if (bSign) fVal = -fVal;
          left = num(fVal / fFac);
          break;
        }
        default: return left;
      }
      if (sbx) {
        this.GetToken();
        const right = this.Prim();
        switch (sbx) {
          case 'EQ': left = bool(left.v === right.v); break;
          case 'NEQ': left = bool(left.v !== right.v); break;
          case 'LEQ': left = bool(left.v <= right.v); break;
          case 'GEQ': left = bool(left.v >= right.v); break;
          case 'GRE': left = bool(left.v > right.v); break;
          case 'LES': left = bool(left.v < right.v); break;
          case '*': left = num(left.v * right.v); break;
          case '/':
            if (!right.v) this.m_eError = SwCalcError.DivByZero;
            else left = num(left.v / right.v);
            break;
          default: break;
        }
      }
    }
  }

  private StdFunc(pFnc: (x: number) => number, bChkTrig: boolean): Val {
    this.GetToken();
    const nVal = this.Prim().v;
    if (!bChkTrig || (nVal > -1 && nVal < 1)) return num(pFnc(nVal));
    this.m_eError = SwCalcError.Overflow;
    return num(0);
  }

  private PrimFunc(chk: { pow: boolean }): Val {
    chk.pow = false;
    switch (this.m_eCurrOper) {
      case 'SIN': return this.StdFunc(Math.sin, false);
      case 'COS': return this.StdFunc(Math.cos, false);
      case 'TAN': return this.StdFunc(Math.tan, false);
      case 'ATAN': return this.StdFunc(Math.atan, false);
      case 'ASIN': return this.StdFunc(Math.asin, true);
      case 'ACOS': return this.StdFunc(Math.acos, true);
      case 'ABS': return this.StdFunc(Math.abs, false);
      case 'SIGN': { this.GetToken(); const nVal = this.Prim().v; return num(Number(nVal > 0) - Number(nVal < 0)); }
      case 'INT': { this.GetToken(); return num(Math.trunc(this.Prim().v)); }
      case 'NOT': {
        this.GetToken();
        const nErg = this.Prim();
        // a BOOLEAN NOT
        return bool(nErg.v === 0);
      }
      case 'NUMBER': {
        this.m_bHasNumber = true;
        const nValue = this.m_nNumberValue;
        if (this.GetToken() === 'PHD') { this.GetToken(); return num(nValue.v * 0.01); }
        if (this.cur() === 'NAME') { this.m_eError = SwCalcError.Syntax; return num(0); }
        chk.pow = true;
        return nValue;
      }
      case 'NAME': {
        const name = this.m_aVarName;
        const eOper = this.GetToken();
        if (eOper === '=') {
          // CALC_ASSIGN: VarInsert
          this.GetToken();
          const nErg = this.Expr();
          this.VarChange(name, nErg.v);
          return nErg;
        }
        const v = this.VarLook(name);
        // Explicitly disallow unknown function names (followed by "("), allow unknown variable names (equal to zero)
        if (v === undefined && eOper === '(') { this.m_eError = SwCalcError.Syntax; return num(0); }
        chk.pow = true;
        return num(v ?? 0);
      }
      case '-': { this.GetToken(); return num(-this.Prim().v); }
      case '(': {
        this.GetToken();
        const nErg = this.Expr();
        if (this.cur() !== ')') this.m_eError = SwCalcError.FaultyBrackets;
        else { this.GetToken(); chk.pow = true; } // in order for =(7)^2 to work
        return nErg;
      }
      case ')': return num(0); // ignore, see tdf#121962
      case 'MEAN': case 'AVERAGE': {
        this.m_nListPor = 1;
        this.m_bHasNumber = this.m_eCurrOper === 'MEAN';
        this.GetToken();
        const nErg = this.Expr();
        if (!this.m_bHasNumber) { this.m_eError = SwCalcError.DivByZero; return nErg; }
        return num(nErg.v / this.m_nListPor);
      }
      case 'COUNT': {
        this.m_nListPor = 1;
        this.m_bHasNumber = false;
        this.GetToken();
        this.Expr();
        return num(this.m_bHasNumber ? this.m_nListPor : 0);
      }
      case 'SQRT': {
        this.GetToken();
        const nErg = this.Prim();
        if (nErg.v < 0) { this.m_eError = SwCalcError.Overflow; return nErg; }
        return num(Math.sqrt(nErg.v));
      }
      case 'SUM': case 'PRODUCT': case 'DATE': case 'MIN': case 'MAX': case 'MOD': { this.GetToken(); return this.Expr(); }
      case 'END': return num(0);
      default:
        this.m_eError = SwCalcError.Syntax;
        return num(0);
    }
  }

  private Prim(): Val {
    const chk = { pow: false };
    let nErg = this.PrimFunc(chk);
    if (chk.pow && this.m_eCurrOper === 'POW') {
      const dleft = nErg.v;
      this.GetToken();
      const right = this.Prim().v;
      const fraction = right % 1;
      if ((dleft < 0.0 && fraction !== 0) || (dleft === 0 && right < 0)) { this.m_eError = SwCalcError.Overflow; nErg = num(0); }
      else {
        const p = dleft ** right;
        if (p === Infinity) { this.m_eError = SwCalcError.OverflowInPower; nErg = num(0); }
        else nErg = num(p);
      }
    }
    return nErg;
  }

  private Expr(): Val {
    let left = this.Term();
    for (;;) {
      switch (this.m_eCurrOper) {
        case '+': { this.GetToken(); const right = this.Term(); left = num(left.v + right.v); this.m_nListPor++; break; }
        case '-': { this.GetToken(); const right = this.Term(); left = num(left.v - right.v); break; }
        default: return left;
      }
    }
  }
}
