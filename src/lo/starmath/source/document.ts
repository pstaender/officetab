// SPDX-License-Identifier: MPL-2.0
// @upstream starmath/source/document.cxx reduced
// @upstream starmath/source/unomodel.cxx reduced
// SmDocShell: a formula's text, its node tree and format, its size and baseline (the model's
// "BaseLine" property) and drawing. The formula is arranged on the layout's text measurer in
// twips. Not ported: the edit engine, undo, printing settings, the symbol manager and the UNO
// model besides BaseFontHeight and BaseLine.
import type { TextMeasurer } from '../../vcl/source/outdev/text.ts';
import { DIS_BOTTOMSPACE, DIS_LEFTSPACE, DIS_RIGHTSPACE, DIS_TOPSPACE, SmDevice, SmFormat } from './format.ts';
import type { SmTableNode } from './node.ts';
import { SmParser5 } from './parse5.ts';
import { SmDrawingVisitor, type SmCanvas } from './visitors.ts';

export class SmDocShell {
  maText: string;
  maFormat = new SmFormat();
  mpTree: SmTableNode | null = null;
  mbFormulaArranged = false;
  mbHasErrors = false;
  private arrangedWith: TextMeasurer | null = null;

  /** @param nBaseFontHeight BaseFontHeight in twips (12 pt by default) */
  constructor(rText = '', nBaseFontHeight?: number) {
    this.maText = rText;
    if (nBaseFontHeight) this.maFormat.SetBaseSize(nBaseFontHeight);
    // SmModule's configured format for new formulas: Greek lowercase italic, uppercase upright.
    this.maFormat.nGreekCharStyle = 2;
  }

  GetText(): string { return this.maText; }
  GetFormat(): SmFormat { return this.maFormat; }
  GetFormulaTree(): SmTableNode | null { return this.mpTree; }

  SetText(rBuffer: string): void {
    if (rBuffer === this.maText) return;
    this.maText = rBuffer;
    this.mpTree = null;
    this.mbFormulaArranged = false;
  }

  Parse(): void {
    const aParser = new SmParser5();
    try {
      this.mpTree = aParser.Parse(this.maText);
      this.mbHasErrors = !!aParser.GetError();
    } catch {
      // the depth limit: an empty formula
      this.mpTree = aParser.Parse('');
      this.mbHasErrors = true;
    }
    this.mbFormulaArranged = false;
  }

  ArrangeFormula(m: TextMeasurer): void {
    if (this.mbFormulaArranged && this.arrangedWith === m) return;
    if (!this.mpTree) this.Parse();
    const rFormat = this.GetFormat();
    this.mpTree!.Prepare(rFormat, 0);
    this.mpTree!.Arrange(new SmDevice(m), rFormat);
    this.mbFormulaArranged = true;
    this.arrangedWith = m;
  }

  /** GetSize: the formula's size in twips, with the format's border spaces. */
  GetSize(m: TextMeasurer): { width: number; height: number } {
    this.ArrangeFormula(m);
    const aRet = { ...this.mpTree!.GetSize() };
    if (!aRet.width || aRet.width === 1) aRet.width = 2000;
    else aRet.width += this.maFormat.GetDistance(DIS_LEFTSPACE) + this.maFormat.GetDistance(DIS_RIGHTSPACE);
    if (!aRet.height) aRet.height = 1000;
    else aRet.height += this.maFormat.GetDistance(DIS_TOPSPACE) + this.maFormat.GetDistance(DIS_BOTTOMSPACE);
    return aRet;
  }

  /** SmModel's "BaseLine": the formula's baseline below its top, in twips. */
  GetBaseline(m: TextMeasurer): number {
    this.ArrangeFormula(m);
    return this.mpTree!.GetFormulaBaseline() - this.mpTree!.GetTop() + this.maFormat.GetDistance(DIS_TOPSPACE);
  }

  /** DrawFormula: draws the formula with its top left corner at (x, y). */
  DrawFormula(rDev: SmCanvas, m: TextMeasurer, x: number, y: number, autoColor?: string): void {
    this.ArrangeFormula(m);
    const rPosition = { x: x + this.maFormat.GetDistance(DIS_LEFTSPACE), y: y + this.maFormat.GetDistance(DIS_TOPSPACE) };
    new SmDrawingVisitor(rDev, rPosition, this.mpTree!, this.maFormat, autoColor);
  }
}

const cache = new WeakMap<TextMeasurer, Map<string, SmDocShell>>();

/** The arranged formula of a text and base font height, shared by layout and painting. */
export function GetFormula(m: TextMeasurer, rText: string, nBaseFontHeight = 0): SmDocShell {
  let byText = cache.get(m);
  if (!byText) cache.set(m, (byText = new Map()));
  const key = `${nBaseFontHeight}\u0000${rText}`;
  let doc = byText.get(key);
  if (!doc) {
    if (byText.size > 500) byText.clear();
    doc = new SmDocShell(rText, nBaseFontHeight || undefined);
    byText.set(key, doc);
  }
  return doc;
}
