// SPDX-License-Identifier: MPL-2.0
// @upstream drawinglayer/source/primitive2d/graphicprimitivehelper2d.cxx partial
// @upstream drawinglayer/source/primitive2d/graphicprimitive2d.cxx reduced
// @upstream include/vcl/GraphicAttributes.hxx reduced
// create2DColorModifierEmbeddingsAsNeeded, as the modifier stack the nested
// ModifiedColorPrimitive2Ds decompose to (the outermost pushed first), and the conversion of a
// graphic's attributes to its arguments (GraphicPrimitive2D, percent to fractions).
import {
  BColorModifierStack, BColorModifier_RGBLuminanceContrast, BColorModifier_black_and_white, BColorModifier_gamma,
  BColorModifier_gray, BColorModifier_invert, type BColorModifier,
} from '../../../basegfx/source/color/bcolormodifier.ts';

/** GraphicDrawMode (the Image Mode). */
export const GraphicDrawMode = { Standard: 0, Greys: 1, Mono: 2, Watermark: 3 } as const;
export type GraphicDrawMode = (typeof GraphicDrawMode)[keyof typeof GraphicDrawMode];
/**
 * GraphicAttr's colour members: luminance, contrast and channels in percent (-100 to 100), gamma
 * (0.1 to 10), invert, transparency in percent (upstream 0 to 255) and the draw mode. A missing
 * member has its default. (Mirroring, rotation and cropping are attributes of their own here.)
 */
export interface GraphicAttr {
  m_nLuminance?: number; m_nContrast?: number; m_nChannelR?: number; m_nChannelG?: number; m_nChannelB?: number;
  m_fGamma?: number; m_bInvert?: boolean; m_nTransparency?: number; m_eDrawMode?: GraphicDrawMode;
}

const equalZero = (v: number) => Math.abs(v) <= 1e-9;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function create2DColorModifierEmbeddingsAsNeeded(
  aGraphicDrawMode: GraphicDrawMode, fLuminance: number, fContrast: number, fRed: number, fGreen: number, fBlue: number, fGamma: number, bInvert: boolean,
): BColorModifierStack {
  // The embeddings from the inside out.
  const inner: BColorModifier[] = [];
  if (GraphicDrawMode.Watermark === aGraphicDrawMode) {
    // this is solved by applying fixed values additionally to luminance
    // and contrast, do it here and reset DrawMode to GraphicDrawMode::Standard
    fLuminance = clamp(fLuminance + 0.5, -1.0, 1.0);
    fContrast = clamp(fContrast - 0.7, -1.0, 1.0);
    aGraphicDrawMode = GraphicDrawMode.Standard;
  }
  // DrawMode (GraphicDrawMode::Watermark already handled)
  switch (aGraphicDrawMode) {
    case GraphicDrawMode.Greys: inner.push(new BColorModifier_gray()); break; // convert to grey
    case GraphicDrawMode.Mono: inner.push(new BColorModifier_black_and_white(0.5)); break; // convert to mono (black/white with threshold 0.5)
    default: break; // nothing to do
  }
  // mnContPercent, mnLumPercent, mnRPercent, mnGPercent, mnBPercent handled in a single call
  if (!equalZero(fLuminance) || !equalZero(fContrast) || !equalZero(fRed) || !equalZero(fGreen) || !equalZero(fBlue)) {
    inner.push(new BColorModifier_RGBLuminanceContrast(fRed, fGreen, fBlue, fLuminance, fContrast));
  }
  // gamma (boolean)
  if (Math.abs(fGamma - 1.0) > 1e-9) inner.push(new BColorModifier_gamma(fGamma));
  // invert (boolean)
  if (bInvert) inner.push(new BColorModifier_invert());
  // Decomposing pushes the outermost modifier first.
  const stack = new BColorModifierStack();
  for (let i = inner.length - 1; i >= 0; i--) stack.push(inner[i]!);
  return stack;
}

/** GraphicPrimitive2D's colour embeddings for a graphic's attributes (GraphicAttr's percentages). */
export const GraphicModifierStack = (a: GraphicAttr | undefined): BColorModifierStack => create2DColorModifierEmbeddingsAsNeeded(
  a?.m_eDrawMode ?? GraphicDrawMode.Standard, (a?.m_nLuminance ?? 0) * 0.01, (a?.m_nContrast ?? 0) * 0.01,
  (a?.m_nChannelR ?? 0) * 0.01, (a?.m_nChannelG ?? 0) * 0.01, (a?.m_nChannelB ?? 0) * 0.01, a?.m_fGamma ?? 1, !!a?.m_bInvert,
);

/** The key of the colour attributes, for caching modified bitmaps ('' when the colours are unchanged). */
export function GraphicModifierKey(a: GraphicAttr | undefined): string {
  if (!a) return '';
  const k = [a.m_eDrawMode ?? 0, a.m_nLuminance ?? 0, a.m_nContrast ?? 0, a.m_nChannelR ?? 0, a.m_nChannelG ?? 0, a.m_nChannelB ?? 0, a.m_fGamma ?? 1, a.m_bInvert ? 1 : 0].join(',');
  return k === '0,0,0,0,0,0,1,0' ? '' : k;
}
