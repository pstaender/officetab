import type { SwDoc } from '@lo/sw/inc/doc.ts';

/**
 * The colour window's state for font colour and character highlighting: the colours chosen last
 * (svx PaletteManager's recent colours, shared by both and kept in this browser) and the colours
 * the document already uses.
 */
export type ColorKind = 'font' | 'highlight';

/** svx xdef.hxx: COL_DEFAULT_FONT (Dark Red 2) and COL_DEFAULT_HIGHLIGHT (Yellow). */
export const DEFAULT_COLOR: Record<ColorKind, string> = { font: '#c9211e', highlight: '#ffff00' };

const LS_RECENT = 'writer:recent-colors';
const LS_LAST = 'writer:last-color-';
const MAX_RECENT = 10;

const norm = (c: string) => c.toLowerCase();

export function recentColors(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS_RECENT) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x)) : [];
  } catch { return []; }
}

/** The colour a toolbar button applies without choosing: the last one chosen for its kind. */
export function lastColor(kind: ColorKind): string {
  try { return localStorage.getItem(LS_LAST + kind) ?? DEFAULT_COLOR[kind]; } catch { return DEFAULT_COLOR[kind]; }
}

/** Remembers a chosen colour: first among the recent ones, and the kind's last colour. */
export function rememberColor(kind: ColorKind, color: string): void {
  const c = norm(color);
  try {
    localStorage.setItem(LS_RECENT, JSON.stringify([c, ...recentColors().filter((x) => norm(x) !== c)].slice(0, MAX_RECENT)));
    localStorage.setItem(LS_LAST + kind, c);
  } catch { /* storage may be unavailable */ }
}

/** The font and highlighting colours set in the document's text, headers, footers and notes. */
export function documentColors(doc: SwDoc, max = 20): string[] {
  const seen = new Set<string>();
  const add = (v: unknown) => { if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) seen.add(norm(v)); };
  const nodes = doc.GetNodes();
  for (let i = 0; i < nodes.Count() && seen.size < max; i++) {
    const n = nodes.node(i);
    if (!n.IsTextNode()) continue;
    add(n.m_aSet.RES_CHRATR_COLOR);
    add(n.m_aSet.RES_CHRATR_BACKGROUND);
    for (const h of n.m_aHints) { add(h.aAttrs.RES_CHRATR_COLOR); add(h.aAttrs.RES_CHRATR_BACKGROUND); }
  }
  return [...seen].slice(0, max);
}

export const toColorInt = (hex: string) => parseInt(hex.slice(1), 16);
export const fromColorInt = (v: number) => `#${v.toString(16).padStart(6, '0')}`;
