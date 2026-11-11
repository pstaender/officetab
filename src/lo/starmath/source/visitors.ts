// SPDX-License-Identifier: MPL-2.0
// @upstream starmath/source/visitors.cxx partial
// @upstream starmath/inc/visitors.hxx partial
// SmDrawingVisitor: paints an arranged node tree on a canvas (twips, the font sized in twips).
// Text is drawn stretched to its node's width (DrawStretchText). Only the drawing visitor is
// ported; the caret, selection and text visitors of the visual editor are not.
import { cssFont } from '../../vcl/source/outdev/text.ts';
import type { SmFormat } from './format.ts';
import {
  SmNodeType, type SmNode, type SmPolyLineNode, type SmRectangleNode, type SmRootSymbolNode, type SmStructureNode,
  type SmTextNode,
} from './node.ts';

/** The part of a canvas context the formula is drawn with. */
export type SmCanvas = Pick<CanvasRenderingContext2D, 'save' | 'restore' | 'translate' | 'scale' | 'fillText' | 'fillRect' | 'measureText' | 'beginPath' | 'moveTo' | 'lineTo' | 'stroke'> & {
  font: string; fillStyle: string | CanvasGradient | CanvasPattern; strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number; lineCap: CanvasLineCap; textBaseline: CanvasTextBaseline; textAlign: CanvasTextAlign;
};

export class SmDrawingVisitor {
  mrDev: SmCanvas;
  maPosition: { x: number; y: number };
  mrFormat: SmFormat;
  /** COL_AUTO: the colour automatic text is drawn with. */
  maAutoColor: string;

  /**
   * @param rDev Device to draw on
   * @param position Offset on device to draw the formula
   * @param pTree Formula tree to draw
   */
  constructor(rDev: SmCanvas, position: { x: number; y: number }, pTree: SmNode, rFormat: SmFormat, autoColor = '#000000') {
    this.mrDev = rDev;
    this.maPosition = { ...position };
    this.mrFormat = rFormat;
    this.maAutoColor = autoColor;
    this.Visit(pTree);
  }

  private color(c: string | null): string { return c ?? this.maAutoColor; }

  Visit(pNode: SmNode): void {
    switch (pNode.GetType()) {
      case SmNodeType.Text: case SmNodeType.Special: case SmNodeType.GlyphSpecial: case SmNodeType.Math:
      case SmNodeType.MathIdent: case SmNodeType.Place: case SmNodeType.Error:
        this.DrawSpecialNode(pNode as SmTextNode);
        break;
      case SmNodeType.Blank: break;
      case SmNodeType.RootSymbol: this.VisitRootSymbol(pNode as SmRootSymbolNode); break;
      case SmNodeType.PolyLine: this.VisitPolyLine(pNode as SmPolyLineNode); break;
      case SmNodeType.Rectangle: this.VisitRectangle(pNode as SmRectangleNode); break;
      default: this.DrawChildren(pNode as SmStructureNode);
    }
  }

  VisitRootSymbol(pNode: SmRootSymbolNode): void {
    if (pNode.IsPhantom()) return;
    // draw root-sign itself
    this.DrawSpecialNode(pNode);
    this.mrDev.fillStyle = this.color(pNode.GetFont().color);
    // since the width is always unscaled it corresponds to the _original_
    // _unscaled_ font height to be used, we use that to calculate the
    // bar height. Thus it is independent of the arguments height.
    // ( see display of sqrt QQQ versus sqrt stack{Q#Q#Q#Q} )
    const nBarHeight = Math.trunc((pNode.GetWidth() * 7) / 100);
    const nBarWidth = pNode.GetBodyWidth() + pNode.GetBorderWidth();
    const aBarPos = { x: this.maPosition.x + pNode.GetWidth(), y: this.maPosition.y + pNode.GetBorderWidth() };
    this.mrDev.fillRect(aBarPos.x, aBarPos.y, nBarWidth, nBarHeight);
  }

  VisitPolyLine(pNode: SmPolyLineNode): void {
    if (pNode.IsPhantom()) return;
    const nBorderwidth = pNode.GetFont().GetBorderWidth();
    const aPoly = pNode.GetPolygon();
    const nLeft = Math.min(aPoly[0]!.x, aPoly[1]!.x), nTop = Math.min(aPoly[0]!.y, aPoly[1]!.y);
    const aPos = { x: this.maPosition.x - nLeft + nBorderwidth, y: this.maPosition.y - nTop + nBorderwidth };
    const d = this.mrDev;
    d.strokeStyle = this.color(pNode.GetFont().color);
    d.lineWidth = Math.max(1, pNode.GetLineWidth() - 2 * nBorderwidth);
    d.lineCap = 'butt';
    d.beginPath();
    d.moveTo(aPos.x + aPoly[0]!.x, aPos.y + aPoly[0]!.y);
    d.lineTo(aPos.x + aPoly[1]!.x, aPos.y + aPoly[1]!.y);
    d.stroke();
  }

  VisitRectangle(pNode: SmRectangleNode): void {
    if (pNode.IsPhantom()) return;
    this.mrDev.fillStyle = this.color(pNode.GetFont().color);
    const nTmpBorderWidth = pNode.GetFont().GetBorderWidth();
    // get rectangle and remove borderspace
    const r = pNode.AsRectangle();
    const x = r.x + this.maPosition.x - pNode.GetLeft(), y = r.y + this.maPosition.y - pNode.GetTop();
    const w = r.width - 2 * nTmpBorderWidth, h = r.height - 2 * nTmpBorderWidth;
    if (w > 0 && h > 0) this.mrDev.fillRect(x + nTmpBorderWidth, y + nTmpBorderWidth, w, h);
  }

  DrawTextNode(pNode: SmTextNode): void {
    const rText = pNode.GetText();
    if (pNode.IsPhantom() || !rText || rText[0] === '\0') return;
    const f = pNode.GetFont();
    const d = this.mrDev;
    d.font = cssFont({ family: f.name, size: f.height, bold: f.bold, italic: f.italic });
    d.fillStyle = this.color(f.color);
    d.textBaseline = 'alphabetic';
    d.textAlign = 'left';
    const x = this.maPosition.x, y = this.maPosition.y + pNode.GetBaselineOffset();
    // DrawStretchText: the text fills the node's width
    const nNatural = d.measureText(rText).width;
    const sx = nNatural > 0 ? pNode.GetWidth() / nNatural : 1;
    if (Math.abs(sx - 1) < 0.001) { d.fillText(rText, x, y); return; }
    d.save();
    d.translate(x, y);
    d.scale(sx, 1);
    d.fillText(rText, 0, 0);
    d.restore();
  }

  DrawSpecialNode(pNode: SmTextNode): void {
    this.DrawTextNode(pNode);
  }

  DrawChildren(pNode: SmStructureNode): void {
    if (pNode.IsPhantom()) return;
    const rPosition = this.maPosition;
    for (let i = 0; i < pNode.GetNumSubNodes(); i++) {
      const pChild = pNode.GetSubNode(i);
      if (!pChild) continue;
      this.maPosition = { x: rPosition.x + pChild.GetLeft() - pNode.GetLeft(), y: rPosition.y + pChild.GetTop() - pNode.GetTop() };
      this.Visit(pChild);
    }
    this.maPosition = rPosition;
  }
}
