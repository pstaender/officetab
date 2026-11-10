// Generates src/app/generated/webfonts.json: the Google Fonts (and a few other open fonts) that
// Fontsource packages for npm, so that a document using one of them can load it from the jsDelivr
// CDN. The fonts the app offers in its font list are pinned to an exact package version; the rest
// to the current major version. Also fetches TeX Gyre Termes (not on npm) from CTAN into
// public/fonts/, from where the app serves it itself.
// Usage: node tools/build/gen-webfonts.ts
import { mkdirSync, writeFileSync } from 'node:fs';

const API = 'https://api.fontsource.org/v1/fonts';
const CDN = 'https://cdn.jsdelivr.net/npm/@fontsource';
const CTAN = 'https://mirrors.ctan.org/fonts/tex-gyre/opentype';

/** The fonts offered in the font list by default, and the replacements of the font profiles. */
export const OFFERED = [
  'Roboto', 'Open Sans', 'Google Sans', 'Inter', 'Montserrat', 'Poppins', 'Oswald', 'Roboto Condensed',
  'Source Sans 3', 'Merriweather', 'IBM Plex Mono', 'Lato',
  'Carlito', 'Caladea', 'Arimo', 'Tinos', 'Cousine', 'Gelasio', 'DejaVu Sans', 'JetBrains Mono', 'Fira Code',
  'Cormorant', 'Libre Franklin', 'EB Garamond', 'Anton', 'Archivo Narrow', 'Comic Neue', 'Fira Sans',
];
/** Fonts outside Google Fonts that Fontsource also packages and the profiles use. */
const OTHER = new Set(['DejaVu Sans']);

interface ApiFont { id: string; family: string; subsets: string[]; weights: number[]; styles: string[]; category: string; type: string }

const fonts = (await (await fetch(API, { headers: { 'User-Agent': 'office-webfonts-generator' } })).json()) as ApiFont[];
const CATEGORY: Record<string, string> = { 'sans-serif': 's', serif: 'r', monospace: 'm', display: 'd', handwriting: 'h' };
const out = fonts
  .filter((f) => f.type === 'google' || OTHER.has(f.family))
  .sort((a, b) => a.family.localeCompare(b.family))
  .map((f) => ({ f: f.family, i: f.id, c: CATEGORY[f.category] ?? 's', w: f.weights, it: f.styles.includes('italic') ? 1 : 0, s: f.subsets }));

// Exact versions of the offered fonts, so their look cannot change under a document.
const pinned: Record<string, string> = {};
for (const family of OFFERED) {
  const f = out.find((x) => x.f === family);
  if (!f) throw new Error(`${family} is not on Fontsource`);
  const r = (await (await fetch(`https://data.jsdelivr.com/v1/packages/npm/@fontsource/${f.i}/resolved?specifier=5`)).json()) as { version?: string };
  if (!r.version) throw new Error(`no version for @fontsource/${f.i}`);
  pinned[f.i] = r.version;
}

mkdirSync('src/app/generated', { recursive: true });
writeFileSync('src/app/generated/webfonts.json', `${JSON.stringify({ base: CDN, major: '5', pinned, fonts: out })}\n`);
console.log(`${out.length} fonts, ${Object.keys(pinned).length} pinned`);

// TeX Gyre Termes (GUST Font License), the open Times replacement of the Google profile.
mkdirSync('public/fonts/tex-gyre-termes', { recursive: true });
for (const face of ['regular', 'bold', 'italic', 'bolditalic']) {
  const r = await fetch(`${CTAN}/texgyretermes-${face}.otf`);
  if (!r.ok) throw new Error(`TeX Gyre Termes ${face}: ${r.status}`);
  writeFileSync(`public/fonts/tex-gyre-termes/texgyretermes-${face}.otf`, new Uint8Array(await r.arrayBuffer()));
}
const lic = await fetch('https://mirrors.ctan.org/fonts/tex-gyre/doc/GUST-FONT-LICENSE.txt');
if (lic.ok) writeFileSync('public/fonts/tex-gyre-termes/GUST-FONT-LICENSE.txt', await lic.text());
console.log('TeX Gyre Termes fetched');
