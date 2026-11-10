// SPDX-License-Identifier: MPL-2.0
// @upstream oox/source/drawingml/fillproperties.cxx partial
// FillProperties::pushToPropMap for a:gradFill (the colour stops, a:lin's angle, a:path with its
// fillToRect centre, tryToConvertToAxial), and DrawingML::WriteGradientFill for the way back.
// Transparency stops are not read. Shape rotation and mirroring are not added to the angle: Writer
// for the web turns and mirrors a shape's fill with the shape, as Word does.
import { child, childElements, type XmlElement } from '../../../xmloff/source/core/xmlparse.ts';
import { GetColor, type ThemeColors } from './color.ts';
import { getInterpolatedBColor, type BColorStop, type BGradient } from '../../../basegfx/source/tools/gradienttools.ts';

const MAX_PERCENT = 100000;

/** BGradient::tryToConvertToAxial: symmetric stops become an axial gradient of their first half. */
function tryToConvertToAxial(g: BGradient): void {
  const s = g.aColorStops;
  if (g.eStyle !== 'linear' || s.length < 3) return;
  for (let i = 0, j = s.length - 1; i < j; i++, j--) {
    if (s[i]!.aStopColor !== s[j]!.aStopColor || Math.abs(s[i]!.fStopOffset - (1 - s[j]!.fStopOffset)) > 1e-6) return;
  }
  // The first half, from the edge (0) to the centre (1).
  g.aColorStops = s.filter((x) => x.fStopOffset <= 0.5).map((x) => ({ fStopOffset: x.fStopOffset * 2, aStopColor: x.aStopColor }));
  g.eStyle = 'axial';
}

/** a:gradFill as a gradient, or null without colour stops. */
export function ImportGradFill(gradFill: XmlElement, theme: ThemeColors): BGradient | null {
  const aColorStops: BColorStop[] = [];
  for (const gs of childElements(child(gradFill, 'a:gsLst') ?? gradFill).filter((e) => e.name === 'a:gs')) {
    const c = GetColor(gs, theme);
    if (c) aColorStops.push({ fStopOffset: Number(gs.attrs.get('pos') ?? 0) / MAX_PERCENT, aStopColor: c });
  }
  if (!aColorStops.length) return null;
  aColorStops.sort((a, b) => a.fStopOffset - b.fStopOffset);
  const g: BGradient = { eStyle: 'linear', aColorStops, nAngle: 900, nBorder: 0, nOffsetX: 0, nOffsetY: 0, nIntensStart: 100, nIntensEnd: 100, nStepCount: 0 };
  const path = child(gradFill, 'a:path');
  if (path) {
    const r = child(path, 'a:fillToRect');
    const n = (k: string) => Number(r?.attrs.get(k) ?? 0);
    const nCenterX = (MAX_PERCENT + n('l') - n('r')) / 2, nCenterY = (MAX_PERCENT + n('t') - n('b')) / 2;
    g.nOffsetX = Math.min(100, Math.max(0, Math.round(nCenterX / 1000)));
    g.nOffsetY = Math.min(100, Math.max(0, Math.round(nCenterY / 1000)));
    // XML_rect or XML_shape, but the latter is not implemented.
    g.eStyle = path.attrs.get('path') === 'circle' ? 'radial' : 'rectangular';
    // DrawingML runs from the centre outwards, ODF from the outside in.
    g.aColorStops = aColorStops.map((s) => ({ fStopOffset: 1 - s.fStopOffset, aStopColor: s.aStopColor })).reverse();
  } else {
    const nDmlAngle = Number(child(gradFill, 'a:lin')?.attrs.get('ang') ?? 0);
    // DrawingML angle (1/60000 degrees, clockwise from left to right) to API angle (1/10 degrees)
    g.nAngle = (((8100 - Math.round(nDmlAngle / 6000)) % 3600) + 3600) % 3600;
    tryToConvertToAxial(g);
  }
  return g;
}

/** DrawingML::WriteGradientFill */
export function ExportGradFill(g: BGradient): string {
  const hex = (c: string) => c.replace('#', '').toUpperCase();
  const gs = (stops: BColorStop[]) => `<a:gsLst>${stops.map((s) => `<a:gs pos="${Math.round(s.fStopOffset * MAX_PERCENT)}"><a:srgbClr val="${hex(s.aStopColor)}"/></a:gs>`).join('')}</a:gsLst>`;
  // The intensities and the border are part of the colours DrawingML knows.
  const stops = g.aColorStops.map((s) => ({ ...s, aStopColor: getInterpolatedBColor(g, s.fStopOffset) }));
  if (g.nBorder > 0) {
    const b = g.nBorder / 100;
    for (const s of stops) s.fStopOffset = b + s.fStopOffset * (1 - b);
    stops.unshift({ fStopOffset: 0, aStopColor: stops[0]!.aStopColor });
  }
  switch (g.eStyle) {
    case 'linear': case 'axial': {
      const ang = (((8100 - g.nAngle) % 3600) + 3600) % 3600 * 6000;
      // An axial gradient is the linear one there and back.
      const all = g.eStyle === 'axial' ? [...stops.map((s) => ({ ...s, fStopOffset: s.fStopOffset / 2 })), ...stops.slice().reverse().map((s) => ({ ...s, fStopOffset: 1 - s.fStopOffset / 2 }))] : stops;
      return `<a:gradFill rotWithShape="1">${gs(all)}<a:lin ang="${ang}" scaled="0"/></a:gradFill>`;
    }
    default: {
      const reversed = stops.map((s) => ({ ...s, fStopOffset: 1 - s.fStopOffset })).reverse();
      const x = g.nOffsetX * 1000, y = g.nOffsetY * 1000;
      return `<a:gradFill rotWithShape="1">${gs(reversed)}<a:path path="${g.eStyle === 'radial' || g.eStyle === 'ellipsoid' ? 'circle' : 'rect'}"><a:fillToRect l="${x}" t="${y}" r="${MAX_PERCENT - x}" b="${MAX_PERCENT - y}"/></a:path></a:gradFill>`;
    }
  }
}
