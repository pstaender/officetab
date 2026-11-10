// SPDX-License-Identifier: MPL-2.0
// @upstream svx/source/customshapes/EnhancedCustomShape2d.cxx reduced
// @upstream basegfx/source/polygon/b2dpolygontools.cxx partial
// The geometry of a custom shape: equations, adjustment values, path coordinates and segments are
// evaluated for the shape's size into polygons with Bézier segments. Instead of SdrPathObjs,
// CreatePathObj returns plain sub-paths with their fill, stroke and brightness. Handles (the
// interactive adjustment points), glue points, 3D extrusion, Fontwork and the binary import's
// angle conventions for command U/T are not ported; callout arrow correction is not ported.
import { parseFunction, ParseError, type CustomShapeContext, type ExpressionFunct, type ExpressionNode } from './EnhancedCustomShapeFunctionParser.ts';

/** css::drawing::EnhancedCustomShapeParameterType */
export const EnhancedCustomShapeParameterType = {
  NORMAL: 0, EQUATION: 1, ADJUSTMENT: 2, LEFT: 3, TOP: 4, RIGHT: 5, BOTTOM: 6, XSTRETCH: 7, YSTRETCH: 8,
  HASSTROKE: 9, HASFILL: 10, WIDTH: 11, HEIGHT: 12, LOGWIDTH: 13, LOGHEIGHT: 14,
} as const;
/** css::drawing::EnhancedCustomShapeSegmentCommand */
export const EnhancedCustomShapeSegmentCommand = {
  UNKNOWN: 0, MOVETO: 1, LINETO: 2, CURVETO: 3, CLOSESUBPATH: 4, ENDSUBPATH: 5, NOFILL: 6, NOSTROKE: 7,
  ANGLEELLIPSETO: 8, ANGLEELLIPSE: 9, ARCTO: 10, ARC: 11, CLOCKWISEARCTO: 12, CLOCKWISEARC: 13,
  ELLIPTICALQUADRANTX: 14, ELLIPTICALQUADRANTY: 15, QUADRATICCURVETO: 16, ARCANGLETO: 17,
  DARKEN: 18, DARKENLESS: 19, LIGHTEN: 20, LIGHTENLESS: 21,
} as const;
const C = EnhancedCustomShapeSegmentCommand;

/** EnhancedCustomShapeParameter: a plain number is NORMAL, otherwise [Type, Value]. */
export type EnhancedCustomShapeParameter = number | [number, number];
export type EnhancedCustomShapeParameterPair = [EnhancedCustomShapeParameter, EnhancedCustomShapeParameter];

/** The SdrCustomShapeGeometryItem properties the geometry needs ("Path" flattened). */
export interface CustomShapeGeometry {
  viewBox: [number, number, number, number];
  adjust?: number[];
  /** OOXML presets: the guide names of the adjustment values (adj, adj1, hf, ...). */
  adjustNames?: string[];
  equations?: string[];
  coords: EnhancedCustomShapeParameterPair[];
  /** [Command, Count] */
  segments?: [number, number][];
  textFrames?: [EnhancedCustomShapeParameterPair, EnhancedCustomShapeParameterPair][];
  subViewSize?: [number, number][];
  stretchX?: number;
  stretchY?: number;
  /** SortFilledObjectsToBackByDefault for the shape's MSO type (true when absent). */
  sortFilledToBack?: boolean;
}

/** A B2DPolygon point with the Bézier control points of its incoming and outgoing segment. */
export interface B2DPoint { x: number; y: number; prev?: [number, number]; next?: [number, number] }
export interface B2DPolygon { pts: B2DPoint[]; closed: boolean }
/** One of the SdrPathObjs CreateSubPath makes. */
export interface SdrPathObj { polys: B2DPolygon[]; fill: boolean; stroke: boolean; brightness: number }

const DEFAULT_MINIMUM_SIGNED_COMPARE = -0x80000000;
const STEPSPERQUARTER = 3;

function impDistanceBezierPointToControl(fAngle: number): number {
  return fAngle >= 0 && fAngle <= Math.PI / 2 ? (4 / 3) * Math.tan(fAngle / 4) : 0;
}

const append = (p: B2DPolygon, x: number, y: number) => { p.pts.push({ x, y }); };
const appendBezierSegment = (p: B2DPolygon, c1: [number, number], c2: [number, number], x: number, y: number) => {
  const last = p.pts[p.pts.length - 1];
  if (last) last.next = c1;
  p.pts.push({ x, y, prev: c2 });
};
/** B2DPolygon::append(B2DPolygon) */
const appendPoly = (p: B2DPolygon, q: B2DPolygon) => { for (const pt of q.pts) p.pts.push({ ...pt }); };
/** B2DPolygon::flip: reverses the order, swapping the control points. */
const flip = (p: B2DPolygon) => { p.pts = p.pts.reverse().map((pt) => ({ x: pt.x, y: pt.y, ...(pt.next ? { prev: pt.next } : {}), ...(pt.prev ? { next: pt.prev } : {}) })); };
const removeDoublePoints = (p: B2DPolygon) => {
  const out: B2DPoint[] = [];
  for (const pt of p.pts) {
    const last = out[out.length - 1];
    if (last && last.x === pt.x && last.y === pt.y) { if (pt.next) last.next = pt.next; else delete last.next; continue; }
    out.push(pt);
  }
  p.pts = out;
};
const transform = (p: B2DPolygon, sx: number, sy: number, tx: number, ty: number) => {
  const f = (x: number, y: number): [number, number] => [x * sx + tx, y * sy + ty];
  for (const pt of p.pts) {
    [pt.x, pt.y] = f(pt.x, pt.y);
    if (pt.prev) pt.prev = f(...pt.prev);
    if (pt.next) pt.next = f(...pt.next);
  }
};
/** basegfx::utils::checkClosed */
function checkClosed(p: B2DPolygon): void {
  const a = p.pts[0], b = p.pts[p.pts.length - 1];
  if (p.pts.length > 1 && a && b && a.x === b.x && a.y === b.y) {
    // closeWithGeometryChange: the last point merges into the first.
    if (b.prev) a.prev = b.prev;
    p.pts.pop();
    p.closed = true;
  }
}

/** basegfx::utils::createPolygonFromUnitEllipseSegment */
function createPolygonFromUnitEllipseSegment(fStart: number, fEnd: number): B2DPolygon {
  const ret: B2DPolygon = { pts: [], closed: false };
  const TWO_PI = 2 * Math.PI;
  if (fStart < 0) fStart = 0;
  if (fStart >= TWO_PI) fStart = 0;
  if (fEnd < 0) fEnd = 0;
  if (fEnd >= TWO_PI) fEnd = 0;
  const pt = (a: number): [number, number] => [Math.cos(a), Math.sin(a)];
  const seg = (s: [number, number], e: [number, number], k: number) =>
    appendBezierSegment(ret, [s[0] - s[1] * k, s[1] + s[0] * k], [e[0] + e[1] * k, e[1] - e[0] * k], e[0], e[1]);
  if (Math.abs(fStart - fEnd) < 1e-9) {
    append(ret, ...pt(fStart));
  } else {
    const nSegments = STEPSPERQUARTER * 4;
    const fAnglePerSegment = Math.PI / 2 / STEPSPERQUARTER;
    const nStartSegment = Math.trunc(fStart / fAnglePerSegment) % nSegments;
    const nEndSegment = Math.trunc(fEnd / fAnglePerSegment) % nSegments;
    const fSegmentKappa = impDistanceBezierPointToControl(fAnglePerSegment);
    let aSegStart = pt(fStart);
    append(ret, ...aSegStart);
    if (nStartSegment === nEndSegment && fEnd > fStart) {
      seg(aSegStart, pt(fEnd), impDistanceBezierPointToControl(fEnd - fStart));
    } else {
      let fSegEndRad = (nStartSegment + 1) * fAnglePerSegment;
      let aSegEnd = pt(fSegEndRad);
      seg(aSegStart, aSegEnd, impDistanceBezierPointToControl(fSegEndRad - fStart));
      let nSegment = (nStartSegment + 1) % nSegments;
      aSegStart = aSegEnd;
      while (nSegment !== nEndSegment) {
        fSegEndRad = (nSegment + 1) * fAnglePerSegment;
        aSegEnd = pt(fSegEndRad);
        seg(aSegStart, aSegEnd, fSegmentKappa);
        nSegment = (nSegment + 1) % nSegments;
        aSegStart = aSegEnd;
      }
      const fSegStartRad = nSegment * fAnglePerSegment;
      seg(aSegStart, pt(fEnd), impDistanceBezierPointToControl(fEnd - fSegStartRad));
    }
  }
  removeDoublePoints(ret);
  return ret;
}

/** basegfx::utils::createPolygonFromEllipseSegment */
function createPolygonFromEllipseSegment(cx: number, cy: number, rx: number, ry: number, fStart: number, fEnd: number): B2DPolygon {
  const p = createPolygonFromUnitEllipseSegment(fStart, fEnd);
  transform(p, rx, ry, cx, cy);
  return p;
}

/** basegfx::utils::createPolygonFromEllipse: a closed ellipse starting at angle 0. */
function createPolygonFromEllipse(cx: number, cy: number, rx: number, ry: number): B2DPolygon {
  const k = impDistanceBezierPointToControl(Math.PI / 2 / STEPSPERQUARTER);
  const p: B2DPolygon = { pts: [], closed: true };
  const n = STEPSPERQUARTER * 4;
  for (let s = 0; s < n; s++) {
    const a = (s * Math.PI) / 2 / STEPSPERQUARTER, x = Math.cos(a), y = Math.sin(a);
    p.pts.push({ x, y, prev: [x + y * k, y - x * k], next: [x - y * k, y + x * k] });
  }
  transform(p, rx, ry, cx, cy);
  return p;
}

function lcl_getNormalizedCircleAngleRad(fWR: number, fHR: number, fEllipseAngleDeg: number): number {
  let fRet = 0;
  let fEAngleDeg = fEllipseAngleDeg % 360;
  if (fEAngleDeg < 0) fEAngleDeg += 360;
  if (fEAngleDeg === 0 || fEAngleDeg === 90 || fEAngleDeg === 180 || fEAngleDeg === 270) return (fEAngleDeg * Math.PI) / 180;
  const fX = fHR * Math.cos((fEAngleDeg * Math.PI) / 180);
  const fY = fWR * Math.sin((fEAngleDeg * Math.PI) / 180);
  if (fX !== 0 || fY !== 0) {
    fRet = Math.atan2(fY, fX);
    if (fRet < 0) fRet += 2 * Math.PI;
  }
  return fRet;
}
function lcl_getNormalizedAngleRad(fCircleAngleDeg: number): number {
  let fRet = fCircleAngleDeg % 360;
  if (fRet < 0) fRet += 360;
  return (fRet * Math.PI) / 180;
}

/**
 * CreateArc with tools::Polygon(rRect, rStart, rEnd, PolyStyle::Arc): the arc from the angle of
 * the start point counter-clockwise (on screen) to the angle of the end point, as a point polygon.
 */
function CreateArc(l: number, t: number, r: number, b: number, start: [number, number], end: [number, number], bClockwise: boolean): B2DPolygon {
  let swap = 0;
  if (l > r) swap ^= 0x01;
  if (t > b) swap ^= 0x11;
  if (swap) {
    [l, r] = [Math.min(l, r), Math.max(l, r)];
    [t, b] = [Math.min(t, b), Math.max(t, b)];
    if (swap & 1) [start, end] = [end, start];
  }
  const out: B2DPolygon = { pts: [], closed: false };
  const width = r - l + 1, height = b - t + 1;
  if (width === 0 || height === 0) return out;
  // tools::Rectangle::Center and the radii as ImplPolygon computes them.
  const cx = Math.trunc((l + r) / 2), cy = Math.trunc((t + b) / 2);
  const fRadX = cx - (l < cx ? l : r), fRadY = cy - (t < cy ? t : b);
  let nPoints = Math.min(256, Math.max(32, Math.PI * (1.5 * (fRadX + fRadY) - Math.sqrt(Math.abs(fRadX * fRadY)))));
  nPoints = Math.trunc(nPoints);
  if (fRadX > 32 && fRadY > 32 && fRadX + fRadY < 8192) nPoints >>= 1;
  const param = (p: [number, number]) => { const a = Math.atan2(cy - p[1], p[0] - cx); return Math.atan2(fRadX * Math.sin(a), fRadY * Math.cos(a)); };
  let fStart = param(start);
  const fEnd = param(end);
  let fDiff = fEnd - fStart;
  if (fDiff <= 0) fDiff += 2 * Math.PI;
  nPoints = Math.max(Math.trunc((fDiff / (2 * Math.PI)) * nPoints), 16);
  const fStep = fDiff / (nPoints - 1);
  const pts: [number, number][] = [];
  for (let k = 0; k < nPoints; k++, fStart += fStep) pts.push([Math.round(cx + fRadX * Math.cos(fStart)), Math.round(cy - fRadY * Math.sin(fStart))]);
  if (bClockwise) pts.reverse();
  for (const p of pts) append(out, p[0], p[1]);
  return out;
}

export class EnhancedCustomShape2d implements CustomShapeContext {
  readonly m_aGeometry: CustomShapeGeometry;
  /** m_aLogicRect's size; the rectangle is at the origin. */
  readonly m_nLogicWidth: number;
  readonly m_nLogicHeight: number;
  m_nCoordLeft: number;
  m_nCoordTop: number;
  m_nCoordWidthG: number;
  m_nCoordHeightG: number;
  m_nCoordWidth = 0;
  m_nCoordHeight = 0;
  m_bOOXMLShape: boolean;
  m_nXRef: number;
  m_nYRef: number;
  m_bFilled: boolean;
  m_bStroked: boolean;
  m_fXScale = 1;
  m_fYScale = 1;
  m_fXRatio = 1;
  m_fYRatio = 1;
  m_seqAdjustmentValues: number[];
  m_vEquationResults: { xNode?: ExpressionNode; bParsed: boolean; bReady: boolean; fValue: number }[];

  constructor(sShapeType: string, aGeometry: CustomShapeGeometry, nWidth: number, nHeight: number, bFilled = true, bStroked = true, adjust?: number[]) {
    this.m_aGeometry = aGeometry;
    this.m_nLogicWidth = nWidth;
    this.m_nLogicHeight = nHeight;
    this.m_bOOXMLShape = sShapeType.startsWith('ooxml-');
    this.m_bFilled = bFilled;
    this.m_bStroked = bStroked;
    // ApplyShapeAttributes
    this.m_seqAdjustmentValues = [...(aGeometry.adjust ?? [])];
    adjust?.forEach((v, k) => { this.m_seqAdjustmentValues[k] = v; });
    const [x, y, w, h] = aGeometry.viewBox;
    this.m_nCoordLeft = x;
    this.m_nCoordTop = y;
    this.m_nCoordWidthG = Math.abs(w);
    this.m_nCoordHeightG = Math.abs(h);
    this.m_nXRef = aGeometry.stretchX ?? DEFAULT_MINIMUM_SIGNED_COMPARE;
    this.m_nYRef = aGeometry.stretchY ?? DEFAULT_MINIMUM_SIGNED_COMPARE;
    this.SetPathSize(0);
    this.m_vEquationResults = (aGeometry.equations ?? []).map(() => ({ bParsed: false, bReady: false, fValue: 0 }));
  }

  SetPathSize(nIndex: number): void {
    let nWidth = 0, nHeight = 0;
    const sub = this.m_aGeometry.subViewSize;
    if (sub && nIndex < sub.length) [nWidth, nHeight] = sub[nIndex]!;
    if (nWidth && nHeight) { this.m_nCoordWidth = nWidth; this.m_nCoordHeight = nHeight; }
    else { this.m_nCoordWidth = this.m_nCoordWidthG; this.m_nCoordHeight = this.m_nCoordHeightG; }
    const W = this.m_nLogicWidth, H = this.m_nLogicHeight;
    this.m_fXScale = this.m_nCoordWidth === 0 ? 0 : W / this.m_nCoordWidth;
    this.m_fYScale = this.m_nCoordHeight === 0 ? 0 : H / this.m_nCoordHeight;
    if (this.m_bOOXMLShape) {
      // Try to set up scale separately, if given only width or height
      if (this.m_nCoordWidth === 0) this.m_fXScale = nWidth ? W / nWidth : 1;
      if (this.m_nCoordHeight === 0) this.m_fYScale = nHeight ? H / nHeight : 1;
    }
    if (this.m_nXRef !== DEFAULT_MINIMUM_SIGNED_COMPARE && H) {
      this.m_fXRatio = W / H;
      if (this.m_fXRatio > 1) this.m_fXScale /= this.m_fXRatio;
      else this.m_fXRatio = 1;
    } else this.m_fXRatio = 1;
    if (this.m_nYRef !== DEFAULT_MINIMUM_SIGNED_COMPARE && W) {
      this.m_fYRatio = H / W;
      if (this.m_fYRatio > 1) this.m_fYScale /= this.m_fYRatio;
      else this.m_fYRatio = 1;
    } else this.m_fYRatio = 1;
  }

  GetEnumFunc(eFunc: ExpressionFunct): number {
    switch (eFunc) {
      case 'EnumPi': return Math.PI;
      case 'EnumLeft': return this.m_nCoordLeft;
      case 'EnumTop': return this.m_nCoordTop;
      case 'EnumRight': return (this.m_nCoordLeft + this.m_nCoordWidth) * this.m_fXRatio;
      case 'EnumBottom': return (this.m_nCoordTop + this.m_nCoordHeight) * this.m_fYRatio;
      case 'EnumXStretch': return this.m_nXRef;
      case 'EnumYStretch': return this.m_nYRef;
      case 'EnumHasStroke': return this.m_bStroked ? 1 : 0;
      case 'EnumHasFill': return this.m_bFilled ? 1 : 0;
      case 'EnumWidth': return this.m_nCoordWidth;
      case 'EnumHeight': return this.m_nCoordHeight;
      case 'EnumLogWidth': return this.m_nLogicWidth;
      case 'EnumLogHeight': return this.m_nLogicHeight;
    }
  }

  GetAdjustValueAsDouble(nIndex: number): number {
    return this.m_seqAdjustmentValues[nIndex] ?? 0;
  }

  GetEquationValueAsDouble(nIndex: number): number {
    let fNumber = 0;
    const r = this.m_vEquationResults[nIndex];
    if (!r) return fNumber;
    if (!r.bParsed) {
      r.bParsed = true;
      try { r.xNode = parseFunction(this.m_aGeometry.equations![nIndex]!, this); } catch (e) { if (!(e instanceof ParseError)) throw e; }
    }
    if (r.xNode) {
      try {
        if (r.bReady) fNumber = r.fValue;
        else { fNumber = r.fValue = r.xNode(); r.bReady = true; }
        if (!Number.isFinite(fNumber)) fNumber = 0;
      } catch { /* a loop in the equations */ }
    }
    return fNumber;
  }

  GetParameter(rParameter: EnhancedCustomShapeParameter, bReplaceGeoWidth: boolean, bReplaceGeoHeight: boolean): number {
    const T = EnhancedCustomShapeParameterType;
    const [type, value] = typeof rParameter === 'number' ? [T.NORMAL, rParameter] : rParameter;
    switch (type) {
      case T.ADJUSTMENT: return this.GetAdjustValueAsDouble(value);
      case T.EQUATION: return this.GetEquationValueAsDouble(value);
      case T.NORMAL: {
        let ret = value;
        if (Number.isInteger(value)) {
          if (bReplaceGeoWidth && value === this.m_nCoordWidth) ret *= this.m_fXRatio;
          else if (bReplaceGeoHeight && value === this.m_nCoordHeight) ret *= this.m_fYRatio;
        }
        return ret;
      }
      case T.LEFT: case T.TOP: return 0;
      case T.RIGHT: return this.m_nCoordWidth;
      case T.BOTTOM: return this.m_nCoordHeight;
    }
    return 0;
  }

  GetPointAsB2DPoint(rPair: EnhancedCustomShapeParameterPair, bScale: boolean, bReplaceGeoSize: boolean): [number, number] {
    let x = this.GetParameter(rPair[0], bReplaceGeoSize, false) - this.m_nCoordLeft;
    if (bScale) x *= this.m_fXScale;
    let y = this.GetParameter(rPair[1], false, bReplaceGeoSize) - this.m_nCoordTop;
    if (bScale) y *= this.m_fYScale;
    return [x, y];
  }

  /** GetPoint: as GetPointAsB2DPoint, truncated to whole units like tools Point. */
  GetPoint(rPair: EnhancedCustomShapeParameterPair, bScale: boolean, bReplaceGeoSize: boolean): [number, number] {
    const [x, y] = this.GetPointAsB2DPoint(rPair, bScale, bReplaceGeoSize);
    return [Math.trunc(x), Math.trunc(y)];
  }

  /** The text area relative to the shape's top left corner (without flips). */
  GetTextRect(): { x: number; y: number; w: number; h: number } {
    const full = { x: 0, y: 0, w: this.m_nLogicWidth, h: this.m_nLogicHeight };
    const tf = this.m_aGeometry.textFrames?.[0];
    if (!tf) return full;
    const a = this.GetPoint(tf[0], !this.m_bOOXMLShape, true), b = this.GetPoint(tf[1], !this.m_bOOXMLShape, true);
    const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
    if (w <= 1 || h <= 1) return full;
    return { x, y, w, h };
  }

  private CreateSubPath(st: { rSrcPt: number; rSegmentInd: number }, rObjectList: SdrPathObj[], bSortFilledObjectsToBack: boolean, nIndex: number): void {
    let bNoFill = false, bNoStroke = false, dBrightness = 0;
    const aNewB2DPolyPolygon: B2DPolygon[] = [];
    let aNewB2DPolygon: B2DPolygon = { pts: [], closed: false };
    const coords = this.m_aGeometry.coords;
    const segs = this.m_aGeometry.segments ?? [];
    const flush = () => {
      if (aNewB2DPolygon.pts.length > 1) { checkClosed(aNewB2DPolygon); aNewB2DPolyPolygon.push(aNewB2DPolygon); }
      aNewB2DPolygon = { pts: [], closed: false };
    };
    const pt = (k: number) => this.GetPoint(coords[k]!, true, true);
    const ptD = (k: number) => this.GetPointAsB2DPoint(coords[k]!, true, true);

    this.SetPathSize(nIndex);
    const nSegInfoSize = segs.length;
    if (!nSegInfoSize) {
      for (const c of coords) append(aNewB2DPolygon, ...this.GetPoint(c, true, true));
      aNewB2DPolygon.closed = true;
    } else {
      const nCoordSize = coords.length;
      while (st.rSegmentInd < nSegInfoSize) {
        const [nCommand, nPntCount] = segs[st.rSegmentInd++]!;
        switch (nCommand) {
          case C.NOFILL: bNoFill = true; break;
          case C.NOSTROKE: bNoStroke = true; break;
          case C.DARKEN: dBrightness = -0.4; break;
          case C.DARKENLESS: dBrightness = -0.2; break;
          case C.LIGHTEN: dBrightness = 0.4; break;
          case C.LIGHTENLESS: dBrightness = 0.2; break;
          case C.MOVETO:
            flush();
            if (st.rSrcPt < nCoordSize) append(aNewB2DPolygon, ...pt(st.rSrcPt++));
            break;
          case C.ENDSUBPATH: break;
          case C.CLOSESUBPATH:
            if (aNewB2DPolygon.pts.length) {
              if (aNewB2DPolygon.pts.length > 1) { aNewB2DPolygon.closed = true; aNewB2DPolyPolygon.push(aNewB2DPolygon); }
              aNewB2DPolygon = { pts: [], closed: false };
            }
            break;
          case C.CURVETO:
            for (let i = 0; i < nPntCount && st.rSrcPt + 2 < nCoordSize; i++) {
              const a = pt(st.rSrcPt++), b = pt(st.rSrcPt++), e = pt(st.rSrcPt++);
              appendBezierSegment(aNewB2DPolygon, a, b, e[0], e[1]);
            }
            break;
          case C.ANGLEELLIPSE:
          case C.ANGLEELLIPSETO:
            for (let i = 0; i < nPntCount && st.rSrcPt + 2 < nCoordSize; i++) {
              // ANGLEELLIPSE makes an implicit MOVETO, which ends the previous subpath.
              if (nCommand === C.ANGLEELLIPSE) flush();
              const [cx, cy] = ptD(st.rSrcPt);
              const fWR = this.GetParameter(coords[st.rSrcPt + 1]![0], true, false);
              const fHR = this.GetParameter(coords[st.rSrcPt + 1]![1], false, true);
              const fStartAngle = this.GetParameter(coords[st.rSrcPt + 2]![0], false, false);
              const fEndAngle = this.GetParameter(coords[st.rSrcPt + 2]![1], false, false);
              st.rSrcPt += 3;
              const fScaledWR = fWR * this.m_fXScale, fScaledHR = fHR * this.m_fYScale;
              if (fScaledWR === 0 && fScaledHR === 0) { append(aNewB2DPolygon, cx, cy); continue; }
              if (Math.abs(Math.abs(fEndAngle - fStartAngle) - 360) < 1e-15 || Math.abs(fEndAngle - fStartAngle) >= 360) {
                // draw full ellipse as two half ellipses (the preset shapes with U all draw full ellipses)
                const fS = lcl_getNormalizedCircleAngleRad(fWR, fHR, fStartAngle);
                const fH = lcl_getNormalizedCircleAngleRad(fWR, fHR, fStartAngle + 180);
                const fE = lcl_getNormalizedCircleAngleRad(fWR, fHR, fEndAngle);
                appendPoly(aNewB2DPolygon, createPolygonFromEllipseSegment(cx, cy, fScaledWR, fScaledHR, fS, fH));
                appendPoly(aNewB2DPolygon, createPolygonFromEllipseSegment(cx, cy, fScaledWR, fScaledHR, fH, fE));
                continue;
              }
              const fS = lcl_getNormalizedCircleAngleRad(fWR, fHR, fStartAngle);
              const fE = lcl_getNormalizedCircleAngleRad(fWR, fHR, fEndAngle);
              appendPoly(aNewB2DPolygon, createPolygonFromEllipseSegment(cx, cy, fScaledWR, fScaledHR, fS, fE));
            }
            break;
          case C.QUADRATICCURVETO:
            for (let i = 0; i < nPntCount && st.rSrcPt + 1 < nCoordSize; i++) {
              const prev = aNewB2DPolygon.pts[aNewB2DPolygon.pts.length - 1];
              if (prev) {
                const q = ptD(st.rSrcPt++), e = ptD(st.rSrcPt++);
                appendBezierSegment(aNewB2DPolygon, [(prev.x + q[0] * 2) / 3, (prev.y + q[1] * 2) / 3], [(q[0] * 2 + e[0]) / 3, (q[1] * 2 + e[1]) / 3], e[0], e[1]);
              } else {
                st.rSrcPt++;
                append(aNewB2DPolygon, ...ptD(st.rSrcPt++));
              }
            }
            break;
          case C.LINETO:
            for (let i = 0; i < nPntCount && st.rSrcPt < nCoordSize; i++) append(aNewB2DPolygon, ...pt(st.rSrcPt++));
            break;
          case C.ARC: case C.CLOCKWISEARC: case C.ARCTO: case C.CLOCKWISEARCTO: {
            const bClockwise = nCommand === C.CLOCKWISEARC || nCommand === C.CLOCKWISEARCTO;
            const bImplicitMoveTo = nCommand === C.ARC || nCommand === C.CLOCKWISEARC;
            const nXor = bClockwise ? 3 : 2;
            for (let i = 0; i < nPntCount && st.rSrcPt + 3 < nCoordSize; i++) {
              if (bImplicitMoveTo) flush();
              const p1 = pt(st.rSrcPt), p2 = pt(st.rSrcPt + 1);
              const l = Math.min(p1[0], p2[0]), r = Math.max(p1[0], p2[0]), t = Math.min(p1[1], p2[1]), b = Math.max(p1[1], p2[1]);
              if (r - l + 1 && b - t + 1) {
                const aStart = pt(st.rSrcPt + nXor), aEnd = pt(st.rSrcPt + (nXor ^ 1));
                appendPoly(aNewB2DPolygon, CreateArc(l, t, r, b, aStart, aEnd, bClockwise));
              }
              st.rSrcPt += 4;
            }
            break;
          }
          case C.ARCANGLETO:
            for (let i = 0; i < nPntCount && st.rSrcPt + 1 < nCoordSize; i++) {
              const [fWR, fHR] = this.GetPointAsB2DPoint(coords[st.rSrcPt]!, false, false);
              let [fStartAngle, fSwingAngle] = this.GetPointAsB2DPoint(coords[st.rSrcPt + 1]!, false, false);
              if (this.m_bOOXMLShape) fSwingAngle = Math.min(360, Math.max(-360, fSwingAngle));
              const last = aNewB2DPolygon.pts[aNewB2DPolygon.pts.length - 1];
              if (last) {
                let aTemp: B2DPolygon = { pts: [], closed: false };
                if (fWR === 0 && fHR === 0) append(aTemp, 0, 0);
                else {
                  let fEndAngle = fStartAngle + fSwingAngle;
                  if (fSwingAngle < 0) [fStartAngle, fEndAngle] = [fEndAngle, fStartAngle];
                  let fFrom = fStartAngle;
                  if (fSwingAngle >= 360 || fSwingAngle <= -360) {
                    let fTo = fFrom + 180;
                    while (fTo < fEndAngle) {
                      appendPoly(aTemp, createPolygonFromEllipseSegment(fWR, fHR, fWR, fHR, lcl_getNormalizedCircleAngleRad(fWR, fHR, fFrom), lcl_getNormalizedCircleAngleRad(fWR, fHR, fTo)));
                      fFrom = fTo;
                      fTo += 180;
                    }
                  }
                  appendPoly(aTemp, createPolygonFromEllipseSegment(fWR, fHR, fWR, fHR, lcl_getNormalizedCircleAngleRad(fWR, fHR, fFrom), lcl_getNormalizedCircleAngleRad(fWR, fHR, fEndAngle)));
                  if (fSwingAngle < 0) flip(aTemp);
                  removeDoublePoints(aTemp);
                }
                transform(aTemp, this.m_fXScale, this.m_fYScale, 0, 0);
                const first = aTemp.pts[0]!;
                transform(aTemp, 1, 1, last.x - first.x, last.y - first.y);
                appendPoly(aNewB2DPolygon, aTemp);
                aTemp = { pts: [], closed: false };
              }
              st.rSrcPt += 2;
            }
            break;
          case C.ELLIPTICALQUADRANTX:
          case C.ELLIPTICALQUADRANTY:
            if (nPntCount && st.rSrcPt < nCoordSize) {
              let aStart: [number, number];
              let i = 0;
              if (st.rSrcPt) aStart = ptD(st.rSrcPt - 1);
              else { aStart = ptD(st.rSrcPt); append(aNewB2DPolygon, ...aStart); st.rSrcPt++; i++; }
              let bIsXDirection = nCommand === C.ELLIPTICALQUADRANTX;
              const H = Math.PI / 2;
              for (; i < nPntCount && st.rSrcPt < nCoordSize; i++) {
                const aEnd = ptD(st.rSrcPt);
                const rx = Math.abs(aEnd[0] - aStart[0]), ry = Math.abs(aEnd[1] - aStart[1]);
                let aArc: B2DPolygon;
                const left = aEnd[0] < aStart[0], up = aEnd[1] < aStart[1];
                if (bIsXDirection) {
                  const [cx, cy] = [aStart[0], aEnd[1]];
                  if (left) { aArc = up ? createPolygonFromEllipseSegment(cx, cy, rx, ry, H, Math.PI) : createPolygonFromEllipseSegment(cx, cy, rx, ry, Math.PI, 3 * H); if (!up) flip(aArc); }
                  else { aArc = up ? createPolygonFromEllipseSegment(cx, cy, rx, ry, 0, H) : createPolygonFromEllipseSegment(cx, cy, rx, ry, 3 * H, 4 * H); if (up) flip(aArc); }
                } else {
                  const [cx, cy] = [aEnd[0], aStart[1]];
                  if (left) { aArc = up ? createPolygonFromEllipseSegment(cx, cy, rx, ry, 3 * H, 4 * H) : createPolygonFromEllipseSegment(cx, cy, rx, ry, 0, H); if (up) flip(aArc); }
                  else { aArc = up ? createPolygonFromEllipseSegment(cx, cy, rx, ry, Math.PI, 3 * H) : createPolygonFromEllipseSegment(cx, cy, rx, ry, H, Math.PI); if (!up) flip(aArc); }
                }
                appendPoly(aNewB2DPolygon, aArc);
                st.rSrcPt++;
                bIsXDirection = !bIsXDirection;
                aStart = aEnd;
              }
            }
            break;
        }
        if (nCommand === C.ENDSUBPATH) break;
      }
    }
    if (st.rSegmentInd === nSegInfoSize) st.rSegmentInd++;
    if (aNewB2DPolygon.pts.length > 1) { checkClosed(aNewB2DPolygon); aNewB2DPolyPolygon.push(aNewB2DPolygon); }
    if (!aNewB2DPolyPolygon.length) return;

    const isClosed = aNewB2DPolyPolygon.every((p) => p.closed);
    // #i37011#
    const bForceCreateTwoObjects = !bSortFilledObjectsToBack && !isClosed && !bNoStroke;
    if (bForceCreateTwoObjects || bSortFilledObjectsToBack) {
      if (this.m_bFilled && !bNoFill) rObjectList.push({ polys: aNewB2DPolyPolygon.map((p) => ({ pts: p.pts, closed: true })), fill: true, stroke: false, brightness: dBrightness });
      if (!bNoStroke) rObjectList.push({ polys: aNewB2DPolyPolygon, fill: false, stroke: true, brightness: dBrightness });
    } else if (bNoFill) {
      rObjectList.push({ polys: aNewB2DPolyPolygon, fill: false, stroke: !bNoStroke, brightness: dBrightness });
    } else {
      rObjectList.push({ polys: aNewB2DPolyPolygon.map((p) => ({ pts: p.pts, closed: true })), fill: true, stroke: !bNoStroke, brightness: dBrightness });
    }
  }

  /** CreatePathObj: the sub-paths in painting order, in the shape's coordinates (twips from its top left). */
  CreatePathObj(): SdrPathObj[] {
    if (!this.m_aGeometry.coords.length) return [];
    const vObjectList: SdrPathObj[] = [];
    const bSortFilledObjectsToBack = this.m_aGeometry.sortFilledToBack ?? true;
    const st = { rSrcPt: 0, rSegmentInd: 0 };
    let nSubPathIndex = 0;
    const nSegs = this.m_aGeometry.segments?.length ?? 0;
    while (st.rSegmentInd <= nSegs) {
      const before = st.rSegmentInd;
      this.CreateSubPath(st, vObjectList, bSortFilledObjectsToBack, nSubPathIndex);
      nSubPathIndex++;
      if (st.rSegmentInd === before) st.rSegmentInd++;
    }
    // #i37011# remove invisible objects
    let list = vObjectList.filter((o) => (o.fill && this.m_bFilled) || (o.stroke && this.m_bStroked));
    if (list.length > 1 && bSortFilledObjectsToBack) {
      // sort objects so that filled ones are in front. Necessary for some strange objects
      // (SdrPathObj::IsLine: open polygons are lines and go last).
      const isLine = (o: SdrPathObj) => o.polys.every((p) => !p.closed);
      list = [...list.filter((o) => !isLine(o)), ...list.filter(isLine)];
    }
    return list;
  }
}
