import colibre from './generated/icons.json';
import fluent from './generated/icons-fluent.json';

/**
 * The toolbar icon themes (Tools > Options > View > Icon theme, as in LibreOffice): Colibre;
 * Fluent UI System Icons, in outline (the default) and colour; Keyline Icons; and Material Line Icons
 * (line-md). They have icons for part of the commands; the others keep Colibre's, shown in
 * grey so they fit these sets.
 */
export const ICON_THEMES = ['colibre', 'fluent', 'fluent-color', 'keyline-icons', 'line-md'] as const;
export type IconTheme = (typeof ICON_THEMES)[number];
export const DEFAULT_ICON_THEME: IconTheme = 'fluent';

type Icons = Record<string, string>;
/**
 * The default theme and Colibre (which stands in for any icon a theme lacks) come with the app; the
 * others load when chosen, so the app does not download them all.
 */
const LOADERS: Record<Exclude<IconTheme, 'colibre' | 'fluent'>, () => Promise<{ default: Icons }>> = {
  'fluent-color': () => import('./generated/icons-fluent-color.json'),
  'keyline-icons': () => import('./generated/icons-keyline-icons.json'),
  'line-md': () => import('./generated/icons-line-md.json'),
};
const loaded: Partial<Record<IconTheme, Icons>> = { colibre, fluent };
let theme: IconTheme = 'colibre';
const urls = new Map<string, string | null>();

/** Chooses the theme; until it has loaded, Colibre's icons show, and `onLoad` runs once it has. */
export function setIconTheme(t: IconTheme, onLoad?: () => void): void {
  if (t !== theme) { theme = t; urls.clear(); }
  if (loaded[t] || t === 'colibre' || t === 'fluent') return;
  void LOADERS[t]().then((m) => {
    loaded[t] = m.default;
    if (theme === t) { urls.clear(); onLoad?.(); }
  });
}
export const iconTheme = (): IconTheme => theme;

const own = (cmd: string) => loaded[theme]?.[cmd];

/**
 * The command's icon in the current theme, else Colibre's, as a data: URL; null without one. The
 * font colour and highlighting icons have a colour area (COLORBAR), filled with `color` (empty
 * without one).
 */
export function iconUrl(cmd: string, color?: string): string | null {
  const key = color ? `${cmd}|${color}` : cmd;
  let url = urls.get(key);
  if (url === undefined) {
    const svg = own(cmd) ?? (colibre as Icons)[cmd];
    url = svg ? `data:image/svg+xml,${encodeURIComponent(svg.replace(/COLORBAR/g, color ?? 'none'))}` : null;
    urls.set(key, url);
  }
  return url;
}

/** The class of an icon the current theme lacks, so that Colibre's stands in for it in grey. */
export const iconClass = (cmd: string): string | undefined => (theme !== 'colibre' && loaded[theme] && !own(cmd) && (colibre as Icons)[cmd] ? 'icon-fallback' : undefined);

/**
 * Only the colour area of the font colour or highlighting icon, filled with `color`: drawn over the
 * icon unfiltered, so that dark mode's inverted icons keep the true colour.
 */
export function iconColorAreaUrl(cmd: string, color: string): string | null {
  const key = `${cmd}|area|${color}`;
  let url = urls.get(key);
  if (url === undefined) {
    const svg = own(cmd) ?? (colibre as Icons)[cmd];
    url = svg?.includes('COLORBAR')
      // Everything else is left out but white shapes drawn on the area (Colibre's "ab").
      ? `data:image/svg+xml,${encodeURIComponent(svg
        .replace(/(fill|stroke)="(?!COLORBAR|#fafafa|#fff\b|#ffffff)[^"]*"/gi, '$1="none"')
        .replace('<svg ', '<svg fill="none" stroke="none" ')
        .replace(/COLORBAR/g, color))}`
      : null;
    urls.set(key, url);
  }
  return url;
}
