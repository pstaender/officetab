// SPDX-License-Identifier: MPL-2.0
// @upstream xmloff/source/draw/ximpcustomshape.cxx reduced
// @upstream xmloff/source/draw/shapeexport.cxx reduced
// draw:enhanced-geometry in both directions: type, view box, modifiers (adjustment values),
// mirroring, the enhanced path, equations and text areas. Handles, glue points, extrusion and
// Fontwork attributes are neither read nor written.
import { childElements, type XmlElement } from '../core/xmlparse.ts';
import { EnhancedCustomShapeParameterType as T, EnhancedCustomShapeSegmentCommand as C, type CustomShapeGeometry, type EnhancedCustomShapeParameter, type EnhancedCustomShapeParameterPair } from '../../../svx/source/customshapes/EnhancedCustomShape2d.ts';

/** Path command letters: the segment command and the number of coordinate pairs per segment. */
const COMMANDS: Record<string, [number, number]> = {
  M: [C.MOVETO, 1], L: [C.LINETO, 1], C: [C.CURVETO, 3], Z: [C.CLOSESUBPATH, 0], N: [C.ENDSUBPATH, 0],
  F: [C.NOFILL, 0], S: [C.NOSTROKE, 0], T: [C.ANGLEELLIPSETO, 3], U: [C.ANGLEELLIPSE, 3], A: [C.ARCTO, 4],
  B: [C.ARC, 4], G: [C.ARCANGLETO, 2], H: [C.DARKEN, 0], I: [C.DARKENLESS, 0], J: [C.LIGHTEN, 0],
  K: [C.LIGHTENLESS, 0], W: [C.CLOCKWISEARCTO, 4], V: [C.CLOCKWISEARC, 4], X: [C.ELLIPTICALQUADRANTX, 1],
  Y: [C.ELLIPTICALQUADRANTY, 1], Q: [C.QUADRATICCURVETO, 2],
};
const LETTER: Record<number, string> = Object.fromEntries(Object.entries(COMMANDS).map(([l, [c]]) => [c, l]));
const KEYWORDS: Record<string, number> = {
  left: T.LEFT, top: T.TOP, right: T.RIGHT, bottom: T.BOTTOM, xstretch: T.XSTRETCH, ystretch: T.YSTRETCH,
  hasstroke: T.HASSTROKE, hasfill: T.HASFILL, width: T.WIDTH, height: T.HEIGHT, logwidth: T.LOGWIDTH, logheight: T.LOGHEIGHT,
};
const KEYWORD_OF: Record<number, string> = Object.fromEntries(Object.entries(KEYWORDS).map(([k, v]) => [v, k]));

/** GetNextParameter: a number, ?equation, $modifier or keyword. */
function readParameter(tok: string, equations: Map<string, number>): EnhancedCustomShapeParameter | null {
  if (tok.startsWith('$')) return [T.ADJUSTMENT, parseInt(tok.slice(1), 10) || 0];
  if (tok.startsWith('?')) { const i = equations.get(tok.slice(1)); return i === undefined ? null : [T.EQUATION, i]; }
  if (tok in KEYWORDS) return [KEYWORDS[tok]!, 0];
  const v = parseFloat(tok);
  return Number.isFinite(v) ? v : null;
}

/** The text of an enhanced path's or text area's parameters, with ?name references resolved. */
function readPairs(s: string, equations: Map<string, number>): EnhancedCustomShapeParameterPair[] | null {
  const toks = s.trim().split(/[\s,]+/).filter(Boolean);
  const out: EnhancedCustomShapeParameterPair[] = [];
  for (let k = 0; k + 1 < toks.length; k += 2) {
    const a = readParameter(toks[k]!, equations), b = readParameter(toks[k + 1]!, equations);
    if (a === null || b === null) return null;
    out.push([a, b]);
  }
  return out;
}

/** GetEnhancedPath */
function readPath(s: string, equations: Map<string, number>): { coords: EnhancedCustomShapeParameterPair[]; segments: [number, number][] } | null {
  const coords: EnhancedCustomShapeParameterPair[] = [];
  const segments: [number, number][] = [];
  let cmd: number = C.MOVETO, need = 1, pairs = 0;
  let pending: string | null = null;
  // Tokens: equation and modifier references, numbers (with exponents), then words (commands, keywords).
  for (const tok of s.match(/\?[A-Za-z0-9]+|\$\d+|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[A-Za-z]+/g) ?? []) {
    if (/^[A-Z]$/.test(tok) && COMMANDS[tok]) {
      [cmd, need] = COMMANDS[tok]!;
      pairs = 0;
      // Commands without coordinates are segments of their own.
      if (!need) segments.push([cmd, 0]);
      continue;
    }
    if (/^[a-z]+$/.test(tok) && !(tok in KEYWORDS)) return null;
    if (pending === null) { pending = tok; continue; }
    const pair = readPairs(`${pending} ${tok}`, equations);
    pending = null;
    if (!pair) return null;
    coords.push(pair[0]!);
    if (++pairs < need) continue;
    pairs = 0;
    // ODF 1.2 19.145: further coordinate pairs after a moveto are linetos.
    if (cmd === C.MOVETO) { segments.push([C.MOVETO, 1]); cmd = C.LINETO; need = 1; continue; }
    // A repeated command may leave out its letter: the last segment counts one more.
    const last = segments[segments.length - 1];
    if (last && last[0] === cmd) last[1]++;
    else segments.push([cmd, 1]);
  }
  return { coords, segments };
}

export interface ImportedCustomShape { sType: string; aGeometry?: CustomShapeGeometry; aAdjust?: number[]; bFlipH: boolean; bFlipV: boolean; bTextPath?: boolean }

/** XMLEnhancedCustomShapeContext: the shape type, and its own geometry when it has a path. */
export function ImportEnhancedGeometry(el: XmlElement): ImportedCustomShape {
  const a = (k: string) => el.attrs.get(k);
  const sType = a('draw:type') ?? 'non-primitive';
  const aAdjust = a('draw:modifiers')?.trim().split(/\s+/).map(Number).filter(Number.isFinite);
  const out: ImportedCustomShape = { sType, bFlipH: a('draw:mirror-horizontal') === 'true', bFlipV: a('draw:mirror-vertical') === 'true' };
  if (aAdjust?.length) out.aAdjust = aAdjust;
  // draw:text-path: Fontwork (the shape shows its text along its path).
  if (a('draw:text-path') === 'true') out.bTextPath = true;
  const path = a('draw:enhanced-path');
  if (path) {
    // Equations are referred to by name; the model refers to them by index.
    const eqEls = childElements(el).filter((e) => e.name === 'draw:equation');
    const names = new Map(eqEls.map((e, i) => [e.attrs.get('draw:name') ?? `f${i}`, i]));
    const equations = eqEls.map((e) => (e.attrs.get('draw:formula') ?? '0').replace(/\?([A-Za-z0-9]+)/g, (m, n: string) => (names.has(n) ? `?${names.get(n)} ` : m)));
    const p = readPath(path, names);
    if (p && p.coords.length) {
      const vb = (a('svg:viewBox') ?? '0 0 21600 21600').trim().split(/\s+/).map(Number);
      const geom: CustomShapeGeometry = { viewBox: [vb[0] ?? 0, vb[1] ?? 0, vb[2] ?? 21600, vb[3] ?? 21600], coords: p.coords, segments: p.segments };
      if (equations.length) geom.equations = equations;
      if (aAdjust?.length) geom.adjust = aAdjust;
      const ta = a('draw:text-areas');
      const pairs = ta ? readPairs(ta, names) : null;
      if (pairs && pairs.length >= 2) {
        const frames: [EnhancedCustomShapeParameterPair, EnhancedCustomShapeParameterPair][] = [];
        for (let k = 0; k + 1 < pairs.length; k += 2) frames.push([pairs[k]!, pairs[k + 1]!]);
        geom.textFrames = frames;
      }
      out.aGeometry = geom;
    }
  }
  return out;
}

const writeParameter = (p: EnhancedCustomShapeParameter): string => {
  if (typeof p === 'number') return String(Math.round(p * 1000) / 1000);
  const [t, v] = p;
  if (t === T.EQUATION) return `?f${v}`;
  if (t === T.ADJUSTMENT) return `$${v}`;
  if (t === T.NORMAL) return String(v);
  return KEYWORD_OF[t] ?? '0';
};

/** XMLEnhancedCustomShapeContext's counterpart (ImpExportEnhancedGeometry) for a shape's geometry. */
export function ExportEnhancedGeometry(sType: string, geom: CustomShapeGeometry, adjust: number[] | undefined, flipH: boolean, flipV: boolean, textPath = false): string {
  const attrs: string[] = [`svg:viewBox="${geom.viewBox.join(' ')}"`, `draw:type="${sType}"`];
  // The TextPath properties of a watermark (SwEditShell::SetWatermark with the plain text defaults).
  if (textPath) attrs.push('draw:text-path="true" draw:text-path-mode="normal" draw:text-path-scale="path" draw:text-path-same-letter-heights="false"');
  const mods = geom.adjust?.map((v, k) => adjust?.[k] ?? v);
  if (mods?.length) attrs.push(`draw:modifiers="${mods.join(' ')}"`);
  if (flipH) attrs.push('draw:mirror-horizontal="true"');
  if (flipV) attrs.push('draw:mirror-vertical="true"');
  const segs = geom.segments?.length ? geom.segments : [[C.MOVETO, 1], [C.LINETO, Math.max(0, geom.coords.length - 1)], [C.CLOSESUBPATH, 0]] as [number, number][];
  const PAIRS: Record<number, number> = Object.fromEntries(Object.values(COMMANDS).map(([c, n]) => [c, n]));
  const out: string[] = [];
  let k = 0;
  for (const [cmd, count] of segs) {
    const letter = LETTER[cmd];
    if (!letter) continue;
    out.push(letter);
    const n = (PAIRS[cmd] ?? 0) * count;
    for (let j = 0; j < n && k < geom.coords.length; j++, k++) out.push(`${writeParameter(geom.coords[k]![0])} ${writeParameter(geom.coords[k]![1])}`);
  }
  attrs.push(`draw:enhanced-path="${out.join(' ')}"`);
  if (geom.textFrames?.length) attrs.push(`draw:text-areas="${geom.textFrames.flatMap(([tl, br]) => [tl, br]).map(([x, y]) => `${writeParameter(x)} ${writeParameter(y)}`).join(' ')}"`);
  const eqs = (geom.equations ?? []).map((f, i) => `<draw:equation draw:name="f${i}" draw:formula="${f.replace(/\?(\d+)\s?/g, '?f$1 ').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').trim()}"/>`).join('');
  return `<draw:enhanced-geometry ${attrs.join(' ')}>${eqs}</draw:enhanced-geometry>`;
}
