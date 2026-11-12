// Fonts: which font draws a document's font name, and loading web fonts on demand.
//
// A font profile maps font names to replacements (like LibreOffice's font replacement table) and
// names the default sans-serif, serif and monospace fonts for names it does not know. A document
// font is drawn with the font itself when the system has it, else with its replacement, else with
// the profile's default for its kind: the CSS font list does this per character.
//
// Web fonts come from the Fontsource packages of Google Fonts on the jsDelivr CDN (and TeX Gyre
// Termes from the app itself). They are registered as FontFaces with their scripts' Unicode
// ranges, so the browser fetches only the faces and scripts a document uses; the service worker
// keeps them for offline use.
import catalog from './generated/webfonts.json';
import { GetEnglishSearchFontName, aMetricCompatibleMap } from '@lo/vcl/source/font/PhysicalFontCollection.ts';
import { GetFontFamily, SetFontResolver } from '@lo/vcl/source/outdev/text.ts';
import { getMapName } from '@lo/unotools/source/config/fontcfg.ts';
import { t } from './i18n.ts';

export type FontKind = 'sans' | 'serif' | 'mono';
export interface FontProfile {
  id: string;
  name: string;
  builtin?: boolean;
  /** Font name -> replacement font name. */
  replacements: Record<string, string>;
  defaults: Record<FontKind, string>;
}

interface WebFont { f: string; i: string; c: string; w: number[]; it: number; s: string[] }
const FONTS = catalog.fonts as WebFont[];
const BY_NAME = new Map(FONTS.map((f) => [f.f.toLowerCase(), f]));
const PINNED = catalog.pinned as Record<string, string>;

/** Fonts the app serves itself (public/fonts/): TeX Gyre Termes is on no font CDN. */
const OWN: Record<string, { kind: FontKind; files: Record<string, string> }> = {
  'TeX Gyre Termes': {
    kind: 'serif',
    files: { '400normal': 'texgyretermes-regular.otf', '700normal': 'texgyretermes-bold.otf', '400italic': 'texgyretermes-italic.otf', '700italic': 'texgyretermes-bolditalic.otf' },
  },
};

/** The web fonts offered in the font list (the pinned ones), and TeX Gyre Termes. */
export const OFFERED_FONTS: string[] = [...FONTS.filter((f) => PINNED[f.i]).map((f) => f.f), ...Object.keys(OWN)].sort((a, b) => a.localeCompare(b));
/** Common system and Office font names, offered as they are (drawn with replacements if missing). */
const SYSTEM_FONTS = ['Liberation Serif', 'Liberation Sans', 'Liberation Mono', 'Arial', 'Calibri', 'Cambria', 'Courier New', 'Georgia', 'Helvetica', 'Times New Roman', 'Verdana'];

// The open stand-ins for the fonts LibreOffice bundles: Liberation 2 is derived from them.
const LIBERATION_STAND_INS: Record<string, string> = {
  'Liberation Serif': 'Tinos', 'Liberation Sans': 'Arimo', 'Liberation Mono': 'Cousine', 'Liberation Sans Narrow': 'Archivo Narrow',
  // The formulas' symbol font (FONTNAME_MATH), which LibreOffice bundles.
  OpenSymbol: 'STIX Two Math',
};
/** Math fonts: their one Fontsource subset holds every glyph, so they register without a Unicode range. */
const WHOLE_FONTS = new Set(['STIX Two Math', 'Noto Sans Math', 'Libertinus Math']);

export const BUILTIN_PROFILES: FontProfile[] = [
  {
    id: 'libreoffice', name: 'LibreOffice', builtin: true,
    // PhysicalFontCollection's metric-compatible replacements, then the stand-ins of LibreOffice's own fonts.
    replacements: { ...Object.fromEntries(aMetricCompatibleMap), ...LIBERATION_STAND_INS },
    defaults: { sans: 'Liberation Sans', serif: 'Liberation Serif', mono: 'Liberation Mono' },
  },
  {
    id: 'google', name: 'Google Fonts', builtin: true,
    replacements: {
      Calibri: 'Carlito', Cambria: 'Caladea', Arial: 'Arimo', Helvetica: 'Arimo', 'Helvetica Neue': 'Arimo',
      'Times New Roman': 'TeX Gyre Termes', Times: 'TeX Gyre Termes', 'Courier New': 'Cousine', Courier: 'Cousine',
      Georgia: 'Gelasio', Verdana: 'DejaVu Sans', Tahoma: 'DejaVu Sans', 'Trebuchet MS': 'Fira Sans', Impact: 'Anton',
      'Comic Sans MS': 'Comic Neue', Consolas: 'JetBrains Mono', 'Lucida Console': 'JetBrains Mono',
      'Palatino Linotype': 'Cormorant', Palatino: 'Cormorant', 'Book Antiqua': 'Cormorant',
      'Franklin Gothic': 'Libre Franklin', 'Franklin Gothic Medium': 'Libre Franklin', Garamond: 'EB Garamond',
      'Segoe UI': 'Inter', Aptos: 'Inter', 'Aptos Display': 'Inter', 'Arial Narrow': 'Archivo Narrow', 'Arial Black': 'Anton',
      'Source Sans Pro': 'Source Sans 3', ...LIBERATION_STAND_INS, 'Liberation Serif': 'TeX Gyre Termes',
    },
    defaults: { sans: 'Inter', serif: 'TeX Gyre Termes', mono: 'Fira Code' },
  },
];

const LS_PROFILES = 'writer:fontprofiles', LS_ACTIVE = 'writer:fontprofile', LS_SHOW_ALL = 'writer:fonts:showall', LS_ALWAYS = 'writer:fonts:alwaysreplace', LS_PREVIEW = 'writer:fonts:preview', LS_MRU = 'writer:fonts:mru';
/** The family prefix of the font list's preview faces (Latin, regular only). */
const PREVIEW = '__preview ';
/** svx tbcontrl MAX_MRU_FONTNAME_ENTRIES. */
const MAX_MRU_FONTNAME_ENTRIES = 5;
const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v === null ? d : (JSON.parse(v) as T); } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

/** Unicode ranges of the Fontsource subsets (as Google Fonts' CSS gives them). */
const RANGES: Record<string, string> = {
  latin: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  'latin-ext': 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
  cyrillic: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116',
  'cyrillic-ext': 'U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F',
  greek: 'U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF',
  'greek-ext': 'U+1F00-1FFF',
  vietnamese: 'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB',
};

/** The kind of a font, from the catalogue or its name. */
export function FontKindOf(name: string): FontKind {
  const w = BY_NAME.get(name.toLowerCase());
  if (w) return w.c === 'm' ? 'mono' : w.c === 'r' ? 'serif' : 'sans';
  if (OWN[name]) return OWN[name].kind;
  // The document's font table says which family an unknown font belongs to.
  const fam = GetFontFamily(name);
  if (fam === 'roman') return 'serif';
  if (fam === 'modern') return 'mono';
  if (fam === 'swiss') return 'sans';
  const n = name.toLowerCase();
  if (/mono|courier|consol|code|typewriter/.test(n)) return 'mono';
  if (!/sans/.test(n) && /serif|times|roman|georgia|garamond|cambria|caladea|book|palatino|minion|baskerville|didot|bodoni|caslon|century|termes|tinos/.test(n)) return 'serif';
  return 'sans';
}

const newProfileId = () => `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class FontService {
  profiles: FontProfile[];
  activeId: string;
  showAll: boolean;
  /** Use the replacement even where the system has the font, so documents look the same everywhere. */
  alwaysReplace: boolean;
  /** Show each font name in its font in the font list (optviewpage's "showfontpreview"). */
  preview: boolean;
  /** The fonts chosen last, newest first (FontNameBox's MRU entries). */
  mru: string[];
  private registered = new Set<string>();
  private listeners = new Set<() => void>();
  private changeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.profiles = [...BUILTIN_PROFILES, ...read<FontProfile[]>(LS_PROFILES, []).filter((p) => p && p.id && p.replacements && p.defaults)];
    this.activeId = read(LS_ACTIVE, 'google');
    if (!this.profiles.some((p) => p.id === this.activeId)) this.activeId = 'google';
    this.showAll = read(LS_SHOW_ALL, false);
    this.alwaysReplace = read(LS_ALWAYS, false);
    this.preview = read(LS_PREVIEW, true);
    this.mru = read<string[]>(LS_MRU, []).filter((n) => typeof n === 'string').slice(0, MAX_MRU_FONTNAME_ENTRIES);
  }

  /** Previews are off with all web fonts listed: that list would fetch hundreds of fonts. */
  get previews(): boolean { return this.preview && !this.showAll; }

  get active(): FontProfile { return this.profiles.find((p) => p.id === this.activeId) ?? BUILTIN_PROFILES[1]!; }

  /** Installs the profile lookup in vcl's font mapping. */
  install(): void {
    SetFontResolver({ stack: (f) => this.stack(f), noLigatures: (f) => this.primaryWebFont(f) === 'Fira Code' });
  }

  /** Called (once per burst) when fonts finish loading or the profile changes: layout must re-measure. */
  onChange(f: () => void): () => void { this.listeners.add(f); return () => this.listeners.delete(f); }
  private changed(): void {
    clearTimeout(this.changeTimer);
    this.changeTimer = globalThis.setTimeout(() => { for (const f of this.listeners) f(); }, 50);
  }

  /** The replacement chain of a font name: its replacement, that one's, ... (at most a few). */
  private chain(name: string): string[] {
    const out: string[] = [];
    const map = this.active.replacements;
    const bySearch = (search: string) => Object.entries(map).find(([k]) => GetEnglishSearchFontName(k) === search)?.[1];
    const lookup = (n: string) => map[n] ?? bySearch(GetEnglishSearchFontName(n));
    // PhysicalFontCollection::FindFontFamily: without a replacement of its own, the name's short and
    // family names (getMapName: "Cambria Math" is the family "cambria") find one.
    const first = (n: string) => {
      const own = lookup(n);
      if (own) return own;
      const { rShortName, rFamilyName } = getMapName(GetEnglishSearchFontName(n));
      return (rShortName && bySearch(rShortName)) || (rFamilyName && bySearch(rFamilyName)) || undefined;
    };
    for (let n = first(name); n && !out.includes(n) && out.length < 4; n = lookup(n)) out.push(n);
    return out;
  }

  /** The first web font a font name is drawn with, if the system lacks the name itself. */
  private primaryWebFont(name: string): string | undefined {
    const chain = this.chain(name);
    return [...(this.alwaysReplace ? [...chain, name] : [name, ...chain]), this.active.defaults[FontKindOf(name)]].find((n) => this.isWebFont(n));
  }

  isWebFont(name: string): boolean { return BY_NAME.has(name.toLowerCase()) || !!OWN[name]; }

  /** The CSS font-family list for a document font: itself, its replacements, the profile's default. */
  stack(name: string): string {
    const kind = FontKindOf(name);
    const chain = this.chain(name);
    const names = [...(this.alwaysReplace && chain.length ? [...chain, name] : [name, ...chain]), this.active.defaults[kind], ...this.chain(this.active.defaults[kind])];
    const unique = [...new Set(names)];
    for (const n of unique) this.ensure(n);
    const generic = kind === 'mono' ? 'monospace' : kind === 'serif' ? 'serif' : 'sans-serif';
    return `${unique.map((n) => `"${n.replace(/"/g, '')}"`).join(', ')}, ${generic}`;
  }

  /** Registers a web font's faces with the document (once); the browser loads what text needs. */
  private ensure(name: string): void {
    if (this.registered.has(name) || typeof document === 'undefined') return;
    const own = OWN[name], web = BY_NAME.get(name.toLowerCase());
    if (!own && !web) return;
    this.registered.add(name);
    const faces: FontFace[] = [];
    if (own) {
      for (const [key, file] of Object.entries(own.files)) {
        faces.push(new FontFace(name, `url(./fonts/tex-gyre-termes/${file}) format('opentype')`, { weight: key.slice(0, 3), style: key.slice(3) }));
      }
    } else if (web) {
      const version = PINNED[web.i] ?? catalog.major;
      const base = `${catalog.base}/${web.i}@${version}/files/${web.i}`;
      // The weights nearest to regular and bold; the browser matches the rest.
      const pick = (want: number) => web.w.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a), web.w[0]!);
      const weights = [...new Set([pick(400), pick(700)])];
      const styles = web.it ? ['normal', 'italic'] : ['normal'];
      const subsets = web.s.filter((s) => RANGES[s]);
      for (const sub of subsets.length ? subsets : web.s.slice(0, 1)) {
        for (const w of weights) for (const st of styles) {
          faces.push(new FontFace(web.f, `url(${base}-${sub}-${w}-${st}.woff2) format('woff2')`, { weight: String(w), style: st, ...(RANGES[sub] && !WHOLE_FONTS.has(web.f) ? { unicodeRange: RANGES[sub] } : {}) }));
        }
      }
    }
    for (const f of faces) document.fonts.add(f);
    // The Latin faces are loaded now, so that the first layout after them is final; other
    // scripts load when text needs them (document.fonts' loadingdone).
    const first = faces.filter((f) => !f.unicodeRange || f.unicodeRange.startsWith('U+0000') || own);
    void Promise.allSettled(first.map((f) => f.load())).then(() => this.changed());
  }

  /** document.fonts reports faces that finished loading for other scripts (not the font list's previews). */
  watchLoading(): void {
    if (typeof document !== 'undefined') {
      document.fonts.addEventListener('loadingdone', (e) => {
        if ((e as FontFaceSetLoadEvent).fontfaces.every((f) => f.family.replace(/"/g, '').startsWith(PREVIEW))) return;
        this.changed();
      });
    }
  }

  /**
   * The CSS font-family that shows a font's name in the font list (FontNameBox's DrawPreview): the
   * font itself, else the web font that draws it. Web fonts get a face of their own for this, with
   * the Latin regular style only, so the list loads little and the document does not re-measure.
   */
  previewFamily(name: string): string {
    const web = this.isWebFont(name) ? name : this.primaryWebFont(name);
    const kind = FontKindOf(name);
    const generic = kind === 'mono' ? 'monospace' : kind === 'serif' ? 'serif' : 'sans-serif';
    const q = (n: string) => `"${n.replace(/"/g, '')}"`;
    const names = [...(web === name ? [] : [q(name)]), ...(web ? [q(this.ensurePreview(web))] : [])];
    return `${names.join(', ')}${names.length ? ', ' : ''}${generic}`;
  }

  private ensurePreview(name: string): string {
    const family = PREVIEW + name;
    if (this.registered.has(family) || typeof document === 'undefined') return family;
    this.registered.add(family);
    const own = OWN[name], web = BY_NAME.get(name.toLowerCase());
    let src: string | undefined;
    if (own) src = `url(./fonts/tex-gyre-termes/${own.files['400normal']}) format('opentype')`;
    else if (web) {
      const w = web.w.reduce((a, b) => (Math.abs(b - 400) < Math.abs(a - 400) ? b : a), web.w[0]!);
      const sub = web.s.includes('latin') ? 'latin' : web.s[0];
      src = `url(${catalog.base}/${web.i}@${PINNED[web.i] ?? catalog.major}/files/${web.i}-${sub}-${w}-normal.woff2) format('woff2')`;
    }
    // The browser fetches the face when an entry shows the name.
    if (src) document.fonts.add(new FontFace(family, src));
    return family;
  }

  /** FontNameBox's MRU entries: a font chosen moves to the front. */
  addMRU(name: string): void {
    if (!name) return;
    this.mru = [name, ...this.mru.filter((n) => n !== name)].slice(0, MAX_MRU_FONTNAME_ENTRIES);
    write(LS_MRU, this.mru);
  }

  /** The font names for the font list: offered and system fonts, those the document uses, or all. */
  listFonts(docFonts: Iterable<string>): string[] {
    const set = new Set<string>([...SYSTEM_FONTS, ...OFFERED_FONTS, ...docFonts]);
    if (this.showAll) for (const f of FONTS) set.add(f.f);
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  setActive(id: string): void { this.activeId = id; write(LS_ACTIVE, id); this.changed(); }
  setShowAll(v: boolean): void { this.showAll = v; write(LS_SHOW_ALL, v); }
  setPreview(v: boolean): void { this.preview = v; write(LS_PREVIEW, v); }
  setAlwaysReplace(v: boolean): void { this.alwaysReplace = v; write(LS_ALWAYS, v); this.changed(); }

  private saveCustom(): void { write(LS_PROFILES, this.profiles.filter((p) => !p.builtin)); }

  /** A new custom profile copied from another, made active. */
  cloneProfile(from: FontProfile, name = t('fonts.copyOf', { name: from.name })): FontProfile {
    const p: FontProfile = { id: newProfileId(), name, replacements: { ...from.replacements }, defaults: { ...from.defaults } };
    this.profiles.push(p);
    this.saveCustom();
    this.setActive(p.id);
    return p;
  }

  updateProfile(p: FontProfile): void {
    if (p.builtin) return;
    this.profiles = this.profiles.map((x) => (x.id === p.id ? p : x));
    this.saveCustom();
    if (p.id === this.activeId) this.changed();
  }

  deleteProfile(id: string): void {
    const p = this.profiles.find((x) => x.id === id);
    if (!p || p.builtin) return;
    this.profiles = this.profiles.filter((x) => x.id !== id);
    this.saveCustom();
    if (this.activeId === id) this.setActive('google');
  }

  /** The JSON file a profile is exported as. */
  exportProfile(p: FontProfile): string {
    return `${JSON.stringify({ format: 'writer-font-profile', version: 1, name: p.name, replacements: p.replacements, defaults: p.defaults }, null, 2)}\n`;
  }

  /** Imports a profile file as a new custom profile, made active. */
  importProfile(text: string): FontProfile {
    const j = JSON.parse(text) as Partial<FontProfile> & { format?: string };
    if (j.format !== 'writer-font-profile' || typeof j.replacements !== 'object' || !j.replacements) throw new Error(t('fonts.importError'));
    const str = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v.trim() : d);
    const replacements = Object.fromEntries(Object.entries(j.replacements).filter(([k, v]) => typeof k === 'string' && typeof v === 'string' && k.trim() && v.trim()).map(([k, v]) => [k.trim(), (v as string).trim()]));
    const d = j.defaults ?? ({} as Partial<Record<FontKind, string>>);
    const base = BUILTIN_PROFILES[1]!.defaults;
    const p: FontProfile = { id: newProfileId(), name: str(j.name, t('fonts.imported')), replacements, defaults: { sans: str(d.sans, base.sans), serif: str(d.serif, base.serif), mono: str(d.mono, base.mono) } };
    this.profiles.push(p);
    this.saveCustom();
    this.setActive(p.id);
    return p;
  }
}
