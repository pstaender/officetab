// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/reffind.hxx reduced
// @upstream sc/source/core/tool/reffind.cxx reduced
// ScRefFinder::ToggleRel (F4 while editing a formula): the references in the selection (or the
// one at the caret) cycle through $A$1, A$1, $A1 and A1. Reduced: the caret's reference is found
// with a regular expression instead of FindStartPos/FindEndPos, in Calc A1 syntax only, without
// external references.
import { ScAddress, ScAddressDetails, ScRefFlags } from '../../../inc/address.ts';
import { FormulaGrammar } from '../../../../include/formula/grammar.ts';
import type { ScDocument } from '../data/document.ts';

function lcl_NextFlags(nOld: ScRefFlags): ScRefFlags {
  const Mask_ABS = ScRefFlags.COL_ABS | ScRefFlags.ROW_ABS | ScRefFlags.TAB_ABS;
  let nNew = nOld & Mask_ABS;
  nNew = (nNew - 1) & Mask_ABS; // weiterzaehlen

  if (!(nOld & ScRefFlags.TAB_3D)) nNew &= ~ScRefFlags.TAB_ABS; // not 3D -> never absolute!

  return (nOld & ~Mask_ABS) | nNew;
}

/** The single references (each part of a range) touching [nStart, nEnd] of the formula, toggled. */
export function ToggleRel(rFormula: string, nStartPos: number, nEndPos: number, rDoc: ScDocument, aPos: ScAddress): { text: string; nSelStart: number; nSelEnd: number } | null {
  if (nEndPos < nStartPos) [nStartPos, nEndPos] = [nEndPos, nStartPos];
  const re = /(?:(?:\$?'[^']*'|\$?[A-Za-z_][\w]*)\.)?\$?[A-Za-z]{1,3}\$?\d+/g;
  let out = '';
  let last = 0;
  let mnFound = 0;
  let nSelStart = -1, nSelEnd = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rFormula))) {
    const a = m.index, b = a + m[0].length;
    // ExpandToText: the selection takes the references it touches
    if (b < nStartPos || a > nEndPos) continue;
    if (a > 0 && /[\w$"]/.test(rFormula[a - 1]!)) continue;
    if (b < rFormula.length && /[\w("]/.test(rFormula[b]!)) continue;
    const aAddr = new ScAddress();
    const aDetails = ScAddressDetails(FormulaGrammar.CONV_OOO, aPos.Row(), aPos.Col());
    const nResult = aAddr.Parse(m[0], rDoc, aDetails);
    if (!(nResult & ScRefFlags.VALID)) continue;
    const aExpr = aAddr.Format(lcl_NextFlags(nResult), rDoc, aDetails);
    out += rFormula.slice(last, a);
    if (!mnFound) nSelStart = out.length; // first reference ?
    out += aExpr;
    nSelEnd = out.length;
    last = b;
    mnFound++;
  }
  if (!mnFound) return null;
  out += rFormula.slice(last);
  return { text: out, nSelStart, nSelEnd };
}
