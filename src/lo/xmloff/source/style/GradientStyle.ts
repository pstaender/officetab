// SPDX-License-Identifier: MPL-2.0
// @upstream xmloff/source/style/GradientStyle.cxx partial
// XMLGradientStyleImport::importXML and XMLGradientStyleExport::exportXML: draw:gradient with
// its loext:gradient-stop children (LibreOffice's multi-colour gradients).
import { childElements, type XmlElement } from '../core/xmlparse.ts';
import type { BColorStop, BGradient, GradientStyle } from '../../../basegfx/source/tools/gradienttools.ts';

const STYLES: GradientStyle[] = ['linear', 'axial', 'radial', 'ellipsoid', 'square', 'rectangular'];
const percent = (v: string | undefined, d: number) => (v === undefined ? d : parseFloat(v));

/**
 * sax::Converter::convert10thDegAngle: "deg", "rad" and "grad" have their units; a bare number is
 * 10th of degrees, as OOo and LibreOffice wrote it (isWrongOOo10thDegAngle).
 */
function convert10thDegAngle(v: string | undefined): number {
  if (!v) return 0;
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 0;
  const a = /deg$/.test(v) ? n * 10 : /grad$/.test(v) ? n * 9 : /rad$/.test(v) ? (n * 1800) / Math.PI : n;
  return ((Math.round(a) % 3600) + 3600) % 3600;
}

/** XMLGradientStyleImport::importXML */
export function ImportGradientStyle(el: XmlElement): BGradient {
  const a = (k: string) => el.attrs.get(k);
  const style = (a('draw:style') ?? 'linear') as GradientStyle;
  let aColorStops: BColorStop[] = childElements(el).filter((c) => c.name === 'loext:gradient-stop').map((s) => ({ fStopOffset: Math.min(1, Math.max(0, parseFloat(s.attrs.get('svg:offset') ?? '0'))), aStopColor: s.attrs.get('loext:color-value') ?? '#000000' }));
  // Without stops (ODF 1.3) start and end colour.
  if (!aColorStops.length) aColorStops = [{ fStopOffset: 0, aStopColor: a('draw:start-color') ?? '#000000' }, { fStopOffset: 1, aStopColor: a('draw:end-color') ?? '#ffffff' }];
  return {
    eStyle: STYLES.includes(style) ? style : 'linear',
    aColorStops,
    nAngle: convert10thDegAngle(a('draw:angle')),
    nBorder: percent(a('draw:border'), 0),
    nOffsetX: percent(a('draw:cx'), 50),
    nOffsetY: percent(a('draw:cy'), 50),
    nIntensStart: percent(a('draw:start-intensity'), 100),
    nIntensEnd: percent(a('draw:end-intensity'), 100),
    nStepCount: 0,
  };
}

/** XMLGradientStyleExport::exportXML (ODF 1.3 extended: the colour stops as well). */
export function ExportGradientStyle(g: BGradient, name: string): string {
  const s = g.aColorStops;
  const attrs = [`draw:name="${name}"`, `draw:style="${g.eStyle}"`];
  if (g.eStyle !== 'linear' && g.eStyle !== 'axial') attrs.push(`draw:cx="${g.nOffsetX}%"`, `draw:cy="${g.nOffsetY}%"`);
  attrs.push(`draw:start-color="${s[0]?.aStopColor ?? '#000000'}"`, `draw:end-color="${s[s.length - 1]?.aStopColor ?? '#000000'}"`);
  attrs.push(`draw:start-intensity="${g.nIntensStart}%"`, `draw:end-intensity="${g.nIntensEnd}%"`);
  if (g.eStyle !== 'radial') attrs.push(`draw:angle="${g.nAngle / 10}deg"`);
  attrs.push(`draw:border="${g.nBorder}%"`);
  let prev = 0;
  const stops = s.map((c) => {
    // Make sure offsets are increasing.
    const o = Math.max(prev, Math.min(1, Math.max(0, c.fStopOffset)));
    prev = o;
    return `<loext:gradient-stop svg:offset="${o}" loext:color-type="rgb" loext:color-value="${c.aStopColor}"/>`;
  });
  return `<draw:gradient ${attrs.join(' ')}>${stops.join('')}</draw:gradient>`;
}
