// Generates the custom shape preset geometry evaluated by the EnhancedCustomShape2d port:
//
// - src/lo/svx/source/customshapes/generated/EnhancedCustomShapeGeometry.json: LibreOffice's own
//   presets (svx/source/customshapes/EnhancedCustomShapeGeometry.cxx), keyed by their ODF type name
//   (svx/source/customshapes/EnhancedCustomShapeTypeNames.cxx), converted to the UNO form the way
//   SdrObjCustomShape::MergeDefaultAttributes (svx/source/svdraw/svdoashp.cxx) does at runtime.
// - src/lo/svx/source/customshapes/generated/oox-presets.json: the OOXML presets
//   (oox/source/drawingml/customshapes/oox-drawingml-cs-presets), keyed by "ooxml-<name>".
//
// Per shape: { viewBox, adjust?, equations?, coords, segments?, textFrames?, subViewSize?,
// stretchX?, stretchY?, sortFilledToBack?, mso? }. A parameter is a plain number for
// EnhancedCustomShapeParameterType::NORMAL, otherwise [Type, Value]. Handles and glue points are
// not generated.
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CORE, ROOT, requireCore } from './lib.ts';

requireCore();
const read = (p: string) => readFileSync(join(CORE, p), 'utf8');
const OUT_DIR = join(ROOT, 'src/lo/svx/source/customshapes/generated');

type Param = number | [number, number];
interface Geometry {
  viewBox: [number, number, number, number];
  adjust?: number[];
  adjustNames?: string[];
  equations?: string[];
  coords: [Param, Param][];
  segments?: [number, number][];
  textFrames?: [[Param, Param], [Param, Param]][];
  subViewSize?: [number, number][];
  stretchX?: number;
  stretchY?: number;
  sortFilledToBack?: false;
  mso?: number;
}

/** `const short NAME = value;` constants of an offapi .idl constant group. */
function idlConstants(path: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of read(path).matchAll(/const\s+short\s+(\w+)\s*=\s*(-?\d+)\s*;/g)) out[m[1]!] = Number(m[2]);
  return out;
}
const EnhancedCustomShapeSegmentCommand = idlConstants('offapi/com/sun/star/drawing/EnhancedCustomShapeSegmentCommand.idl');
const EnhancedCustomShapeParameterType = idlConstants('offapi/com/sun/star/drawing/EnhancedCustomShapeParameterType.idl');

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');

// --- include/svx/msdffdef.hxx: DFF_Prop_* and MSO_SPT ---------------------------------------------

const msdffdef = stripComments(read('include/svx/msdffdef.hxx'));
const DEFINES: Record<string, number> = {};
for (const m of msdffdef.matchAll(/^#define\s+(DFF_Prop_\w+)\s+(0x[0-9a-fA-F]+|\d+)\s*$/gm)) DEFINES[m[1]!] = Number(m[2]);
const MSO_SPT: Record<string, number> = {};
{
  const body = /enum\s+MSO_SPT\s*:\s*sal_Int32\s*\{([\s\S]*?)\};/.exec(msdffdef)![1]!;
  for (const m of body.matchAll(/(\w+)\s*=\s*(\w+)/g)) MSO_SPT[m[1]!] = m[2]! in MSO_SPT ? MSO_SPT[m[2]!]! : Number(m[2]);
}
const mso_sptNil = MSO_SPT['mso_sptNil']!;

// --- C expression evaluation (array initialisers) --------------------------------------------------

DEFINES['MIN_INT32'] = -2147483648;
const DOUBLES: Record<string, number> = { M_SQRT2: Math.SQRT2 };

/** A C value: integers follow C integer arithmetic, doubles appear only through M_SQRT2. */
interface CVal { v: number; int: boolean }
function evalC(src: string): number {
  // include/svx/EnhancedCustomShapeGeometry.hxx: #define MSO_I | sal_Int32(0x80000000)
  const text = src.replace(/\bMSO_I\b/g, '| sal_Int32(0x80000000)');
  // integer literal suffixes (`4l`) do not change the values here
  const toks = text.replace(/\b(0x[0-9a-fA-F]+|\d+)[uUlL]+\b/g, '$1').match(/0x[0-9a-fA-F]+|\d+(?:\.\d+)?|static_cast\s*<\s*\w+\s*>|\w+|[-+*/|()]/g) ?? [];
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++]!;
  const expect = (t: string) => { if (next() !== t) throw new Error(`expected ${t} in ${src}`); };
  const arith = (a: CVal, b: CVal, op: string): CVal => {
    const int = a.int && b.int;
    let v: number;
    switch (op) {
      case '+': v = a.v + b.v; break;
      case '-': v = a.v - b.v; break;
      case '*': v = a.v * b.v; break;
      default: v = a.v / b.v; if (int) v = Math.trunc(v);
    }
    return { v: int ? v | 0 : v, int };
  };
  function primary(): CVal {
    const t = next();
    if (t === '(') { const r = or(); expect(')'); return r; }
    if (t === '-') { const r = primary(); return { v: -r.v, int: r.int }; }
    if (t === '+') return primary();
    if (t.startsWith('static_cast')) { expect('('); const r = or(); expect(')'); return { v: Math.trunc(r.v) | 0, int: true }; }
    if (t === 'sal_Int32') { expect('('); const r = or(); expect(')'); return { v: Math.trunc(r.v) | 0, int: true }; }
    if (/^0x/i.test(t) || /^\d+$/.test(t)) return { v: Number(t), int: true };
    if (/^\d/.test(t)) return { v: Number(t), int: false };
    if (t in DEFINES) return { v: DEFINES[t]!, int: true };
    if (t in DOUBLES) return { v: DOUBLES[t]!, int: false };
    throw new Error(`unknown token ${t} in ${src}`);
  }
  function mul(): CVal {
    let a = primary();
    while (peek() === '*' || peek() === '/') { const op = next(); a = arith(a, primary(), op); }
    return a;
  }
  function add(): CVal {
    let a = mul();
    while (peek() === '+' || peek() === '-') { const op = next(); a = arith(a, mul(), op); }
    return a;
  }
  function or(): CVal {
    let a = add();
    while (peek() === '|') { next(); a = { v: a.v | add().v, int: true }; }
    return a;
  }
  const r = or();
  if (i !== toks.length) throw new Error(`trailing tokens in ${src}`);
  return r.v;
}

/** Splits at commas outside parentheses and angle-bracket template arguments. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '{') depth++;
    else if (ch === ')' || ch === '}') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// --- svx/source/customshapes/EnhancedCustomShapeGeometry.cxx -----------------------------------------

const geometry = stripComments(read('svx/source/customshapes/EnhancedCustomShapeGeometry.cxx'));
/** Every `const <Type> name[] = { ... };` array, flattened to its scalar elements. */
const ARRAYS = new Map<string, { type: string; values: number[] }>();
for (const m of geometry.matchAll(/^const\s+(\w+)\s+(\w+)\s*\[\s*\]\s*=\s*\{([\s\S]*?)^\};/gm)) {
  if (m[1] === 'SvxMSDffHandle') continue; // handles are not generated
  const values = m[3]!.replace(/[{}]/g, ' ').split(',').map((s) => s.trim()).filter(Boolean).map(evalC);
  ARRAYS.set(m[2]!, { type: m[1]!, values });
}
const STRIDE: Record<string, number> = { SvxMSDffVertPair: 2, SvxMSDffCalculationData: 4, SvxMSDffTextRectangles: 4, sal_Int32: 1, sal_uInt16: 1 };
function array(name: string | null, type: string): number[][] {
  if (!name) return [];
  const a = ARRAYS.get(name);
  if (!a) throw new Error(`array ${name} not found`);
  if (a.type !== type) throw new Error(`array ${name} is ${a.type}, expected ${type}`);
  const n = STRIDE[type]!;
  if (a.values.length % n) throw new Error(`array ${name} has ${a.values.length} values`);
  const out: number[][] = [];
  for (let i = 0; i < a.values.length; i += n) out.push(a.values.slice(i, i + n));
  return out;
}

interface mso_CustomShape {
  pVertices: number[][]; pElements: number[]; nElements: number; pCalculation: number[][];
  pDefData: number[] | null; pTextRect: number[][]; nCoordWidth: number; nCoordHeight: number;
  nXRef: number; nYRef: number;
}
const SHAPES = new Map<string, mso_CustomShape>();
for (const m of geometry.matchAll(/^const\s+mso_CustomShape\s+(\w+)\s*=\s*\{([\s\S]*?)^\};/gm)) {
  const f = splitTop(m[2]!);
  if (f.length !== 12) throw new Error(`${m[1]}: ${f.length} fields`);
  const ref = (s: string): string | null => {
    if (s === 'nullptr' || s === '0') return null;
    const r = /^(?:std::span<[^>]*>|const_cast<[^>]*>)\s*\(\s*(\w*)\s*\)$/.exec(s);
    if (!r) throw new Error(`${m[1]}: ${s}`);
    return r[1] || null;
  };
  const sizeOf = /^sizeof\s*\(\s*(\w+)\s*\)\s*>>\s*1$/.exec(f[2]!);
  SHAPES.set(m[1]!, {
    pVertices: array(ref(f[0]!), 'SvxMSDffVertPair'),
    pElements: array(ref(f[1]!), 'sal_uInt16').flat(),
    nElements: sizeOf ? array(sizeOf[1]!, 'sal_uInt16').length : evalC(f[2]!),
    pCalculation: array(ref(f[3]!), 'SvxMSDffCalculationData'),
    pDefData: ref(f[4]!) ? array(ref(f[4]!), 'sal_Int32').flat() : null,
    pTextRect: array(ref(f[5]!), 'SvxMSDffTextRectangles'),
    nCoordWidth: evalC(f[6]!), nCoordHeight: evalC(f[7]!), nXRef: evalC(f[8]!), nYRef: evalC(f[9]!),
  });
}

/** GetCustomShapeContent: MSO_SPT value -> struct name, with fall-through case labels. */
const CONTENT = new Map<number, string>();
{
  const body = /GetCustomShapeContent\s*\(\s*MSO_SPT\s+eSpType\s*\)\s*\{([\s\S]*?)return\s+pCustomShape;/.exec(geometry)![1]!;
  let pending: number[] = [];
  for (const m of body.matchAll(/case\s+(\w+)\s*:|pCustomShape\s*=\s*&(\w+)\s*;|default\s*:|\bbreak\s*;/g)) {
    if (m[1]) { pending.push(MSO_SPT[m[1]] ?? (() => { throw new Error(`unknown ${m[1]}`); })()); continue; }
    if (m[2]) { for (const t of pending) CONTENT.set(t, m[2]); }
    pending = [];
  }
}

/** msoSortFilledObjectsToBackTable / SortFilledObjectsToBackByDefault. */
const msoSortFilledObjectsToBackTable = ARRAYS.get('msoSortFilledObjectsToBackTable')!.values;
function SortFilledObjectsToBackByDefault(eSpType: number): boolean {
  let bSortFilledObjectsToBackByDefault = true;
  const i = eSpType >>> 0;
  if (i < 0x100)
    bSortFilledObjectsToBackByDefault = (msoSortFilledObjectsToBackTable[i >> 4]! & (1 << (i & 0xf))) !== 0;
  return bSortFilledObjectsToBackByDefault;
}

// --- svx/source/customshapes/EnhancedCustomShape2d.cxx -----------------------------------------------

function SetEnhancedCustomShapeParameter(nValue: number): Param {
  const nDat = nValue >>> 0;
  let nNewValue = nValue | 0;

  // check if this is a special point
  if ((nDat >>> 16) === 0x8000) {
    nNewValue = nDat & 0xffff;
    return [EnhancedCustomShapeParameterType['EQUATION']!, nNewValue];
  }
  return nNewValue;
}

function GetEquation(nFlags: number, nP1: number, nP2: number, nP3: number): string {
  const r = { s: '' };
  const b1Special = (nFlags & 0x2000) !== 0;
  const b2Special = (nFlags & 0x4000) !== 0;
  const b3Special = (nFlags & 0x8000) !== 0;
  const A = (nPara: number, bSpecial: boolean) => AppendEnhancedCustomShapeEquationParameter(r, nPara, bSpecial);
  switch (nFlags & 0xff) {
    case 0:
    case 14: {
      let nOptimize = 0;
      if (nP1) nOptimize |= 1;
      if (nP2) nOptimize |= 2;
      if (b1Special) nOptimize |= 4;
      if (b2Special) nOptimize |= 8;
      switch (nOptimize) {
        case 0:
          break;
        case 1:
        case 4:
        case 5:
          A(nP1, b1Special);
          break;
        case 2:
        case 8:
        case 10:
          A(nP2, b2Special);
          break;
        default: {
          A(nP1, b1Special);
          r.s += '+';
          A(nP2, b2Special);
        }
          break;
      }
      if (b3Special || nP3) {
        r.s += '-';
        A(nP3, b3Special);
      }
    }
      break;
    case 1: {
      A(nP1, b1Special);
      if (b2Special || (nP2 !== 1)) {
        r.s += '*';
        A(nP2, b2Special);
      }
      if (b3Special || ((nP3 !== 1) && (nP3 !== 0))) {
        r.s += '/';
        A(nP3, b3Special);
      }
    }
      break;
    case 2: {
      r.s += '(';
      A(nP1, b1Special);
      r.s += '+';
      A(nP2, b2Special);
      r.s += ')/2';
    }
      break;
    case 3: {
      r.s += 'abs(';
      A(nP1, b1Special);
      r.s += ')';
    }
      break;
    case 4: {
      r.s += 'min(';
      A(nP1, b1Special);
      r.s += ',';
      A(nP2, b2Special);
      r.s += ')';
    }
      break;
    case 5: {
      r.s += 'max(';
      A(nP1, b1Special);
      r.s += ',';
      A(nP2, b2Special);
      r.s += ')';
    }
      break;
    case 6: {
      r.s += 'if(';
      A(nP1, b1Special);
      r.s += ',';
      A(nP2, b2Special);
      r.s += ',';
      A(nP3, b3Special);
      r.s += ')';
    }
      break;
    case 7: {
      r.s += 'sqrt(';
      A(nP1, b1Special);
      r.s += '*';
      A(nP1, b1Special);
      r.s += '+';
      A(nP2, b2Special);
      r.s += '*';
      A(nP2, b2Special);
      r.s += '+';
      A(nP3, b3Special);
      r.s += '*';
      A(nP3, b3Special);
      r.s += ')';
    }
      break;
    case 8: {
      r.s += 'atan2(';
      A(nP2, b2Special);
      r.s += ',';
      A(nP1, b1Special);
      r.s += ')/(pi/180)';
    }
      break;
    case 9: {
      A(nP1, b1Special);
      r.s += '*sin(';
      A(nP2, b2Special);
      r.s += '*(pi/180))';
    }
      break;
    case 10: {
      A(nP1, b1Special);
      r.s += '*cos(';
      A(nP2, b2Special);
      r.s += '*(pi/180))';
    }
      break;
    case 11: {
      A(nP1, b1Special);
      r.s += '*cos(atan2(';
      A(nP3, b3Special);
      r.s += ',';
      A(nP2, b2Special);
      r.s += '))';
    }
      break;
    case 12: {
      A(nP1, b1Special);
      r.s += '*sin(atan2(';
      A(nP3, b3Special);
      r.s += ',';
      A(nP2, b2Special);
      r.s += '))';
    }
      break;
    case 13: {
      r.s += 'sqrt(';
      A(nP1, b1Special);
      r.s += ')';
    }
      break;
    case 15: {
      A(nP3, b3Special);
      r.s += '*sqrt(1-(';
      A(nP1, b1Special);
      r.s += '/';
      A(nP2, b2Special);
      r.s += ')' + '*(';
      A(nP1, b1Special);
      r.s += '/';
      A(nP2, b2Special);
      r.s += '))';
    }
      break;
    case 16: {
      A(nP1, b1Special);
      r.s += '*tan(';
      A(nP2, b2Special);
      r.s += ')';
    }
      break;
    case 0x80: {
      r.s += 'sqrt(';
      A(nP3, b3Special);
      r.s += '*';
      A(nP3, b3Special);
      r.s += '-';
      A(nP1, b1Special);
      r.s += '*';
      A(nP1, b1Special);
      r.s += ')';
    }
      break;
    case 0x81: {
      r.s += '(cos(';
      A(nP3, b3Special);
      r.s += '*(pi/180))*(';
      A(nP1, b1Special);
      r.s += '-10800)+sin(';
      A(nP3, b3Special);
      r.s += '*(pi/180))*(';
      A(nP2, b2Special);
      r.s += '-10800))+10800';
    }
      break;
    case 0x82: {
      r.s += '-(sin(';
      A(nP3, b3Special);
      r.s += '*(pi/180))*(';
      A(nP1, b1Special);
      r.s += '-10800)-cos(';
      A(nP3, b3Special);
      r.s += '*(pi/180))*(';
      A(nP2, b2Special);
      r.s += '-10800))+10800';
    }
      break;
  }
  return r.s;
}

function AppendEnhancedCustomShapeEquationParameter(rParameter: { s: string }, nPara: number, bIsSpecialValue: boolean): void {
  if (bIsSpecialValue) {
    if (nPara & 0x400) {
      rParameter.s += '?';
      rParameter.s += String(nPara & 0xff);
      rParameter.s += ' ';
    } else {
      switch (nPara) {
        case DEFINES['DFF_Prop_adjustValue']:
        case DEFINES['DFF_Prop_adjust2Value']:
        case DEFINES['DFF_Prop_adjust3Value']:
        case DEFINES['DFF_Prop_adjust4Value']:
        case DEFINES['DFF_Prop_adjust5Value']:
        case DEFINES['DFF_Prop_adjust6Value']:
        case DEFINES['DFF_Prop_adjust7Value']:
        case DEFINES['DFF_Prop_adjust8Value']:
        case DEFINES['DFF_Prop_adjust9Value']:
        case DEFINES['DFF_Prop_adjust10Value']: {
          rParameter.s += '$';
          rParameter.s += String(nPara - DEFINES['DFF_Prop_adjustValue']!);
          rParameter.s += ' ';
        }
          break;
        case DEFINES['DFF_Prop_geoLeft']: {
          rParameter.s += 'left';
        }
          break;
        case DEFINES['DFF_Prop_geoTop']: {
          rParameter.s += 'top';
        }
          break;
        case DEFINES['DFF_Prop_geoRight']: {
          rParameter.s += 'right';
        }
          break;
        case DEFINES['DFF_Prop_geoBottom']: {
          rParameter.s += 'bottom';
        }
          break;
      }
    }
  } else {
    rParameter.s += String(nPara);
  }
}

// --- svx/source/svdraw/svdoashp.cxx ------------------------------------------------------------------

function lcl_ShapeSegmentFromBinary(nSDat: number): [number, number] {
  const C = EnhancedCustomShapeSegmentCommand;
  let Command: number, Count: number;
  switch (nSDat >> 8) {
    case 0x00:
      Command = C['LINETO']!;
      Count = nSDat & 0xff;
      if (!Count) Count = 1;
      break;
    case 0x20:
      Command = C['CURVETO']!;
      Count = nSDat & 0xff;
      if (!Count) Count = 1;
      break;
    case 0x40:
      Command = C['MOVETO']!;
      Count = nSDat & 0xff;
      if (!Count) Count = 1;
      break;
    case 0x60:
      Command = C['CLOSESUBPATH']!;
      Count = 0;
      break;
    case 0x80:
      Command = C['ENDSUBPATH']!;
      Count = 0;
      break;
    case 0xa1:
      Command = C['ANGLEELLIPSETO']!;
      Count = Math.trunc((nSDat & 0xff) / 3);
      break;
    case 0xa2:
      Command = C['ANGLEELLIPSE']!;
      Count = Math.trunc((nSDat & 0xff) / 3);
      break;
    case 0xa3:
      Command = C['ARCTO']!;
      Count = (nSDat & 0xff) >> 2;
      break;
    case 0xa4:
      Command = C['ARC']!;
      Count = (nSDat & 0xff) >> 2;
      break;
    case 0xa5:
      Command = C['CLOCKWISEARCTO']!;
      Count = (nSDat & 0xff) >> 2;
      break;
    case 0xa6:
      Command = C['CLOCKWISEARC']!;
      Count = (nSDat & 0xff) >> 2;
      break;
    case 0xa7:
      Command = C['ELLIPTICALQUADRANTX']!;
      Count = nSDat & 0xff;
      break;
    case 0xa8:
      Command = C['ELLIPTICALQUADRANTY']!;
      Count = nSDat & 0xff;
      break;
    case 0xaa:
      Command = C['NOFILL']!;
      Count = 0;
      break;
    case 0xab:
      Command = C['NOSTROKE']!;
      Count = 0;
      break;
    default:
    case 0xf8:
      Command = C['UNKNOWN']!;
      // Count is a sal_Int16
      Count = (nSDat << 16) >> 16;
      break;
  }
  return [Command, Count];
}

const DEFAULT_MINIMUM_SIGNED_COMPARE = -2147483648; // sal_Int32(0x80000000)

/** The defaults SdrObjCustomShape::MergeDefaultAttributes sets on a shape without geometry. */
function MergeDefaultAttributes(eSpType: number, pDefCustomShape: mso_CustomShape): Geometry {
  const g: Partial<Geometry> = {};
  // AdjustmentValues
  if (pDefCustomShape.pDefData) {
    const nAdjustmentDefaults = pDefCustomShape.pDefData[0]!;
    const adjust: number[] = [];
    for (let i = 0; i < nAdjustmentDefaults; i++) adjust.push(pDefCustomShape.pDefData[1 + i]!);
    if (adjust.length) g.adjust = adjust;
  }
  // Coordsize
  g.viewBox = [0, 0, pDefCustomShape.nCoordWidth, pDefCustomShape.nCoordHeight];
  // Path/Coordinates
  g.coords = pDefCustomShape.pVertices.map(([a, b]) => [SetEnhancedCustomShapeParameter(a!), SetEnhancedCustomShapeParameter(b!)]);
  // Path/Segments
  if (pDefCustomShape.nElements && pDefCustomShape.pElements.length) {
    g.segments = [];
    for (let i = 0; i < pDefCustomShape.nElements; i++) g.segments.push(lcl_ShapeSegmentFromBinary(pDefCustomShape.pElements[i]!));
  }
  // Path/StretchX, Path/StretchY
  if (pDefCustomShape.nXRef !== DEFAULT_MINIMUM_SIGNED_COMPARE) g.stretchX = pDefCustomShape.nXRef;
  if (pDefCustomShape.nYRef !== DEFAULT_MINIMUM_SIGNED_COMPARE) g.stretchY = pDefCustomShape.nYRef;
  // Path/TextFrames
  if (pDefCustomShape.pTextRect.length)
    g.textFrames = pDefCustomShape.pTextRect.map(([a, b, c, d]) => [
      [SetEnhancedCustomShapeParameter(a!), SetEnhancedCustomShapeParameter(b!)],
      [SetEnhancedCustomShapeParameter(c!), SetEnhancedCustomShapeParameter(d!)],
    ]);
  // Equations
  if (pDefCustomShape.pCalculation.length)
    g.equations = pDefCustomShape.pCalculation.map(([f, p1, p2, p3]) => GetEquation(f! & 0xffff, p1!, p2!, p3!));
  if (!SortFilledObjectsToBackByDefault(eSpType)) g.sortFilledToBack = false;
  g.mso = eSpType;
  return order(g as Geometry);
}

const KEYS = ['viewBox', 'adjust', 'adjustNames', 'equations', 'coords', 'segments', 'textFrames', 'subViewSize', 'stretchX', 'stretchY', 'sortFilledToBack', 'mso'] as const;
function order(g: Geometry): Geometry {
  const o: Record<string, unknown> = {};
  for (const k of KEYS) if (g[k] !== undefined) o[k] = g[k];
  return o as unknown as Geometry;
}

// --- svx/source/customshapes/EnhancedCustomShapeTypeNames.cxx ----------------------------------------

const typeNames = stripComments(read('svx/source/customshapes/EnhancedCustomShapeTypeNames.cxx'));
const TYPE_MAP = new Map<string, number>(); // GetTypeNameHashMap: later entries win
{
  const body = /pNameTypeTableArray\[\]\s*=\s*\{([\s\S]*?)\};/.exec(typeNames)![1]!;
  for (const m of body.matchAll(/\{\s*u"([^"]+)"_ustr\s*,\s*(\w+)\s*\}/g)) {
    const v = MSO_SPT[m[2]!];
    if (v === undefined) throw new Error(`unknown ${m[2]}`);
    TYPE_MAP.set(m[1]!, v);
  }
}
const GetType = (rShapeType: string) => TYPE_MAP.get(rShapeType) ?? mso_sptNil;

const odf: Record<string, Geometry> = {};
const skipped: string[] = [];
for (const [name, eSpType] of TYPE_MAP) {
  const struct = CONTENT.get(eSpType);
  if (name.startsWith('ooxml-')) { skipped.push(`${name} (in oox-presets.json)`); continue; }
  if (!struct) { skipped.push(name); continue; }
  const shape = SHAPES.get(struct);
  if (!shape) throw new Error(`struct ${struct} not found`);
  odf[name] = MergeDefaultAttributes(eSpType, shape);
}

// --- oox/source/drawingml/customshapes/oox-drawingml-cs-presets -------------------------------------

/** Parses the UNO value dump: `(type) value`, `{ a, b }`, `{ Name = value, ... }`, strings, numbers. */
function parseUno(src: string): unknown {
  let i = 0;
  const ws = () => { while (/\s/.test(src[i] ?? '')) i++; };
  function value(): unknown {
    ws();
    const c = src[i];
    if (c === '(') {
      const end = src.indexOf(')', i);
      const type = src.slice(i + 1, end);
      i = end + 1;
      const v = value();
      return type === 'any' ? (v as unknown[])[0] : v;
    }
    if (c === '{') {
      i++;
      const items: unknown[] = [];
      const named: Record<string, unknown> = {};
      let isNamed = false;
      for (;;) {
        ws();
        if (src[i] === '}') { i++; break; }
        // The rtTriangle glue points contain an empty element (`}, , {`); skip it.
        if (src[i] === ',') { i++; continue; }
        const m = /^(\w+)\s*=/.exec(src.slice(i, i + 64));
        if (m) { i += m[0].length; isNamed = true; named[m[1]!] = value(); } else items.push(value());
        ws();
        if (src[i] === ',') i++;
      }
      return isNamed ? named : items;
    }
    if (c === '"') {
      let s = '';
      for (i++; src[i] !== '"'; i++) s += src[i] === '\\' ? src[++i] : src[i];
      i++;
      return s;
    }
    const m = /^[-\w.+]+/.exec(src.slice(i));
    if (!m) throw new Error(`cannot parse at ${src.slice(i - 80, i + 80)}`);
    i += m[0].length;
    return /^-?\d/.test(m[0]) ? Number(m[0]) : m[0];
  }
  const v = value();
  return v;
}

interface UnoParam { Value: number; Type: number }
const param = (p: UnoParam): Param => (p.Type === EnhancedCustomShapeParameterType['NORMAL'] ? p.Value : [p.Type, p.Value]);
const pair = (p: { First: UnoParam; Second: UnoParam }): [Param, Param] => [param(p.First), param(p.Second)];

const oox: Record<string, Geometry> = {};
{
  const lines = read('oox/source/drawingml/customshapes/oox-drawingml-cs-presets').split('\n');
  let name = '';
  let props: Record<string, unknown> = {};
  const flush = () => {
    if (!name) return;
    const key = `ooxml-${name}`;
    const g: Partial<Geometry> = {};
    const vb = props['ViewBox'] as { X: number; Y: number; Width: number; Height: number };
    g.viewBox = [vb.X, vb.Y, vb.Width, vb.Height];
    const adj = props['AdjustmentValues'] as { Value: number; Name?: string }[];
    if (adj.length) g.adjust = adj.map((a) => a.Value);
    // The guide names (adj, adj1, hf, ...) that a:avLst refers to.
    if (adj.length && adj.some((a) => a.Name)) g.adjustNames = adj.map((a) => a.Name ?? '');
    const eq = props['Equations'] as string[];
    if (eq.length) g.equations = eq;
    const path: Record<string, unknown> = {};
    for (const p of props['Path'] as { Name: string; Value: unknown }[]) path[p.Name] = p.Value;
    g.coords = ((path['Coordinates'] ?? []) as { First: UnoParam; Second: UnoParam }[]).map(pair);
    const seg = (path['Segments'] ?? []) as { Command: number; Count: number }[];
    if (seg.length) g.segments = seg.map((s) => [s.Command, s.Count]);
    const tf = (path['TextFrames'] ?? []) as { TopLeft: never; BottomRight: never }[];
    if (tf.length) g.textFrames = tf.map((t) => [pair(t.TopLeft), pair(t.BottomRight)]);
    const sv = (path['SubViewSize'] ?? []) as { Width: number; Height: number }[];
    if (sv.length) g.subViewSize = sv.map((s) => [s.Width, s.Height]);
    if (typeof path['StretchX'] === 'number') g.stretchX = path['StretchX'];
    if (typeof path['StretchY'] === 'number') g.stretchY = path['StretchY'];
    if (!SortFilledObjectsToBackByDefault(GetType(key))) g.sortFilledToBack = false;
    oox[key] = order(g as Geometry);
  };
  for (let l = 0; l < lines.length; l++) {
    const line = lines[l]!;
    const head = /^\/\* (\S+) \*\/$/.exec(line);
    if (head) { flush(); name = head[1]!; props = {}; continue; }
    if (/^\w+$/.test(line)) props[line] = parseUno(lines[++l]!);
  }
  flush();
}

mkdirSync(OUT_DIR, { recursive: true });
const write = (file: string, data: unknown) => {
  const p = join(OUT_DIR, file);
  writeFileSync(p, `${JSON.stringify(data)}\n`);
  return statSync(p).size;
};
const s1 = write('EnhancedCustomShapeGeometry.json', odf);
const s2 = write('oox-presets.json', oox);
// msfilter::util::GetOOXMLPresetGeometry: the OOXML preset an ODF shape type is exported as.
const utilSrc = readFileSync(join(CORE, 'filter/source/msfilter/util.cxx'), 'utf8');
const fnStart = utilSrc.indexOf('OString GetOOXMLPresetGeometry');
const fnBody = utilSrc.slice(fnStart, utilSrc.indexOf('\n}', fnStart));
const toOoxml: Record<string, string> = {};
for (const m of fnBody.matchAll(/^\s*\{\s*u"([^"]+)",\s*"([^"]+)"\s*\}/gm)) toOoxml[m[1]!] = m[2]!;
write('odf-to-ooxml.json', toOoxml);
console.log(`${Object.keys(toOoxml).length} ODF types with an OOXML preset`);
console.log(`${Object.keys(odf).length} ODF custom shapes (${s1} bytes), ${Object.keys(oox).length} OOXML presets (${s2} bytes)`);
console.log(`skipped (no mso_CustomShape): ${skipped.join(', ')}`);
