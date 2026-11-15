// Helpers for the Calc function tests: not a port. Loads one of upstream's function test
// documents (sc/qa/unit/data/functions/*/fods/*.fods) into a document: sheets, values, strings,
// named ranges, formulas (in ODFF syntax) and array formulas, and lists the formula cells with
// the result LibreOffice stored for them.
import { readFileSync } from 'node:fs';
import { FormulaGrammar } from '../../src/lo/include/formula/grammar.ts';
import { ScAddress, ScColToAlpha } from '../../src/lo/sc/inc/address.ts';
import { ScMarkData } from '../../src/lo/sc/inc/markdata.ts';
import { ScDocument } from '../../src/lo/sc/source/core/data/document.ts';
import { SetGlobalConfig } from '../../src/lo/sc/source/core/tool/interpr1.ts';
import { ScRangeData } from '../../src/lo/sc/source/core/tool/rangenam.ts';
import { parseXml, type XmlElement } from '../../src/lo/xmloff/source/core/xmlparse.ts';

export const FODS_DIR = new URL('../../upstream/core/sc/qa/unit/data/functions/', import.meta.url);

export interface FodsFormulaCell {
  /** "Sheet2.B5" */
  ref: string;
  aPos: ScAddress;
  formula: string;
  /** The stored result: a number (booleans as 1/0) or the displayed string. */
  expected: number | string;
}

const children = (e: XmlElement, name?: string): XmlElement[] => e.children.filter((c): c is XmlElement => typeof c !== 'string' && (!name || c.name === name));

function textOf(e: XmlElement): string {
  let s = '';
  for (const c of e.children) {
    if (typeof c === 'string') s += c;
    else if (c.name === 'text:s') s += ' '.repeat(Number(c.attrs.get('text:c') ?? 1));
    else if (c.name === 'text:tab') s += '\t';
    else if (c.name === 'text:line-break') s += '\n';
    else s += textOf(c);
  }
  return s;
}

function cellText(e: XmlElement): string { return children(e, 'text:p').map(textOf).join('\n'); }

/** An ISO date or date-time as a serial date (null date 1899-12-30). */
function dateToSerial(s: string): number {
  const m = /^(-?\d+)-(\d\d)-(\d\d)(?:T(\d\d):(\d\d):(\d\d)(?:\.(\d+))?)?/.exec(s)!;
  const d = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0), Number(`0.${m[7] ?? 0}`) * 1000);
  return (d - Date.UTC(1899, 11, 30)) / 86400000;
}

/** An ISO duration (PT12H30M) in days. */
function durationToDays(s: string): number {
  const m = /^(-)?P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/.exec(s)!;
  const v = Number(m[2] ?? 0) + Number(m[3] ?? 0) / 24 + Number(m[4] ?? 0) / 1440 + Number(m[5] ?? 0) / 86400;
  return m[1] ? -v : v;
}

function storedValue(e: XmlElement): number | string | null {
  const t = e.attrs.get('office:value-type');
  switch (t) {
    case 'float':
    case 'percentage':
    case 'currency':
      return Number(e.attrs.get('office:value'));
    case 'boolean':
      return e.attrs.get('office:boolean-value') === 'true' ? 1 : 0;
    case 'date':
      return dateToSerial(e.attrs.get('office:date-value')!);
    case 'time':
      return durationToDays(e.attrs.get('office:time-value')!);
    case 'string':
      if (e.attrs.get('calcext:value-type') === 'error') return cellText(e);
      return e.attrs.get('office:string-value') ?? cellText(e);
    default:
      return e.children.length ? cellText(e) || null : null;
  }
}

/** Load a .fods file (path relative to sc/qa/unit/data/functions/). */
export function loadFods(rel: string): { doc: ScDocument; formulas: FodsFormulaCell[] } {
  const root = parseXml(readFileSync(new URL(rel, FODS_DIR), 'utf8'));
  const find = (e: XmlElement, name: string): XmlElement | null => {
    for (const c of children(e)) {
      if (c.name === name) return c;
      const r = find(c, name);
      if (r) return r;
    }
    return null;
  };
  const spreadsheet = find(root, 'office:spreadsheet')!;
  const doc = new ScDocument();
  // table:calculation-settings with the ODF defaults (regular expressions, whole cell, case sensitive)
  const calc = find(spreadsheet, 'table:calculation-settings');
  const attr = (n: string, d: boolean): boolean => (calc?.attrs.has(n) ? calc.attrs.get(n) === 'true' : d);
  const aOpt = doc.GetDocOptions().clone();
  aOpt.SetIgnoreCase(!attr('table:case-sensitive', true));
  aOpt.SetMatchWholeCell(attr('table:search-criteria-must-apply-to-whole-cell', true));
  if (attr('table:use-wildcards', false)) aOpt.SetFormulaWildcardsEnabled(true);
  else if (attr('table:use-regular-expressions', true)) aOpt.SetFormulaRegexEnabled(true);
  else {
    aOpt.SetFormulaWildcardsEnabled(false);
    aOpt.SetFormulaRegexEnabled(false);
  }
  doc.SetDocOptions(aOpt);
  const formulas: FodsFormulaCell[] = [];
  const pending: { aPos: ScAddress; formula: string; nCols: number; nRows: number; expected: number | string | null }[] = [];
  const tables = children(spreadsheet, 'table:table').filter((t) => !(t.attrs.get('table:name') ?? '').startsWith("'"));
  tables.forEach((t, nTab) => {
    doc.InsertTab(nTab, t.attrs.get('table:name')!);
  });
  tables.forEach((t, nTab) => {
    let nRow = 0;
    const rows = (e: XmlElement): XmlElement[] => children(e).flatMap((c) => (c.name === 'table:table-row' ? [c] : /^table:table-(row-group|header-rows|rows)$/.test(c.name) ? rows(c) : []));
    for (const r of rows(t)) {
      const nRowRep = Number(r.attrs.get('table:number-rows-repeated') ?? 1);
      const cells = children(r).filter((c) => c.name === 'table:table-cell' || c.name === 'table:covered-table-cell');
      const bEmptyRow = cells.every((c) => !c.attrs.has('office:value-type') && !c.attrs.has('table:formula') && !c.children.length);
      if (bEmptyRow) {
        nRow += nRowRep;
        continue;
      }
      for (let ri = 0; ri < Math.min(nRowRep, 100); ri++, nRow++) {
        let nCol = 0;
        for (const c of cells) {
          const nColRep = Number(c.attrs.get('table:number-columns-repeated') ?? 1);
          const formula = c.attrs.get('table:formula');
          const v = storedValue(c);
          for (let ci = 0; ci < (formula || v !== null ? Math.min(nColRep, 100) : 0); ci++) {
            const aPos = new ScAddress(nCol + ci, nRow, nTab);
            if (formula && c.name === 'table:table-cell') {
              const nCols = Number(c.attrs.get('table:number-matrix-columns-spanned') ?? 0);
              const nRows = Number(c.attrs.get('table:number-matrix-rows-spanned') ?? 0);
              pending.push({ aPos, formula: formula.replace(/^of:/, ''), nCols, nRows, expected: v });
            } else if (formula) {
              // part of an array formula: the expected value only
              pending.push({ aPos, formula: '', nCols: 0, nRows: 0, expected: v });
            } else if (typeof v === 'number') doc.SetValue(aPos, v);
            else if (v !== null && v !== '') doc.SetRawString(aPos, v);
          }
          nCol += nColRep;
        }
      }
      nRow += Math.max(0, nRowRep - 100);
    }
  });
  // named ranges and expressions
  const named = find(spreadsheet, 'table:named-expressions');
  if (named) {
    for (const n of children(named)) {
      const name = n.attrs.get('table:name')!;
      const aBase = new ScAddress();
      const base = n.attrs.get('table:base-cell-address');
      if (base) aBase.Parse(base.replace(/^\$?/, '$'), doc);
      let sym: string | undefined;
      if (n.name === 'table:named-range') sym = `[${n.attrs.get('table:cell-range-address')}]`;
      else if (n.name === 'table:named-expression') sym = n.attrs.get('table:expression')?.replace(/^of:=?/, '');
      if (sym) doc.GetRangeName()!.insert(new ScRangeData(doc, name, sym, aBase, undefined, FormulaGrammar.GRAM_ODFF));
    }
  }
  for (const p of pending) {
    if (p.formula) {
      if (p.nCols || p.nRows) {
        const mark = new ScMarkData(doc.GetSheetLimits());
        mark.SelectOneTable(p.aPos.Tab());
        doc.InsertMatrixFormula(p.aPos.Col(), p.aPos.Row(), p.aPos.Col() + Math.max(1, p.nCols) - 1, p.aPos.Row() + Math.max(1, p.nRows) - 1, mark, p.formula, null, FormulaGrammar.GRAM_ODFF);
      } else doc.SetFormula(p.aPos, p.formula, FormulaGrammar.GRAM_ODFF);
    }
    if (p.expected !== null) formulas.push({ ref: `${doc.GetName(p.aPos.Tab())}.${ScColToAlpha(p.aPos.Col())}${p.aPos.Row() + 1}`, aPos: p.aPos, formula: p.formula, expected: p.expected });
  }
  doc.CalcAll();
  return { doc, formulas };
}

/** The formula cells whose result differs from the stored one. */
export function fodsMismatches(rel: string, filter: (f: FodsFormulaCell) => boolean = () => true): string[] {
  // ScXMLImport::SetStringRefSyntaxIfMissing: imported documents use Calc A1 | Excel A1 in INDIRECT.
  SetGlobalConfig({ meStringRefAddressSyntax: FormulaGrammar.CONV_A1_XL_A1 });
  try {
    return fodsMismatchesImpl(rel, filter);
  } finally {
    SetGlobalConfig({ meStringRefAddressSyntax: FormulaGrammar.CONV_UNSPECIFIED });
  }
}

function fodsMismatchesImpl(rel: string, filter: (f: FodsFormulaCell) => boolean): string[] {
  const { doc, formulas } = loadFods(rel);
  const out: string[] = [];
  for (const f of formulas) {
    if (!filter(f)) continue;
    let actual: number | string;
    if (typeof f.expected === 'number') {
      const s = doc.GetString(f.aPos);
      const v = doc.GetValue(f.aPos);
      actual = /^(#|Err:)/.test(s) ? s : v;
      if (typeof actual === 'number' && (actual === f.expected || Math.abs(actual - f.expected) <= 1e-9 * Math.max(1, Math.abs(f.expected)))) continue;
    } else {
      actual = doc.GetString(f.aPos);
      if (actual === f.expected) continue;
    }
    out.push(`${f.ref} ${f.formula} expected ${JSON.stringify(f.expected)} got ${JSON.stringify(actual)}`);
  }
  return out;
}

/** The check of upstream's functions_test.cxx: after recalculation, every row of a sheet's
    "Correct" column must be TRUE. Returns the failing rows ("Sheet2.A5 '=FORMULA' result: ...,
    expected: ..."). */
export function fodsFailures(rel: string): string[] {
  SetGlobalConfig({ meStringRefAddressSyntax: FormulaGrammar.CONV_A1_XL_A1 });
  try {
    const { doc } = loadFods(rel);
    const out: string[] = [];
    for (let nTab = 1; nTab < doc.GetTableCount(); nTab++) {
      let nExpectedCol = 0, nCorrectCol = 0, nFunctStringCol = 0;
      for (let c = 0; c <= 200; ++c) {
        const s = doc.GetString(c, 0, nTab);
        if (s === 'Expected') nExpectedCol = c;
        else if (s === 'Correct') nCorrectCol = c;
        else if (s === 'FunctionString') {
          nFunctStringCol = c;
          break;
        }
      }
      if (!nExpectedCol || !nCorrectCol) continue;
      const maxRow = doc.GetLastDataRow(nTab, nCorrectCol, nCorrectCol, doc.MaxRow());
      for (let row = 1; row <= maxRow; ++row) {
        if (!doc.HasData(nCorrectCol, row, nTab)) continue;
        const v = doc.GetValue(nCorrectCol, row, nTab);
        if (Math.abs(v - 1) < 1e-14) continue;
        const res: string[] = [], exp: string[] = [];
        for (let o = 0; o < nExpectedCol; o++) {
          res.push(doc.GetString(o, row, nTab));
          exp.push(doc.GetString(nExpectedCol + o, row, nTab));
        }
        const aPos = new ScAddress(0, row, nTab);
        out.push(`${doc.GetName(nTab)}.A${row + 1} '${doc.GetFormula(aPos) || doc.GetString(nFunctStringCol, row, nTab)}' result: '${res.join(', ')}', expected: '${exp.join(', ')}'`);
      }
    }
    return out;
  } finally {
    SetGlobalConfig({ meStringRefAddressSyntax: FormulaGrammar.CONV_UNSPECIFIED });
  }
}
