import colibre from './generated/icons.json';

/**
 * The toolbar icon themes (Tools > Options > View > Icon theme, as in LibreOffice): Colibre, the
 * default; Fluent UI System Icons, in outline and colour; Keyline Icons; and Material Line Icons
 * (line-md). They have icons for part of the commands; the others keep Colibre's, shown in
 * grey so they fit these sets.
 */
export const ICON_THEMES = ['colibre', 'fluent', 'fluent-color', 'keyline-icons', 'line-md'] as const;
export type IconTheme = (typeof ICON_THEMES)[number];

type Icons = Record<string, string>;
/** The other themes load when chosen, so the app does not download them all. */
const LOADERS: Record<Exclude<IconTheme, 'colibre'>, () => Promise<{ default: Icons }>> = {
  fluent: () => import('./generated/icons-fluent.json'),
  'fluent-color': () => import('./generated/icons-fluent-color.json'),
  'keyline-icons': () => import('./generated/icons-keyline-icons.json'),
  'line-md': () => import('./generated/icons-line-md.json'),
};
const loaded: Partial<Record<IconTheme, Icons>> = { colibre };
let theme: IconTheme = 'colibre';
const urls = new Map<string, string | null>();

/** Chooses the theme; until it has loaded, Colibre's icons show, and `onLoad` runs once it has. */
export function setIconTheme(t: IconTheme, onLoad?: () => void): void {
  if (t !== theme) { theme = t; urls.clear(); }
  if (loaded[t] || t === 'colibre') return;
  void LOADERS[t]().then((m) => {
    loaded[t] = m.default;
    if (theme === t) { urls.clear(); onLoad?.(); }
  });
}
export const iconTheme = (): IconTheme => theme;

const own = (cmd: string) => loaded[theme]?.[cmd];

/** The command's icon in the current theme, else Colibre's, as a data: URL; null without one. */
export function iconUrl(cmd: string): string | null {
  let url = urls.get(cmd);
  if (url === undefined) {
    const svg = own(cmd) ?? (colibre as Icons)[cmd];
    url = svg ? `data:image/svg+xml,${encodeURIComponent(svg)}` : null;
    urls.set(cmd, url);
  }
  return url;
}

/** The class of an icon the current theme lacks, so that Colibre's stands in for it in grey. */
export const iconClass = (cmd: string): string | undefined => (theme !== 'colibre' && loaded[theme] && !own(cmd) && (colibre as Icons)[cmd] ? 'icon-fallback' : undefined);
