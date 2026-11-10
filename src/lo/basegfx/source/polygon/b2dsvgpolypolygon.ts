// SPDX-License-Identifier: MPL-2.0
// @upstream basegfx/source/polygon/b2dsvgpolypolygon.cxx partial
// importFromSvgD and importFromSvgPoints. Quadratic segments become cubic ones and arcs become
// cubic segments of at most 90° each, as upstream does; the arc's segments come from the usual
// tangent approximation instead of createPolygonFromUnitEllipseSegment (the same curves within
// rounding). bHandleRelativeNextPointCompatible and the help point index set are not ported.
import type { B2DPoint, B2DPolygon } from '../../../svx/source/customshapes/EnhancedCustomShape2d.ts';

/** basegfx::internal's number scanner: numbers with sign, fraction and exponent; commas separate. */
class Scanner {
  nPos = 0;
  private readonly s: string;
  constructor(s: string) { this.s = s; this.skipSpaces(); }
  get done(): boolean { return this.nPos >= this.s.length; }
  get char(): string { return this.s[this.nPos]!; }
  skipSpaces(): void { while (this.nPos < this.s.length && /[\s,]/.test(this.s[this.nPos]!)) this.nPos++; }
  isOnNumberChar(): boolean { return !this.done && /[-+.\d]/.test(this.char); }
  importDouble(): number {
    const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(this.s.slice(this.nPos));
    if (!m) throw new Error('svg:d: number expected');
    this.nPos += m[0].length;
    this.skipSpaces();
    return parseFloat(m[0]);
  }
  /** importFlagAndSpaces: arc flags are single digits that may touch the next number. */
  importFlag(): number {
    const c = this.char;
    if (c !== '0' && c !== '1') throw new Error('svg:d: flag expected');
    this.nPos++;
    this.skipSpaces();
    return c === '1' ? 1 : 0;
  }
}

const last = (p: B2DPolygon) => p.pts[p.pts.length - 1]!;

/** B2DPolygon::appendBezierSegment */
function appendBezierSegment(p: B2DPolygon, c1: [number, number], c2: [number, number], x: number, y: number): void {
  last(p).next = c1;
  p.pts.push({ x, y, prev: c2 });
}

/** An elliptical arc from the current point, as SVG's appendix F.6 defines it. */
function appendArc(poly: B2DPolygon, x1: number, y1: number, fRX: number, fRY: number, fPhi: number, bLarge: number, bSweep: number, x2: number, y2: number): void {
  fRX = Math.abs(fRX); fRY = Math.abs(fRY);
  const phi = (fPhi * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  let cxp = 0, cyp = 0;
  const fRadicant = (fRX * fRX * fRY * fRY - fRX * fRX * y1p * y1p - fRY * fRY * x1p * x1p) / (fRX * fRX * y1p * y1p + fRY * fRY * x1p * x1p);
  if (fRadicant < 0) {
    // no solution: scale up the ellipse uniformly such that it passes through the end points
    const fRatio = fRX / fRY;
    fRY = Math.hypot(y1p, x1p / fRatio);
    fRX = fRatio * fRY;
  } else {
    const fFactor = (bLarge === bSweep ? -1 : 1) * Math.sqrt(fRadicant);
    cxp = (fFactor * fRX * y1p) / fRY;
    cyp = (-fFactor * fRY * x1p) / fRX;
  }
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number) => Math.atan2(uy, ux);
  const t1 = ang((x1p - cxp) / fRX, (y1p - cyp) / fRY);
  let dt = ang((-x1p - cxp) / fRX, (-y1p - cyp) / fRY) - t1;
  if (bSweep && dt < 0) dt += 2 * Math.PI;
  else if (!bSweep && dt > 0) dt -= 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const step = dt / n, k = (4 / 3) * Math.tan(step / 4);
  const at = (t: number): [number, number] => [cx + fRX * Math.cos(t) * cos - fRY * Math.sin(t) * sin, cy + fRX * Math.cos(t) * sin + fRY * Math.sin(t) * cos];
  const d = (t: number): [number, number] => [-fRX * Math.sin(t) * cos - fRY * Math.cos(t) * sin, -fRX * Math.sin(t) * sin + fRY * Math.cos(t) * cos];
  for (let i = 0; i < n; i++) {
    const a = t1 + i * step, b = a + step;
    const [ax, ay] = at(a), [bx, by] = i === n - 1 ? [x2, y2] : at(b);
    const [dax, day] = d(a), [dbx, dby] = d(b);
    appendBezierSegment(poly, [ax + k * dax, ay + k * day], [bx - k * dbx, by - k * dby], bx, by);
  }
}

/** importFromSvgD: the sub-polygons of an SVG path, with control points on their points. */
export function importFromSvgD(rSvgDStatement: string): B2DPolygon[] {
  const out: B2DPolygon[] = [];
  const sc = new Scanner(rSvgDStatement);
  let nLastX = 0, nLastY = 0;
  let aCurrPoly: B2DPolygon = { pts: [], closed: false };
  // The control point of the last quadratic segment, for T.
  let lastQuad: [number, number] | null = null;
  const ensureStart = () => { if (!aCurrPoly.pts.length) aCurrPoly.pts.push({ x: nLastX, y: nLastY }); };
  while (!sc.done) {
    const aCurrChar = sc.char;
    if (out.length && !aCurrPoly.pts.length && aCurrChar !== 'm' && aCurrChar !== 'M') {
      // a new sub-polygon starting without a 'moveto' starts at the current point
      aCurrPoly.pts.push({ x: nLastX, y: nLastY });
    }
    const bRelative = aCurrChar === aCurrChar.toLowerCase();
    const rel = (x: number, y: number): [number, number] => (bRelative ? [x + nLastX, y + nLastY] : [x, y]);
    sc.nPos++;
    sc.skipSpaces();
    const cmd = aCurrChar.toUpperCase();
    if (cmd !== 'Q' && cmd !== 'T') lastQuad = null;
    switch (cmd) {
      case 'Z':
        if (aCurrPoly.pts.length) {
          // the next subpath starts at the same initial point as the current subpath
          nLastX = aCurrPoly.pts[0]!.x; nLastY = aCurrPoly.pts[0]!.y;
          aCurrPoly.closed = true;
          out.push(aCurrPoly);
          aCurrPoly = { pts: [], closed: false };
        }
        break;
      case 'M': case 'L': {
        let bFirst = cmd === 'M';
        while (sc.isOnNumberChar()) {
          const [x, y] = rel(sc.importDouble(), sc.importDouble());
          if (bFirst && aCurrPoly.pts.length) {
            // a moveto starts a new sub-polygon
            out.push(aCurrPoly);
            aCurrPoly = { pts: [], closed: false };
          }
          bFirst = false;
          aCurrPoly.pts.push({ x, y });
          nLastX = x; nLastY = y;
        }
        break;
      }
      case 'H': case 'V':
        while (sc.isOnNumberChar()) {
          const v = sc.importDouble();
          let x = nLastX, y = nLastY;
          if (cmd === 'H') x = bRelative ? v + nLastX : v; else y = bRelative ? v + nLastY : v;
          ensureStart();
          aCurrPoly.pts.push({ x, y });
          nLastX = x; nLastY = y;
        }
        break;
      case 'S': case 'C':
        while (sc.isOnNumberChar()) {
          let c1: [number, number];
          if (cmd === 'C') c1 = rel(sc.importDouble(), sc.importDouble());
          else {
            // the reflection of the previous control point, else the current point
            ensureStart();
            const p: B2DPoint = last(aCurrPoly);
            c1 = p.prev ? [2 * p.x - p.prev[0], 2 * p.y - p.prev[1]] : [nLastX, nLastY];
          }
          const c2 = rel(sc.importDouble(), sc.importDouble());
          const [x, y] = rel(sc.importDouble(), sc.importDouble());
          ensureStart();
          appendBezierSegment(aCurrPoly, c1, c2, x, y);
          nLastX = x; nLastY = y;
        }
        break;
      case 'Q': case 'T':
        while (sc.isOnNumberChar()) {
          const q: [number, number] = cmd === 'Q' ? rel(sc.importDouble(), sc.importDouble()) : lastQuad ? [2 * nLastX - lastQuad[0], 2 * nLastY - lastQuad[1]] : [nLastX, nLastY];
          const [x, y] = rel(sc.importDouble(), sc.importDouble());
          ensureStart();
          // the quadratic segment as a cubic one
          appendBezierSegment(aCurrPoly, [nLastX + (2 / 3) * (q[0] - nLastX), nLastY + (2 / 3) * (q[1] - nLastY)], [x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y)], x, y);
          lastQuad = q;
          nLastX = x; nLastY = y;
        }
        break;
      case 'A':
        while (sc.isOnNumberChar()) {
          const fRX = sc.importDouble(), fRY = sc.importDouble(), fPhi = sc.importDouble();
          const bLarge = sc.importFlag(), bSweep = sc.importFlag();
          const [x, y] = rel(sc.importDouble(), sc.importDouble());
          // start == end: skip according to the SVG spec
          if (Math.abs(x - nLastX) < 1e-9 && Math.abs(y - nLastY) < 1e-9) continue;
          ensureStart();
          if (fRX === 0 || fRY === 0) aCurrPoly.pts.push({ x, y }); // a straight line
          else appendArc(aCurrPoly, nLastX, nLastY, fRX, fRY, fPhi, bLarge, bSweep, x, y);
          nLastX = x; nLastY = y;
        }
        break;
      default:
        throw new Error(`svg:d: unknown command ${aCurrChar}`);
    }
  }
  if (aCurrPoly.pts.length) out.push(aCurrPoly);
  return out;
}

/** importFromSvgPoints: draw:points of a polygon or polyline. */
export function importFromSvgPoints(rSvgPointsAttribute: string): B2DPolygon {
  const sc = new Scanner(rSvgPointsAttribute);
  const pts: B2DPoint[] = [];
  while (!sc.done) pts.push({ x: sc.importDouble(), y: sc.importDouble() });
  return { pts, closed: false };
}
