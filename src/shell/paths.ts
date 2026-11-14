// Where the suite's shared files are. Every app lives in its own directory (`writer/`), while
// public/ (fonts, LanguageTool's data, icons, sw.js) is served from the suite's root, so a URL
// relative to the page would point into the app's directory.
//
// The root is found from this module's own URL, not the page's: in a build every chunk is in
// `assets/`, in development this file is `shell/paths.ts` (Vite's root is `src/`). Both are one
// level below the root, so the suite still works from any sub-directory of a static server.
// (A variable, not a literal: Vite would take `new URL('../', import.meta.url)` for an asset.)
const PARENT = '../';
const SUITE_ROOT = new URL(PARENT, import.meta.url);

/** The URL of a file in public/ (`fonts/…`, `sw.js`), or of the suite's root for ''. */
export function suiteUrl(path = ''): string {
  return new URL(path, SUITE_ROOT).href;
}
