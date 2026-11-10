// SPDX-License-Identifier: MPL-2.0
// @upstream oox/source/drawingml/customshapegeometry.cxx reduced
// a:custGeom as custom shape geometry: the adjustment values (a:avLst), the guides (a:gdLst) with
// their formulas converted to the engine's equations (convertToOOEquation), the paths (a:pathLst)
// with their own coordinate spaces, and the text rectangle (a:rect). Handles (a:ahLst) and
// connection sites (a:cxnLst) are not read. The writer turns any shape's evaluated outline back
// into a:custGeom, for shapes without an OOXML preset.
import { child, childElements, type XmlElement } from '../../../xmloff/source/core/xmlparse.ts';
import { EnhancedCustomShapeParameterType as T, EnhancedCustomShapeSegmentCommand as C, type CustomShapeGeometry, type EnhancedCustomShapeParameter, type EnhancedCustomShapeParameterPair, type SdrPathObj } from '../../../svx/source/customshapes/EnhancedCustomShape2d.ts';

/** The constants and shape-relative names a guide may use (GetAdjCoordinate). */
const CONSTANTS: Record<string, number> = {
  '3cd4': 270 * 60000, '3cd8': 135 * 60000, '5cd8': 225 * 60000, '7cd8': 315 * 60000,
  cd2: 180 * 60000, cd3: 120 * 60000, cd4: 90 * 60000, cd8: 45 * 60000, t: 0, l: 0,
};
const BUILTIN: Record<string, string> = {
  w: 'logwidth', r: 'logwidth', h: 'logheight', b: 'logheight', hc: 'logwidth/2', vc: 'logheight/2',
  ls: 'max(logwidth,logheight)', ss: 'min(logwidth,logheight)',
  ...Object.fromEntries([2, 3, 4, 5, 6, 8, 10, 32].map((n) => [`wd${n}`, `logwidth/${n}`])),
  ...Object.fromEntries([2, 3, 4, 5, 6, 8, 10].map((n) => [`hd${n}`, `logheight/${n}`])),
  ...Object.fromEntries([2, 4, 6, 8, 16, 32].map((n) => [`ssd${n}`, `min(logwidth,logheight)/${n}`])),
};

/** GetFormulaParameter */
const formulaParameter = (p: EnhancedCustomShapeParameter): string => {
  if (typeof p === 'number') return String(p);
  const [t, v] = p;
  return t === T.EQUATION ? `?${v} ` : t === T.ADJUSTMENT ? `$${v} ` : String(v);
};

/** CustomShapeProperties' guide list and adjustment values while a:custGeom is read. */
class GuideList {
  adjustNames: string[] = [];
  adjust: number[] = [];
  guides: { name: string; formula: string }[] = [];

  /** SetCustomShapeGuideValue: the index of a guide, added when new. */
  set(name: string, formula: string): number {
    const k = this.guides.findIndex((g) => g.name === name);
    if (k >= 0) return k;
    this.guides.push({ name, formula });
    return this.guides.length - 1;
  }

  /** GetAdjCoordinate */
  param(value: string): EnhancedCustomShapeParameter {
    const n = Number(value);
    if (value.trim() !== '' && Number.isFinite(n)) return n;
    if (value in CONSTANTS) return CONSTANTS[value]!;
    const adj = this.adjustNames.indexOf(value);
    if (adj >= 0) return [T.ADJUSTMENT, adj];
    const g = this.guides.findIndex((x) => x.name === value);
    if (g >= 0) return [T.EQUATION, g];
    if (BUILTIN[value]) return [T.EQUATION, this.set(value, BUILTIN[value]!)];
    return 0;
  }

  /** convertToOOEquation */
  equation(fmla: string): string {
    const tokens = fmla.trim().split(/\s+/);
    const p = tokens.slice(1, 4).map((t) => formulaParameter(this.param(t)));
    const [a, b, c] = p;
    switch (tokens[0]) {
      case '*/': return `${a}*${b}/${c}`;
      case '+-': return `${a}+${b}-${c}`;
      case '+/': return `(${a}+${b})/${c}`;
      case 'ifelse': case '?:': return `if(${a},${b},${c})`;
      case 'abs': return `abs(${a})`;
      case 'at2': return `(10800000*atan2(${b},${a}))/pi`;
      case 'cat2': return `${a}*(cos(atan2(${c},${b})))`;
      case 'cos': return `${a}*cos(pi*(${b})/10800000)`;
      case 'max': return `max(${a},${b})`;
      case 'min': return `min(${a},${b})`;
      case 'mod': return `sqrt(${a}*${a}+${b}*${b}+${c}*${c})`;
      case 'pin': return `if(${a}-${b},${a},if(${c}-${b},${b},${c}))`;
      case 'sat2': return `${a}*(sin(atan2(${c},${b})))`;
      case 'sin': return `${a}*sin(pi*(${b})/10800000)`;
      case 'sqrt': return `sqrt(${a})`;
      case 'tan': return `${a}*tan(pi*(${b})/10800000)`;
      case 'val': return `${a}`;
    }
    return '0';
  }
}

/**
 * CustomShapeGeometryContext for a:custGeom: the shape's own geometry (an "ooxml-non-primitive"),
 * with CustomShapeProperties::pushToPropSet's view box for a shape of `cx` × `cy` EMU.
 */
export function ImportCustGeom(custGeom: XmlElement, cx: number, cy: number): CustomShapeGeometry | null {
  const gl = new GuideList();
  for (const gd of childElements(child(custGeom, 'a:avLst') ?? custGeom).filter((e) => e.name === 'a:gd')) {
    gl.adjustNames.push(gd.attrs.get('name') ?? '');
    gl.adjust.push(Number(/^val\s+(-?[\d.]+)/.exec(gd.attrs.get('fmla') ?? '')?.[1] ?? 0));
  }
  if (!child(custGeom, 'a:avLst')) { gl.adjustNames = []; gl.adjust = []; }
  for (const gd of childElements(child(custGeom, 'a:gdLst') ?? { name: '', attrs: new Map(), children: [] }).filter((e) => e.name === 'a:gd')) {
    // A guide's formula may refer to the guides before it; it gets its index first.
    const k = gl.set(gd.attrs.get('name') ?? '', '0');
    gl.guides[k]!.formula = gl.equation(gd.attrs.get('fmla') ?? 'val 0');
  }
  const coords: EnhancedCustomShapeParameterPair[] = [];
  const segments: [number, number][] = [];
  const subViewSize: [number, number][] = [];
  const pt = (e: XmlElement | undefined): EnhancedCustomShapeParameterPair => [gl.param(e?.attrs.get('x') ?? '0'), gl.param(e?.attrs.get('y') ?? '0')];
  const add = (cmd: number) => {
    const last = segments[segments.length - 1];
    if (last && last[0] === cmd && cmd !== C.MOVETO) last[1]++;
    else segments.push([cmd, 1]);
  };
  let arcNum = 0;
  for (const path of childElements(child(custGeom, 'a:pathLst') ?? { name: '', attrs: new Map(), children: [] }).filter((e) => e.name === 'a:path')) {
    subViewSize.push([Number(path.attrs.get('w') ?? 0), Number(path.attrs.get('h') ?? 0)]);
    for (const c of childElements(path)) {
      switch (c.name) {
        case 'a:moveTo': segments.push([C.MOVETO, 1]); coords.push(pt(child(c, 'a:pt'))); break;
        case 'a:lnTo': add(C.LINETO); coords.push(pt(child(c, 'a:pt'))); break;
        case 'a:cubicBezTo': add(C.CURVETO); for (const p of childElements(c)) coords.push(pt(p)); break;
        case 'a:quadBezTo': add(C.QUADRATICCURVETO); for (const p of childElements(c)) coords.push(pt(p)); break;
        case 'a:arcTo': {
          add(C.ARCANGLETO);
          coords.push([gl.param(c.attrs.get('wR') ?? '0'), gl.param(c.attrs.get('hR') ?? '0')]);
          const ang = (k: string, name: string) => [T.EQUATION, gl.set(`${name}${arcNum}`, `(${formulaParameter(gl.param(c.attrs.get(k) ?? '0'))})/60000.0`)] as [number, number];
          coords.push([ang('stAng', 'arctosa'), ang('swAng', 'arctosw')]);
          arcNum++;
          break;
        }
        case 'a:close':
          // ignore close after move to (as PowerPoint does)
          if (segments[segments.length - 1]?.[0] !== C.MOVETO) segments.push([C.CLOSESUBPATH, 0]);
          break;
      }
    }
    const fill = path.attrs.get('fill') ?? 'norm';
    const FILL: Record<string, number> = { none: C.NOFILL, darken: C.DARKEN, darkenLess: C.DARKENLESS, lighten: C.LIGHTEN, lightenLess: C.LIGHTENLESS };
    if (FILL[fill] !== undefined) segments.push([FILL[fill]!, 0]);
    if (['0', 'false'].includes(path.attrs.get('stroke') ?? '')) segments.push([C.NOSTROKE, 0]);
    segments.push([C.ENDSUBPATH, 0]);
  }
  if (!coords.length) return null;
  // If equations are defined they are processed in logic coordinates (a zero view box forces a
  // scale of 1); each arcTo adds two equations that do not count (tdf#113187).
  const viewBox: [number, number, number, number] = gl.guides.length - 2 * arcNum > 0 ? [0, 0, 0, 0] : [0, 0, cx, cy];
  const geom: CustomShapeGeometry = { viewBox, coords, segments, subViewSize, equations: gl.guides.map((g) => g.formula) };
  if (gl.adjust.length) { geom.adjust = gl.adjust; geom.adjustNames = gl.adjustNames; }
  const rect = child(custGeom, 'a:rect');
  if (rect) geom.textFrames = [[[gl.param(rect.attrs.get('l') ?? 'l'), gl.param(rect.attrs.get('t') ?? 't')], [gl.param(rect.attrs.get('r') ?? 'r'), gl.param(rect.attrs.get('b') ?? 'b')]]];
  return geom;
}

/**
 * ShapeExport::WriteCustomPolygon: a shape's evaluated outline (at its size in EMU) as a:custGeom,
 * one a:path per filled or stroked part.
 */
export function WriteCustGeom(objs: SdrPathObj[], w: number, h: number): string {
  const n = (v: number) => Math.round(v);
  const p = (x: number, y: number) => `<a:pt x="${n(x)}" y="${n(y)}"/>`;
  const paths = objs.map((o) => {
    let body = '';
    for (const poly of o.polys) {
      const pts = poly.pts;
      if (!pts.length) continue;
      body += `<a:moveTo>${p(pts[0]!.x, pts[0]!.y)}</a:moveTo>`;
      const seg = (a: (typeof pts)[number], b: (typeof pts)[number]) => {
        if (a.next || b.prev) body += `<a:cubicBezTo>${p(...(a.next ?? [a.x, a.y]))}${p(...(b.prev ?? [b.x, b.y]))}${p(b.x, b.y)}</a:cubicBezTo>`;
        else body += `<a:lnTo>${p(b.x, b.y)}</a:lnTo>`;
      };
      for (let k = 1; k < pts.length; k++) seg(pts[k - 1]!, pts[k]!);
      if (poly.closed) {
        // a:close draws the straight line back; only a curved closing segment needs its own.
        const a = pts[pts.length - 1]!, b = pts[0]!;
        if (a.next || b.prev) seg(a, b);
        body += '<a:close/>';
      }
    }
    return `<a:path w="${n(w)}" h="${n(h)}"${o.fill ? '' : ' fill="none"'}${o.stroke ? '' : ' stroke="0"'}>${body}</a:path>`;
  });
  return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="l" t="t" r="r" b="b"/><a:pathLst>${paths.join('')}</a:pathLst></a:custGeom>`;
}
