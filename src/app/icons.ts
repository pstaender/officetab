import colibre from './generated/icons.json';
import keyline from './generated/icons-keyline-icons.json';
import keylineColor from './generated/icons-keyline-icons-color.json';
import lineMd from './generated/icons-line-md.json';

/**
 * The toolbar icon themes (Tools > Options > View > Icon theme, as in LibreOffice): Colibre, the
 * default, Material Line Icons (line-md), Keyline Icons and its coloured version, which have icons
 * for part of the commands; the others keep Colibre's, shown in grey so they fit these sets.
 */
export const ICON_THEMES = ['colibre', 'line-md', 'keyline-icons', 'keyline-icons-color'] as const;
export type IconTheme = (typeof ICON_THEMES)[number];

const THEMES: Record<IconTheme, Record<string, string>> = { colibre, 'line-md': lineMd, 'keyline-icons': keyline, 'keyline-icons-color': keylineColor };
let theme: IconTheme = 'colibre';
const urls = new Map<string, string | null>();

export function setIconTheme(t: IconTheme): void { if (t !== theme) { theme = t; urls.clear(); } }
export const iconTheme = (): IconTheme => theme;

const own = (cmd: string) => THEMES[theme][cmd];

/** The command's icon in the current theme, else Colibre's, as a data: URL; null without one. */
export function iconUrl(cmd: string): string | null {
  let url = urls.get(cmd);
  if (url === undefined) {
    const svg = own(cmd) ?? THEMES.colibre[cmd];
    url = svg ? `data:image/svg+xml,${encodeURIComponent(svg)}` : null;
    urls.set(cmd, url);
  }
  return url;
}

/** The class of an icon the current theme lacks, so that Colibre's stands in for it in grey. */
export const iconClass = (cmd: string): string | undefined => (theme !== 'colibre' && !own(cmd) && THEMES.colibre[cmd] ? 'icon-fallback' : undefined);
