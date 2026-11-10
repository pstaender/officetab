// SPDX-License-Identifier: MPL-2.0
// @upstream basegfx/source/tools/gradienttools.cxx reduced
// @upstream basegfx/source/tools/bgradient.cxx reduced
// @upstream drawinglayer/source/texture/texture.cxx reduced
// BGradient with its colour stops, the texture transforms of the ODF gradient styles
// (init1DGradientInfo, initEllipticalGradientInfo, initRectGradientInfo) and the decomposition into
// solid steps that GeoTexSvxGradient*::appendTransformationsAndColors makes: from the outside in,
// each step a smaller area in its colour. The steps of ellipsoid and rectangular gradients shrink
// uniformly (upstream corrects them by the aspect ratio so that they keep equal distances).
import type { B2DPolygon } from '../../../svx/source/customshapes/EnhancedCustomShape2d.ts';

/** css::awt::GradientStyle */
export type GradientStyle = 'linear' | 'axial' | 'radial' | 'ellipsoid' | 'square' | 'rectangular';

/** BColorStop: a colour at an offset between 0 (start) and 1 (end). */
export interface BColorStop { fStopOffset: number; aStopColor: string }

/** basegfx::BGradient */
export interface BGradient {
  eStyle: GradientStyle;
  aColorStops: BColorStop[];
  /** Degree10, counterclockwise. */
  nAngle: number;
  /** Percent of the area in the start colour. */
  nBorder: number;
  /** The centre of radial, ellipsoid, square and rectangular gradients, percent of the size. */
  nOffsetX: number;
  nOffsetY: number;
  nIntensStart: number;
  nIntensEnd: number;
  /** 0: as many as the colours need. */
  nStepCount: number;
}

const rgb = (c: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : [0, 0, 0];
};
const hex = (c: [number, number, number]) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;

/** BColorStops::getInterpolatedBColor, with the start and end intensities applied. */
export function getInterpolatedBColor(g: BGradient, fScaler: number): string {
  const s = [...g.aColorStops].sort((a, b) => a.fStopOffset - b.fStopOffset);
  if (!s.length) return '#000000';
  let c: [number, number, number];
  if (fScaler <= s[0]!.fStopOffset) c = rgb(s[0]!.aStopColor);
  else if (fScaler >= s[s.length - 1]!.fStopOffset) c = rgb(s[s.length - 1]!.aStopColor);
  else {
    let k = 0;
    while (s[k + 1]!.fStopOffset < fScaler) k++;
    const a = s[k]!, b = s[k + 1]!;
    const f = b.fStopOffset === a.fStopOffset ? 0 : (fScaler - a.fStopOffset) / (b.fStopOffset - a.fStopOffset);
    const ca = rgb(a.aStopColor), cb = rgb(b.aStopColor);
    c = [0, 1, 2].map((i) => ca[i]! + (cb[i]! - ca[i]!) * f) as [number, number, number];
  }
  // BGradient::tryToApplyStartEndIntensity
  const intens = (g.nIntensStart + (g.nIntensEnd - g.nIntensStart) * fScaler) / 100;
  return hex(c.map((v) => v * intens) as [number, number, number]);
}

/** calculateNumberOfSteps: the colour distance decides when the gradient does not say. */
function calculateNumberOfSteps(g: BGradient): number {
  if (g.nStepCount > 0) return Math.max(2, g.nStepCount);
  let fMax = 0;
  const s = g.aColorStops;
  for (let k = 1; k < s.length; k++) {
    const a = rgb(s[k - 1]!.aStopColor), b = rgb(s[k]!.aStopColor);
    fMax += Math.max(...[0, 1, 2].map((i) => Math.abs(a[i]! - b[i]!)));
  }
  if (g.nIntensStart !== g.nIntensEnd) fMax = Math.max(fMax, 2.55 * Math.abs(g.nIntensStart - g.nIntensEnd));
  return Math.min(128, Math.max(2, Math.round(fMax)));
}

type Mat = [number, number, number, number, number, number]; // a b c d e f: x' = a x + c y + e
const apply = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const mul = (m: Mat, n: Mat): Mat => [ // n after m
  n[0] * m[0] + n[2] * m[1], n[1] * m[0] + n[3] * m[1],
  n[0] * m[2] + n[2] * m[3], n[1] * m[2] + n[3] * m[3],
  n[0] * m[4] + n[2] * m[5] + n[4], n[1] * m[4] + n[3] * m[5] + n[5],
];
const scale = (x: number, y: number): Mat => [x, 0, 0, y, 0, 0];
const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
/** createRotateAroundPoint */
const rotateAround = (cx: number, cy: number, a: number): Mat => {
  const c = Math.cos(a), s = Math.sin(a);
  return mul(mul(translate(-cx, -cy), [c, s, -s, c, 0, 0]), translate(cx, cy));
};

/** The ODFGradientInfo texture transform of a gradient in a w × h area at the origin. */
function textureTransform(g: BGradient, w: number, h: number): Mat {
  const fAngle = -((g.nAngle / 10) * Math.PI) / 180;
  const fBorder = Math.min(1, Math.max(0, g.nBorder / 100));
  let sx = w, sy = h, ox = 0, oy = 0;
  let m: Mat = [1, 0, 0, 1, 0, 0];
  const expandForAngle = () => {
    const c = Math.abs(Math.cos(fAngle)), s = Math.abs(Math.sin(fAngle));
    const nx = sx * c + sy * s, ny = sy * c + sx * s;
    ox -= (nx - sx) / 2; oy -= (ny - sy) / 2; sx = nx; sy = ny;
  };
  const offsets = () => {
    ox += (g.nOffsetX / 100 - 0.5) * w;
    oy += (g.nOffsetY / 100 - 0.5) * h;
  };
  if (g.eStyle === 'linear' || g.eStyle === 'axial') {
    // init1DGradientInfo
    if (fAngle) expandForAngle();
    const fSizeWithoutBorder = 1 - fBorder;
    if (g.eStyle === 'axial') m = mul(mul(m, scale(1, fSizeWithoutBorder * 0.5)), translate(0, 0.5));
    else if (fSizeWithoutBorder !== 1) m = mul(mul(m, scale(1, fSizeWithoutBorder)), translate(0, fBorder));
    m = mul(m, scale(sx, sy));
    if (fAngle) m = mul(m, rotateAround(sx / 2, sy / 2, fAngle));
  } else if (g.eStyle === 'radial' || g.eStyle === 'ellipsoid') {
    // initEllipticalGradientInfo
    const bCircular = g.eStyle === 'radial';
    if (bCircular) {
      const d = Math.hypot(sx, sy);
      ox -= (d - sx) / 2; oy -= (d - sy) / 2; sx = sy = d;
    } else {
      ox -= ((Math.SQRT2 - 1) / 2) * sx; oy -= ((Math.SQRT2 - 1) / 2) * sy;
      sx *= Math.SQRT2; sy *= Math.SQRT2;
    }
    const fHalfBorder = (1 - fBorder) * 0.5;
    m = mul(mul(mul(m, scale(fHalfBorder, fHalfBorder)), translate(0.5, 0.5)), scale(sx, sy));
    if (!bCircular && fAngle) m = mul(m, rotateAround(sx / 2, sy / 2, fAngle));
    offsets();
  } else {
    // initRectGradientInfo
    if (g.eStyle === 'square') {
      const q = Math.max(sx, sy);
      ox -= (q - sx) / 2; oy -= (q - sy) / 2; sx = sy = q;
    }
    if (fAngle) expandForAngle();
    const fHalfBorder = (1 - fBorder) * 0.5;
    m = mul(mul(mul(m, scale(fHalfBorder, fHalfBorder)), translate(0.5, 0.5)), scale(sx, sy));
    if (fAngle) m = mul(m, rotateAround(sx / 2, sy / 2, fAngle));
    offsets();
  }
  return mul(m, translate(ox, oy));
}

/** The unit circle as four Bézier quarters. */
function unitCircle(r: number): [number, number, [number, number], [number, number]][] {
  const k = 0.5522847498 * r;
  // Each point with its incoming and outgoing control point, going round from (r, 0) to (0, r).
  return [[r, 0, [r, -k], [r, k]], [0, r, [k, r], [-k, r]], [-r, 0, [-r, k], [-r, -k]], [0, -r, [-k, -r], [k, -r]]];
}

/** One solid step: its area in the w × h area's coordinates, and its colour. */
export interface GradientStep { poly: B2DPolygon; color: string }

/**
 * The steps of a gradient over a w × h area, the outermost (the whole area, in the start
 * colour) first; painting them in order clipped to the shape gives the gradient.
 */
export function createGradientSteps(g: BGradient, w: number, h: number): GradientStep[] {
  const m = textureTransform(g, w, h);
  const n = calculateNumberOfSteps(g);
  const rect = (x0: number, y0: number, x1: number, y1: number): B2DPolygon => ({ pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => { const [px, py] = apply(m, x!, y!); return { x: px, y: py }; }), closed: true });
  const whole: B2DPolygon = { pts: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], closed: true };
  const steps: GradientStep[] = [{ poly: whole, color: getInterpolatedBColor(g, 0) }];
  for (let k = 1; k < n; k++) {
    const t = k / n, color = getInterpolatedBColor(g, k / (n - 1));
    let poly: B2DPolygon;
    switch (g.eStyle) {
      case 'linear': {
        // Everything below t, to beyond the target range (the end colour continues).
        poly = rect(-1, t, 2, 2);
        break;
      }
      case 'axial': poly = rect(-1, -(1 - t), 2, 1 - t); break;
      case 'radial': case 'ellipsoid': {
        const r = 1 - t;
        const q = unitCircle(r);
        poly = { pts: q.map(([x, y, prev, next]) => { const [px, py] = apply(m, x, y); return { x: px, y: py, prev: apply(m, ...prev), next: apply(m, ...next) }; }), closed: true };
        break;
      }
      default: { const r = 1 - t; poly = rect(-r, -r, r, r); }
    }
    steps.push({ poly, color });
  }
  return steps;
}
