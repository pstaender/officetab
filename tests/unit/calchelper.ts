// Helpers for the Calc tests: not a port.
import { ScAddress, ScRefFlags } from '../../src/lo/sc/inc/address.ts';
import { ScDocument } from '../../src/lo/sc/source/core/data/document.ts';
import { InsertDeleteFlags } from '../../src/lo/sc/inc/global.ts';

/** A document with the given sheets ("Sheet1", "Sheet2", ...). */
export function newDoc(nTabs = 1): ScDocument {
  const doc = new ScDocument();
  for (let i = 0; i < nTabs; i++) doc.MakeTable(i);
  return doc;
}

/** The address of "A1" or "Sheet2.B3" ("$Sheet2.B3" also works). */
export function addr(doc: ScDocument, ref: string): ScAddress {
  const a = new ScAddress(0, 0, 0);
  const f = a.Parse(ref, doc);
  if (!(f & ScRefFlags.VALID)) throw new Error(`bad address ${ref}`);
  return a;
}

/** Enter a number, or a string as the user would type it ("=SUM(A1:A3)", "12%", "'01"). */
export function put(doc: ScDocument, ref: string, input: string | number): void {
  const a = addr(doc, ref);
  if (typeof input === 'number') doc.SetValue(a, input);
  else doc.SetString(a, input);
}

/** Put several cells at once: { A1: 1, A2: '=A1*2' }. */
export function putAll(doc: ScDocument, cells: Record<string, string | number>): void {
  for (const [k, v] of Object.entries(cells)) put(doc, k, v);
}

/** The displayed string of a cell. */
export function str(doc: ScDocument, ref: string): string { return doc.GetString(addr(doc, ref)); }
/** The numeric value of a cell. */
export function val(doc: ScDocument, ref: string): number { return doc.GetValue(addr(doc, ref)); }
/** The formula of a cell ("=SUM(A1:A3)"). */
export function formula(doc: ScDocument, ref: string): string { return doc.GetFormula(addr(doc, ref)); }

/** Evaluate a formula in a scratch cell (default Sheet1.Z1000) and return the displayed result. */
export function calc(doc: ScDocument, f: string, at = 'Z1000'): string {
  clear(doc, at);
  put(doc, at, f.startsWith('=') ? f : '=' + f);
  return str(doc, at);
}

/** Evaluate a formula and return the numeric value of the result. */
export function calcValue(doc: ScDocument, f: string, at = 'Z1000'): number {
  clear(doc, at);
  put(doc, at, f.startsWith('=') ? f : '=' + f);
  return val(doc, at);
}

/** Delete a cell's content and attributes (the number format a formula result set). */
export function clear(doc: ScDocument, ref: string): void {
  const a = addr(doc, ref);
  doc.DeleteAreaTab(a.Col(), a.Row(), a.Col(), a.Row(), a.Tab(), InsertDeleteFlags.ALL);
}
